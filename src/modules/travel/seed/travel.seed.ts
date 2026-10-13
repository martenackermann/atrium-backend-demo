import { en, Faker } from '@faker-js/faker';
import type { ActingAs } from '@/common/domain/vocabulary';
import { addDaysIso, isoFromDateOrNull, startOfDayInZone } from '@/common/time/time';
import { seededUuidFactory } from '@/database/seed/run-seed';
import type { Seeder, SeedContext } from '@/database/seed/seed-context';
import type { Prisma } from '@/generated/prisma/client';
import { OrgSnapshot, resolveApprover } from '@/modules/core/approvals/approval-rules';
import { encryptPin } from '../domain/pin-cipher';
import { formatTripWhen } from '../domain/travel-format';
import { buildRoute, evaluateApprovalReasons, isHighPriority } from '../domain/travel-rules';
import { travelApprovalRequested } from '../mail/travel.approval_requested.notification';
import { travelApproved } from '../mail/travel.approved.notification';
import { travelBooked } from '../mail/travel.booked.notification';
import { travelBookingImpossible } from '../mail/travel.booking_impossible.notification';
import { travelDeclined } from '../mail/travel.declined.notification';
import { travelSubmittedToDesk } from '../mail/travel.submitted_to_desk.notification';
import type { TravelMailBase } from '../mail/travel-mail.helpers';
import {
  APPROVAL_EXEMPTION_LABELS,
  APPROVAL_REASON_LABELS,
  KIND_LABELS,
  TRAVEL_BOOKING_ENTITY,
  TRAVEL_ENTITY,
  type TravelStatus,
  travelReference,
} from '../travel.constants';
import { demoBookingPdf } from './demo-pdf';
import { type AddressSeed, type At, CAR_CLASSES, type SeedEvent, type TripSpec, TRIPS } from './travel-seed.data';

/** Own PRNG so travel ids do not depend on what other slices drew from the shared faker. */
const TRAVEL_SEED_SALT = 2;

/** Allowed transitions used to replay the seed paths (mirrors the machine). */
const NEXT: Record<string, Partial<Record<SeedEvent['type'], TravelStatus>>> = {
  pending_approval: { approve: 'to_book', decline: 'declined', withdraw: 'cancelled' },
  to_book: {
    book: 'booked',
    mark_booking_impossible: 'booking_impossible',
    request_cancellation: 'cancellation_requested',
  },
  booked: { request_cancellation: 'cancellation_requested' },
  booking_impossible: { close: 'cancelled', withdraw: 'cancelled' },
  cancellation_requested: { confirm_cancellation: 'cancelled' },
};

export async function seedTravel(ctx: SeedContext): Promise<void> {
  const { prisma, env } = ctx;
  const tz = env.APP_TIMEZONE;
  const faker = new Faker({ locale: [en] });
  faker.seed(env.SEED_FAKER_SEED + TRAVEL_SEED_SALT);
  const uuid = seededUuidFactory(faker);
  const at = ([day, hh, mm = 0]: At): Date =>
    new Date(startOfDayInZone(addDaysIso(ctx.today, day), tz).getTime() + (hh * 60 + mm) * 60_000);
  const now = new Date();

  // --- car classes ----------------------------------------------------------------
  const classes = new Map<string, { id: string; isDefault: boolean }>();
  for (const [index, c] of CAR_CLASSES.entries()) {
    const createdAt = at([-400, 9, index]);
    const id = uuid(createdAt);
    await prisma.carRentalClass.create({ data: { id, ...c, active: true, createdAt } });
    classes.set(c.code, { id, isDefault: c.isDefault });
  }

  // --- org snapshot for approver resolution (same pure rules as ApprovalService) --------
  const users = await prisma.user.findMany({ include: { roles: true } });
  const deputies = await prisma.deputy.findMany();
  const org = new OrgSnapshot(
    users.map((u) => ({ ...u, isExecutive: u.roles.some((r) => r.role === 'executive') })),
    deputies.map((d) => ({
      principalId: d.principalId,
      deputyId: d.deputyId,
      validFrom: isoFromDateOrNull(d.validFrom),
      validTo: isoFromDateOrNull(d.validTo),
    })),
  );
  const userById = new Map(users.map((u) => [u.id, u]));
  const person = (key: string) => {
    const ref = ctx.users.get(key);
    return userById.get(ref.id)!;
  };
  const tom = person('tom');
  const birthDates = new Map<string, string>();
  const birthDateOf = (userId: string) => {
    if (!birthDates.has(userId)) {
      const year = faker.number.int({ min: 1966, max: 1998 });
      const month = faker.number.int({ min: 1, max: 12 });
      const day = faker.number.int({ min: 1, max: 28 });
      birthDates.set(userId, `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    }
    return birthDates.get(userId)!;
  };

  let audits = 0;
  let notifications = 0;
  for (const spec of TRIPS) {
    const traveller = person(spec.traveller);
    const requester = person(spec.requester ?? spec.traveller);
    const createdAt = at(spec.created);
    const id = uuid(createdAt);
    const reference = travelReference(spec.n);
    const isExecutive = org.get(traveller.id)!.isExecutive;

    // detail + reasons + route
    const detail = buildDetail(spec, { at, classes, traveller, birthDateOf, userIdOf: (key) => person(key).id });
    const reasons = isExecutive ? [] : evaluateApprovalReasons(detail.ruleInput);
    const needsApproval = reasons.length > 0;
    const resolution = needsApproval
      ? resolveApprover(org, traveller.id, requester.id, env.FALLBACK_APPROVER_EMAIL)
      : null;
    const autoApproved = resolution?.approver.id === requester.id;
    let status: TravelStatus = needsApproval && !autoApproved ? 'pending_approval' : 'to_book';

    // replay the path
    const audit: Prisma.AuditLogCreateManyInput[] = [];
    const push = (
      row: Omit<Prisma.AuditLogCreateManyInput, 'id' | 'module' | 'entityType' | 'entityId' | 'correlationId'>,
    ) =>
      audit.push({
        id: uuid(row.occurredAt as Date),
        module: 'travel',
        entityType: TRAVEL_ENTITY,
        entityId: id,
        correlationId: 'seed',
        ...row,
        metadata: { entityLabel: reference, ...((row.metadata ?? {}) as Record<string, unknown>) },
      });
    push({
      occurredAt: createdAt,
      actorId: requester.id,
      actingAs: requester.id === traveller.id ? 'self' : 'requester',
      action: 'create',
      toState: needsApproval ? 'pending_approval' : 'to_book',
      metadata: { approvalReasons: reasons, exemption: isExecutive ? 'executive_traveller' : null },
    });

    const fields: Partial<Prisma.TravelRequestUncheckedCreateInput> = {};
    let booking: Prisma.TravelBookingUncheckedCreateInput | null = null;
    let bookedAt: Date | null = null;
    let decisionAt: Date | null = null;
    let impossibleAt: Date | null = null;
    for (const event of spec.events ?? []) {
      const next: TravelStatus | undefined = NEXT[status]?.[event.type];
      if (!next) throw new Error(`Seed ${reference}: ${event.type} not allowed in ${status}`);
      const when = at(event.at);
      const from = status;
      switch (event.type) {
        case 'approve': {
          const by = event.by ? person(event.by) : userById.get(resolution!.approver.id)!;
          const actingAs: ActingAs = event.as ?? 'approver';
          Object.assign(fields, {
            approvedAt: when,
            approvedById: by.id,
            approvalActingAs: actingAs,
            approvalComment: event.comment ?? null,
          });
          push({
            occurredAt: when,
            actorId: by.id,
            actingAs,
            action: 'approve',
            fromState: from,
            toState: next,
            ...(actingAs === 'deputy' ? { metadata: { onBehalfOfName: resolution!.approver.displayName } } : {}),
          });
          decisionAt = when;
          break;
        }
        case 'decline': {
          const by = event.by ? person(event.by) : userById.get(resolution!.approver.id)!;
          Object.assign(fields, {
            declinedAt: when,
            declinedById: by.id,
            declinedActingAs: 'approver',
            declineReason: event.reason,
          });
          push({
            occurredAt: when,
            actorId: by.id,
            actingAs: 'approver',
            action: 'decline',
            fromState: from,
            toState: next,
            reason: event.reason,
          });
          decisionAt = when;
          break;
        }
        case 'withdraw': {
          const by = person(event.by ?? spec.traveller);
          Object.assign(fields, { cancelledAt: when, cancellationReason: event.reason ?? null });
          push({
            occurredAt: when,
            actorId: by.id,
            actingAs: by.id === traveller.id ? 'self' : 'requester',
            action: 'withdraw',
            fromState: from,
            toState: next,
            reason: event.reason ?? null,
          });
          break;
        }
        case 'book':
          booking = {
            requestId: id,
            bookingNumber: event.bookingNumber,
            pinEncrypted: event.pin ? encryptPin(event.pin, env.ENCRYPTION_KEY) : null,
            comment: event.comment ?? null,
            bookedById: tom.id,
            bookedAt: when,
          };
          bookedAt = when;
          push({
            occurredAt: when,
            actorId: tom.id,
            actingAs: 'back_office',
            action: 'book',
            fromState: from,
            toState: next,
          });
          break;
        case 'mark_booking_impossible':
          Object.assign(fields, { bookingImpossibleReason: event.reason });
          impossibleAt = when;
          push({
            occurredAt: when,
            actorId: tom.id,
            actingAs: 'back_office',
            action: 'mark_booking_impossible',
            fromState: from,
            toState: next,
            reason: event.reason,
          });
          break;
        case 'request_cancellation': {
          const by = person(event.by ?? spec.traveller);
          Object.assign(fields, {
            statusBeforeCancellation: from,
            cancellationRequestedAt: when,
            cancellationReason: event.reason,
          });
          push({
            occurredAt: when,
            actorId: by.id,
            actingAs: by.id === traveller.id ? 'self' : 'requester',
            action: 'request_cancellation',
            fromState: from,
            toState: next,
            reason: event.reason,
          });
          break;
        }
        case 'confirm_cancellation':
          Object.assign(fields, { cancelledAt: when });
          push({
            occurredAt: when,
            actorId: tom.id,
            actingAs: 'back_office',
            action: 'confirm_cancellation',
            fromState: from,
            toState: next,
          });
          break;
        case 'close':
          Object.assign(fields, { cancelledAt: when, cancellationReason: event.reason, bookingImpossibleReason: null });
          push({
            occurredAt: when,
            actorId: tom.id,
            actingAs: 'back_office',
            action: 'close',
            fromState: from,
            toState: next,
            reason: event.reason,
          });
          break;
      }
      status = next;
    }
    if (status !== spec.status) throw new Error(`Seed ${reference}: ended in ${status}, expected ${spec.status}`);

    const lastAuditAt = audit.reduce((max, a) => Math.max(max, (a.occurredAt as Date).getTime()), createdAt.getTime());
    await prisma.travelRequest.create({
      data: {
        id,
        number: spec.n,
        kind: spec.kind,
        travellerId: traveller.id,
        requesterId: requester.id,
        approverId: resolution?.approver.id ?? null,
        approverSelection: resolution ? 'auto' : null,
        approverReason: resolution?.reason ?? null,
        escalatedFromId: resolution?.escalatedFromId ?? null,
        status,
        needsApproval,
        approvalReasons: reasons,
        approvalExemption: isExecutive ? 'executive_traveller' : null,
        startsAt: detail.startsAt,
        endsAt: detail.endsAt,
        routeSummary: detail.route,
        costCenterId: traveller.costCenterId,
        comment: spec.comment ?? null,
        rechargeCustomer: spec.recharge?.customer ?? null,
        rechargeProjectNumber: spec.recharge?.projectNumber ?? null,
        createdAt,
        updatedAt: new Date(lastAuditAt),
        version: 1 + (spec.events?.length ?? 0),
        ...fields,
        ...detail.nested,
      },
    });
    if (booking) {
      await prisma.travelBooking.create({ data: booking });
      const pdf = demoBookingPdf('Demo booking confirmation', [
        `Booking number: ${booking.bookingNumber}`,
        `Reference: ${reference}`,
        `Traveller: ${traveller.displayName}`,
        `Trip: ${KIND_LABELS[spec.kind]} - ${detail.route}`,
        `When: ${formatTripWhen(detail.startsAt, detail.endsAt, tz)}`,
        'Issued by the Atrium demo seed. Not valid for travel.',
      ]);
      await ctx.storeFile({
        content: pdf,
        originalName: `booking-confirmation-${booking.bookingNumber}.pdf`,
        mimeType: 'application/pdf',
        purpose: 'travel_booking_confirmation',
        uploadedById: tom.id,
        createdAt: new Date(bookedAt!.getTime() - 60_000),
        entity: { type: TRAVEL_BOOKING_ENTITY, id },
      });
    }
    await prisma.auditLog.createMany({ data: audit });
    audits += audit.length;

    // In-app notifications of the story records (SPEC_RESOLUTIONS #7).
    const base: TravelMailBase = {
      requestId: id,
      reference,
      kind: spec.kind,
      route: detail.route,
      traveller: traveller.displayName,
      when: formatTripWhen(detail.startsAt, detail.endsAt, tz),
    };
    for (const note of spec.inApp ?? []) {
      const recipient = person(note.to);
      const approver = resolution ? userById.get(resolution.approver.id)! : null;
      const rendered = (() => {
        switch (note.kind) {
          case 'approval_requested': {
            const c = {
              ...base,
              reasons: reasons.map((r) => APPROVAL_REASON_LABELS[r]),
              approver: approver!.displayName,
              requester: requester.displayName,
              escalatedFrom: resolution?.escalatedFromId ? userById.get(resolution.escalatedFromId)!.displayName : null,
            };
            return {
              t: travelApprovalRequested,
              c,
              when: createdAt,
              high: isHighPriority('pending_approval', detail.startsAt, createdAt, env.TRAVEL_HIGH_PRIORITY_DAYS),
            };
          }
          case 'submitted_to_desk': {
            const c = {
              ...base,
              requester: requester.displayName,
              exemption: isExecutive ? APPROVAL_EXEMPTION_LABELS.executive_traveller : null,
            };
            return {
              t: travelSubmittedToDesk,
              c,
              when: createdAt,
              high: isHighPriority('to_book', detail.startsAt, createdAt, env.TRAVEL_HIGH_PRIORITY_DAYS),
            };
          }
          case 'approved': {
            const c = {
              ...base,
              approver: approver!.displayName,
              comment: (fields.approvalComment as string | null) ?? null,
              automatic: false,
            };
            return {
              t: travelApproved,
              c,
              when: decisionAt!,
              high: isHighPriority('to_book', detail.startsAt, decisionAt!, env.TRAVEL_HIGH_PRIORITY_DAYS),
            };
          }
          case 'declined': {
            const c = { ...base, decider: approver!.displayName, reason: fields.declineReason as string };
            return { t: travelDeclined, c, when: decisionAt!, high: false };
          }
          case 'booked': {
            const c = {
              ...base,
              bookingNumber: booking!.bookingNumber,
              hasPin: !!booking!.pinEncrypted,
              comment: null,
              attachmentCount: 1,
            };
            return { t: travelBooked, c, when: bookedAt!, high: false };
          }
          case 'booking_impossible': {
            const c = { ...base, reason: fields.bookingImpossibleReason as string };
            return { t: travelBookingImpossible, c, when: impossibleAt!, high: false };
          }
        }
      })();
      const template = rendered.t as {
        subject: (c: never) => string;
        body: (c: never) => string;
        link?: (c: never) => string | null;
        id: string;
      };
      const context = rendered.c as never;
      await prisma.notification.create({
        data: {
          id: uuid(new Date(rendered.when.getTime() + 500)),
          userId: recipient.id,
          templateId: template.id,
          module: 'travel',
          title: template.subject(context).slice(0, 140),
          body: template.body(context).slice(0, 500),
          link: template.link?.(context) ?? null,
          priority: rendered.high ? 'high' : 'normal',
          entityType: TRAVEL_ENTITY,
          entityId: id,
          readAt: note.read ? new Date(Math.min(rendered.when.getTime() + 3 * 3_600_000, now.getTime())) : null,
          createdAt: rendered.when,
        },
      });
      notifications++;
    }
  }

  // Explicit reference numbers were inserted: move the sequence past them.
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('travel_requests', 'number'), (SELECT COALESCE(MAX(number), 1) FROM travel_requests))`,
  );
  ctx.log(
    `travel: ${CAR_CLASSES.length} car classes, ${TRIPS.length} requests, ${audits} audit rows, ${notifications} notifications`,
  );
}

interface DetailContext {
  at: (a: At) => Date;
  classes: Map<string, { id: string; isDefault: boolean }>;
  traveller: { id: string; firstName: string; lastName: string; email: string; phone: string | null };
  birthDateOf: (userId: string) => string;
  userIdOf: (key: string) => string;
}

function addressColumns(prefix: 'handover' | 'dropOff', address: AddressSeed | null) {
  return {
    [`${prefix}Street`]: address?.street ?? null,
    [`${prefix}HouseNumber`]: address?.houseNumber ?? null,
    [`${prefix}PostalCode`]: address?.postalCode ?? null,
    [`${prefix}City`]: address?.city ?? null,
    [`${prefix}CountryCode`]: address?.countryCode ?? null,
  };
}

function buildDetail(spec: TripSpec, ctx: DetailContext) {
  if (spec.kind === 'car') {
    const car = spec.car!;
    const cls = ctx.classes.get(car.classCode)!;
    const pickupAt = ctx.at(car.pickup);
    const returnAt = ctx.at(car.ret);
    const handoverAddress = typeof car.handover === 'string' ? null : car.handover;
    const dropOff = car.dropOff ?? car.handover;
    const dropOffAddress = typeof dropOff === 'string' ? null : dropOff;
    const equipment = {
      estate: false,
      navigation: false,
      automaticPreferred: false,
      automaticRequired: false,
      diesel: false,
      winterTyres: false,
      foreignTravel: false,
      childSeat: false,
      ...car.equipment,
    };
    const handoverMode = handoverAddress ? ('delivery' as const) : ('branch' as const);
    const dropOffMode = dropOffAddress ? ('collection' as const) : ('branch' as const);
    return {
      startsAt: pickupAt,
      endsAt: returnAt,
      route: buildRoute({
        kind: 'car',
        car: {
          handoverMode,
          handoverBranch: typeof car.handover === 'string' ? car.handover : null,
          handoverCity: handoverAddress?.city ?? null,
          destination: car.destination,
        },
      }),
      ruleInput: { kind: 'car' as const, car: { classIsDefault: cls.isDefault, equipment, handoverMode, dropOffMode } },
      nested: {
        car: {
          create: {
            vehicleType: car.vehicleType ?? 'car',
            carClassId: cls.id,
            pickupAt,
            returnAt,
            destination: car.destination,
            ...equipment,
            foreignCountries: car.countries ?? [],
            expectedKmPerDay: car.km ?? null,
            minPayloadKg: car.payloadKg ?? null,
            handoverMode,
            handoverBranch: typeof car.handover === 'string' ? car.handover : null,
            ...addressColumns('handover', handoverAddress),
            dropOffMode,
            dropOffBranch: typeof dropOff === 'string' ? dropOff : null,
            ...addressColumns('dropOff', dropOffAddress),
            driverFirstName: ctx.traveller.firstName,
            driverLastName: ctx.traveller.lastName,
            driverEmail: ctx.traveller.email,
            driverPhone: ctx.traveller.phone ?? '555-0100',
            driverBirthDate: new Date(`${ctx.birthDateOf(ctx.traveller.id)}T00:00:00.000Z`),
            driverLicenceNumber: null,
            additionalDrivers: null,
            specialEquipmentReason: car.reason ?? null,
          },
        },
      },
    };
  }
  if (spec.kind === 'train') {
    const train = spec.train!;
    const outboundAt = ctx.at(train.out);
    const returnAt = train.ret ? ctx.at(train.ret) : null;
    return {
      startsAt: outboundAt,
      endsAt: returnAt,
      route: buildRoute({
        kind: 'train',
        train: { fromStation: train.from, viaStation: train.via, toStation: train.to },
      }),
      ruleInput: { kind: 'train' as const, train: { fareType: train.fare, separateTickets: train.separate ?? false } },
      nested: {
        train: {
          create: {
            tripType: train.trip,
            outboundAt,
            returnAt,
            fromStation: train.from,
            viaStation: train.via ?? null,
            toStation: train.to,
            fareType: train.fare,
            seatReservations: train.seats ?? 0,
            separateTickets: train.separate ?? false,
            localTransportTicket: train.local ?? false,
            notes: train.notes ?? null,
          },
        },
        companions: {
          create: (train.companions ?? []).map((key, position) => ({ userId: ctx.userIdOf(key), position })),
        },
      },
    };
  }
  const flight = spec.flight!;
  const outboundAt = ctx.at(flight.out);
  const returnAt = flight.ret ? ctx.at(flight.ret) : null;
  return {
    startsAt: outboundAt,
    endsAt: returnAt,
    route: buildRoute({ kind: 'flight', flight: { outboundFrom: flight.from, outboundTo: flight.to } }),
    ruleInput: { kind: 'flight' as const },
    nested: {
      flight: {
        create: {
          tripType: flight.trip,
          outboundDepartureAt: outboundAt,
          outboundFrom: flight.from,
          outboundTo: flight.to,
          returnDepartureAt: returnAt,
          returnFrom: flight.trip === 'return' ? flight.to : null,
          returnTo: flight.trip === 'return' ? flight.from : null,
          handLuggageOnly: flight.handLuggage ?? false,
          notes: flight.notes ?? null,
        },
      },
    },
  };
}

export const seeder: Seeder = { name: 'travel requests, car classes', run: seedTravel };
