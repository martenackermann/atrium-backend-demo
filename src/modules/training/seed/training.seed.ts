import type { ActingAs, AutoApproval } from '@/common/domain/vocabulary';
import { addDaysIso, dateFromIso, isoDateInZone, startOfDayInZone } from '@/common/time/time';
import type { Seeder, SeedContext } from '@/database/seed/seed-context';
import type { Prisma } from '@/generated/prisma/client';
import { canDecide, OrgSnapshot, resolveApprover } from '@/modules/core/approvals/approval-rules';
import { approvalRequestedNotification } from '../mail/approval-requested.notification';
import { executiveApprovalRequestedNotification } from '../mail/executive-approval-requested.notification';
import { participationBookedNotification } from '../mail/participation-booked.notification';
import { participationCreatedNotification } from '../mail/participation-created.notification';
import { participationDeclinedNotification } from '../mail/participation-declined.notification';
import { planEntry } from '../services/training-entry.service';
import { formatDateRange, formatMoney, trainingReference } from '../training.constants';
import { demoPdf } from './demo-pdf';
import { type At, type StoryAttendee, type StoryRequest, TRAINING_STORY, TRAINING_STORY_NOTIFICATIONS } from './training-story.plan';

type Status = Prisma.TrainingAttendeeCreateManyInput['status'];

const REASON_LABEL: Record<string, string> = {
  direct_manager: 'Direct manager',
  site_manager_escalation: 'Escalated past site manager',
  manager_unavailable: 'Manager unavailable',
  executive_self: 'Executive self-approval',
  fallback: 'Fallback approver',
};

interface RatingState {
  id: string;
  loop: 1 | 2 | 3;
  raterId: string;
  dueAt: Date;
  createdAt: Date;
  submittedAt: Date | null;
  lastRemindedAt: Date | null;
  reminderCount: number;
  answers: Partial<Prisma.TrainingRatingCreateManyInput>;
}

interface SeededAttendee {
  id: string;
  spec: StoryAttendee;
  userId: string;
  name: string;
  status: Status;
  bookingReference: string | null;
  documentCount: number;
  declineReason: string | null;
  decidedBy: string | null;
}

/** Builds the org snapshot the core approval rules work on (same shape as ApprovalService.snapshot). */
async function orgSnapshot(ctx: SeedContext): Promise<OrgSnapshot> {
  const users = await ctx.prisma.user.findMany({
    select: {
      id: true,
      displayName: true,
      email: true,
      jobTitle: true,
      firstName: true,
      lastName: true,
      active: true,
      isSiteManager: true,
      managerId: true,
      roles: { where: { role: 'executive' }, select: { role: true } },
    },
  });
  const deputies = await ctx.prisma.deputy.findMany();
  return new OrgSnapshot(
    users.map(({ roles, ...u }) => ({ ...u, isExecutive: roles.length > 0 })),
    deputies.map((d) => ({
      principalId: d.principalId,
      deputyId: d.deputyId,
      validFrom: d.validFrom ? d.validFrom.toISOString().slice(0, 10) : null,
      validTo: d.validTo ? d.validTo.toISOString().slice(0, 10) : null,
    })),
  );
}

function isWeekend(iso: string): boolean {
  const day = new Date(`${iso}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * SPEC §10.2 training story (30 requests, 42 attendees) with coherent audit trails, rating rows,
 * documents and the persona notifications of these records (SPEC_RESOLUTIONS #7, #21).
 */
export async function seedTraining(ctx: SeedContext): Promise<void> {
  const { prisma, env } = ctx;
  const tz = env.APP_TIMEZONE;
  const org = await orgSnapshot(ctx);
  const ccOf = new Map(
    (await prisma.user.findMany({ select: { id: true, costCenterId: true } })).map((u) => [u.id, u.costCenterId]),
  );
  const uid = (handle: string) => ctx.users.get(handle).id;
  const name = (handle: string) => ctx.users.get(handle).displayName;
  const at = ([day, hh, mm]: At) => ctx.at(day, hh, mm);
  const localDate = (instant: Date) => isoDateInZone(instant, tz);
  /** Reminder time: 07:15 on the first weekday from `day` up to yesterday (else the day itself). */
  const remindAt = (day: number) => {
    for (let d = day; d <= -1; d++) if (!isWeekend(ctx.d(d))) return ctx.at(d, 7, 15);
    return ctx.at(day, 7, 15);
  };
  const threshold = env.TRAINING_EXECUTIVE_THRESHOLD_CENTS;

  const audits: Prisma.AuditLogCreateManyInput[] = [];
  const audit = (row: Omit<Prisma.AuditLogCreateManyInput, 'id' | 'correlationId' | 'module'> & { label: string }) => {
    const { label, ...rest } = row;
    audits.push({
      ...rest,
      id: ctx.uuid(row.occurredAt as Date),
      module: 'training',
      correlationId: 'seed',
      metadata: { ...((rest.metadata as object | undefined) ?? {}), entityLabel: label },
    });
  };
  const seeded = new Map<number, { request: StoryRequest; id: string; attendees: SeededAttendee[] }>();

  for (const spec of TRAINING_STORY) {
    const createdAt = at(spec.created);
    const requestId = ctx.uuid(createdAt);
    const requesterId = uid(spec.requester);
    const reference = trainingReference(spec.number);
    const execRequired = spec.costCents >= threshold;
    if (execRequired !== Boolean(spec.executive)) throw new Error(`${reference}: executive approver mismatch`);
    const executiveApproverId = spec.executive ? uid(spec.executive) : null;
    const startsOn = ctx.d(spec.startsOn);
    const endsOn = ctx.d(spec.endsOn);
    const requesterIsBackOffice = spec.requester === 'tina';

    await prisma.trainingRequest.create({
      data: {
        id: requestId,
        number: spec.number,
        topic: spec.topic,
        provider: spec.provider,
        format: spec.format,
        location: spec.location,
        registrationUrl: spec.registrationUrl ?? null,
        registrationDetails: spec.registrationDetails ?? null,
        startsOn: dateFromIso(startsOn),
        endsOn: dateFromIso(endsOn),
        costCents: spec.costCents,
        costCenterId: ccOf.get(requesterId)!,
        executiveApproverId,
        certificateExpected: spec.certificateExpected ?? false,
        reimbursementAgreement: spec.reimbursementAgreement ?? false,
        requesterComment: spec.comment ?? null,
        requesterId,
        createdAt,
        updatedAt: createdAt,
      },
    });
    audit({
      occurredAt: createdAt,
      actorId: requesterId,
      actingAs: requesterIsBackOffice ? 'back_office' : 'requester',
      entityType: 'training_request',
      entityId: requestId,
      action: 'create',
      metadata: { attendees: spec.attendees.length },
      label: reference,
    });
    if (spec.agenda) {
      await ctx.storeFile({
        content: demoPdf(spec.topic, [
          `Agenda - ${spec.provider}`,
          `${formatDateRange(startsOn, endsOn)} · ${spec.location ?? 'Online'}`,
          '09:00 Welcome and safety briefing',
          '10:30 Practical scenarios in small groups',
          '13:30 Assessment and certificates',
        ]),
        originalName: spec.agenda,
        mimeType: 'application/pdf',
        purpose: 'training_document',
        uploadedById: requesterId,
        createdAt: new Date(createdAt.getTime() + 60_000),
        entity: { type: 'training_request', id: requestId },
      });
    }

    const attendees: SeededAttendee[] = [];
    let lastActivity = createdAt;
    for (const [index, a] of spec.attendees.entries()) {
      const userId = uid(a.user);
      const label = name(a.user);
      const created = new Date(createdAt.getTime() + (index + 1) * 1000);
      const id = ctx.uuid(created);

      // Routing must match the core rules (SPEC §6.1) - the plan states it explicitly.
      const resolution = resolveApprover(org, userId, requesterId, env.FALLBACK_APPROVER_EMAIL);
      const plan = planEntry(org, userId, requesterId, executiveApproverId, env.FALLBACK_APPROVER_EMAIL);
      if (
        resolution.approver.id !== uid(a.approver) ||
        resolution.reason !== a.reason ||
        resolution.escalatedFromId !== (a.escalatedFrom ? uid(a.escalatedFrom) : null) ||
        plan.managerAuto !== (a.auto ?? null)
      ) {
        throw new Error(
          `${reference} ${a.user}: expected ${a.approver}/${a.reason}/${a.auto ?? '-'}, got ${resolution.approver.displayName}/${resolution.reason}/${plan.managerAuto ?? '-'}`,
        );
      }

      const row: Prisma.TrainingAttendeeCreateManyInput = {
        id,
        requestId,
        userId,
        costCenterId: ccOf.get(userId)!,
        status: plan.initialState,
        approverId: resolution.approver.id,
        approverReason: resolution.reason,
        escalatedFromId: resolution.escalatedFromId,
        executiveApproverId,
        hotelNeeded: Boolean(a.hotel),
        hotelCheckInOn: a.hotel ? dateFromIso(ctx.d(a.hotel.checkIn)) : null,
        hotelCheckOutOn: a.hotel ? dateFromIso(ctx.d(a.hotel.checkOut)) : null,
        hotelCostCents: a.hotel?.costCents ?? null,
        createdAt: created,
      };
      const autoBy = (auto: AutoApproval, approverId: string | null) => (auto === 'executive_self' ? userId : approverId);
      audit({
        occurredAt: created,
        actorId: requesterId,
        actingAs: userId === requesterId ? 'self' : requesterIsBackOffice ? 'back_office' : 'requester',
        entityType: 'training_attendee',
        entityId: id,
        action: 'create',
        toState: 'pending_manager_approval',
        metadata: { approverId: resolution.approver.id, approverReason: resolution.reason },
        label,
      });
      if (plan.managerAuto) {
        Object.assign(row, {
          managerDecisionAt: created,
          managerDecisionById: autoBy(plan.managerAuto, resolution.approver.id),
          managerDecisionAs: 'system',
          managerAutoApproval: plan.managerAuto,
        });
        audit({
          occurredAt: new Date(created.getTime() + 1),
          actorId: null,
          actingAs: 'system',
          entityType: 'training_attendee',
          entityId: id,
          action: 'auto_approve',
          fromState: 'pending_manager_approval',
          toState: plan.initialState,
          reason: plan.managerAuto,
          metadata: { step: 'manager', autoApproval: plan.managerAuto },
          label,
        });
      }
      if (plan.executiveAuto) {
        Object.assign(row, {
          executiveDecisionAt: created,
          executiveDecisionById: autoBy(plan.executiveAuto, executiveApproverId),
          executiveDecisionAs: 'system',
          executiveAutoApproval: plan.executiveAuto,
        });
        audit({
          occurredAt: new Date(created.getTime() + 2),
          actorId: null,
          actingAs: 'system',
          entityType: 'training_attendee',
          entityId: id,
          action: 'auto_approve',
          fromState: 'pending_executive_approval',
          toState: 'to_book',
          reason: plan.executiveAuto,
          metadata: { step: 'executive', autoApproval: plan.executiveAuto },
          label,
        });
      }

      let status: Status = plan.initialState;
      const ratings = new Map<number, RatingState>();
      const transitions: { action: string; occurredAt: Date; actorId: string | null; actingAs: ActingAs; to: Status; reason?: string | null }[] = [];
      const seededAttendee: SeededAttendee = {
        id,
        spec: a,
        userId,
        name: label,
        status,
        bookingReference: null,
        documentCount: 0,
        declineReason: null,
        decidedBy: null,
      };
      const selfOrRequester = (by: string): ActingAs => (uid(by) === userId ? 'self' : 'requester');
      const openRating = (loop: 1 | 2 | 3, raterId: string, createdAtRating: Date, dueOn: string) => {
        const rating: RatingState = {
          id: ctx.uuid(createdAtRating),
          loop,
          raterId,
          dueAt: startOfDayInZone(dueOn, tz),
          createdAt: createdAtRating,
          submittedAt: null,
          lastRemindedAt: null,
          reminderCount: 0,
          answers: {},
        };
        ratings.set(loop, rating);
        audit({
          occurredAt: new Date(createdAtRating.getTime() + 5),
          actorId: null,
          actingAs: 'system',
          entityType: 'training_rating',
          entityId: rating.id,
          action: 'create',
          metadata: { loop, dueOn },
          label: `Feedback round ${loop}`,
        });
      };

      for (const step of a.steps) {
        if (step.kind === 'remind') {
          const rating = ratings.get(step.loop);
          if (!rating) throw new Error(`${reference} ${a.user}: no loop ${step.loop} rating to remind`);
          const when = remindAt(step.day);
          rating.reminderCount++;
          rating.lastRemindedAt = when;
          audit({
            occurredAt: when,
            actorId: null,
            actingAs: 'system',
            entityType: 'training_rating',
            entityId: rating.id,
            action: 'remind',
            metadata: { loop: step.loop, reminder: rating.reminderCount, max: env.RATING_REMINDER_MAX },
            label: `Feedback round ${step.loop} · ${label}`,
          });
          continue;
        }
        const when = at(step.at);
        lastActivity = when > lastActivity ? when : lastActivity;
        switch (step.kind) {
          case 'approve':
          case 'decline': {
            const exec: boolean = status === 'pending_executive_approval';
            const approverId = exec ? executiveApproverId! : resolution.approver.id;
            const actingAs = canDecide(
              org,
              uid(step.by),
              { kind: exec ? 'executive' : 'manager', approverId, subjectId: userId },
              localDate(when),
            );
            if (!actingAs) throw new Error(`${reference} ${a.user}: ${step.by} may not decide`);
            const comment = step.kind === 'approve' ? (step.comment ?? null) : step.reason;
            const prefix = exec ? 'executive' : 'manager';
            Object.assign(row, {
              [`${prefix}DecisionAt`]: when,
              [`${prefix}DecisionById`]: uid(step.by),
              [`${prefix}DecisionAs`]: actingAs,
              [`${prefix}DecisionComment`]: comment,
            });
            seededAttendee.decidedBy = name(step.by);
            if (step.kind === 'decline') {
              row.declineReason = step.reason;
              seededAttendee.declineReason = step.reason;
              transitions.push({ action: 'decline', occurredAt: when, actorId: uid(step.by), actingAs, to: 'declined', reason: step.reason });
              status = 'declined';
              break;
            }
            const execFollows: boolean =
              !exec && executiveApproverId !== null && executiveApproverId !== uid(step.by) && executiveApproverId !== requesterId;
            const to: Status = execFollows ? 'pending_executive_approval' : 'to_book';
            transitions.push({ action: 'approve', occurredAt: when, actorId: uid(step.by), actingAs, to });
            if (!exec && !execFollows && executiveApproverId) {
              const auto: AutoApproval = executiveApproverId === uid(step.by) ? 'same_approver' : 'requester_is_approver';
              Object.assign(row, {
                executiveDecisionAt: when,
                executiveDecisionById: executiveApproverId,
                executiveDecisionAs: 'system',
                executiveAutoApproval: auto,
              });
              audit({
                occurredAt: new Date(when.getTime() + 1),
                actorId: null,
                actingAs: 'system',
                entityType: 'training_attendee',
                entityId: id,
                action: 'auto_approve',
                fromState: 'pending_executive_approval',
                toState: 'to_book',
                reason: auto,
                metadata: { step: 'executive', autoApproval: auto },
                label,
              });
            }
            status = to;
            break;
          }
          case 'withdraw':
            Object.assign(row, { cancelledAt: when, cancellationReason: step.reason ?? null });
            transitions.push({ action: 'withdraw', occurredAt: when, actorId: uid(step.by), actingAs: selfOrRequester(step.by), to: 'cancelled', reason: step.reason ?? null });
            status = 'cancelled';
            break;
          case 'book': {
            Object.assign(row, { bookedAt: when, bookedById: uid(step.by), bookingReference: step.reference });
            seededAttendee.bookingReference = step.reference;
            transitions.push({ action: 'book', occurredAt: when, actorId: uid(step.by), actingAs: 'back_office', to: 'booked' });
            status = 'booked';
            openRating(1, userId, when, addDaysIso(endsOn, env.RATING_LOOP1_DELAY_DAYS));
            if (step.document) {
              await ctx.storeFile({
                content: demoPdf('Demo booking confirmation', [
                  `${spec.topic} - ${spec.provider}`,
                  `Attendee: ${label}`,
                  `Dates: ${formatDateRange(startsOn, endsOn)}`,
                  `Booking reference: ${step.reference}`,
                ]),
                originalName: `Booking-${step.reference}.pdf`,
                mimeType: 'application/pdf',
                purpose: 'training_booking_document',
                uploadedById: uid(step.by),
                createdAt: new Date(when.getTime() - 60_000),
                entity: { type: 'training_attendee', id },
              });
              seededAttendee.documentCount++;
            }
            break;
          }
          case 'mark_booking_impossible':
            row.bookingImpossibleReason = step.reason;
            transitions.push({ action: 'mark_booking_impossible', occurredAt: when, actorId: uid(step.by), actingAs: 'back_office', to: 'booking_impossible', reason: step.reason });
            status = 'booking_impossible';
            break;
          case 'request_cancellation':
            Object.assign(row, { statusBeforeCancellation: status, cancellationRequestedAt: when, cancellationReason: step.reason });
            transitions.push({ action: 'request_cancellation', occurredAt: when, actorId: uid(step.by), actingAs: selfOrRequester(step.by), to: 'cancellation_requested', reason: step.reason });
            status = 'cancellation_requested';
            break;
          case 'confirm_cancellation': {
            row.cancelledAt = when;
            transitions.push({ action: 'confirm_cancellation', occurredAt: when, actorId: uid(step.by), actingAs: 'back_office', to: 'cancelled' });
            status = 'cancelled';
            const loop1 = ratings.get(1);
            if (loop1 && !loop1.submittedAt) ratings.delete(1);
            break;
          }
          case 'rate1': {
            const rating = ratings.get(1)!;
            const { participated, grades, comment } = step.answers;
            rating.submittedAt = when;
            rating.answers = {
              participated,
              overallGrade: participated ? grades![0] : null,
              trainerGrade: participated ? grades![1] : null,
              expectationsGrade: participated ? grades![2] : null,
              comment: comment ?? null,
            };
            audit({ occurredAt: when, actorId: userId, actingAs: 'self', entityType: 'training_rating', entityId: rating.id, action: 'submit', metadata: { loop: 1 }, label: `Feedback round 1 · ${label}` });
            const to: Status = participated ? 'attended' : 'not_attended';
            transitions.push({ action: 'submit_rating_1', occurredAt: new Date(when.getTime() + 1), actorId: userId, actingAs: 'self', to });
            status = to;
            if (participated) openRating(2, userId, when, addDaysIso(localDate(when), env.RATING_LOOP2_DELAY_DAYS));
            break;
          }
          case 'rate2': {
            const rating = ratings.get(2)!;
            const [applies, supported, worthwhile] = step.answers.answers;
            rating.submittedAt = when;
            rating.answers = {
              appliesLearned: applies,
              supervisorSupported: supported,
              worthwhileForOrganization: worthwhile,
              comment: step.answers.comment ?? null,
            };
            audit({ occurredAt: when, actorId: userId, actingAs: 'self', entityType: 'training_rating', entityId: rating.id, action: 'submit', metadata: { loop: 2 }, label: `Feedback round 2 · ${label}` });
            const manager = org.manager(org.require(userId));
            if (manager?.active) openRating(3, manager.id, when, addDaysIso(localDate(when), env.RATING_LOOP3_DELAY_DAYS));
            break;
          }
          case 'rate3': {
            const rating = ratings.get(3)!;
            rating.submittedAt = when;
            rating.answers = {
              improvementObserved: step.answers.improvement,
              certificationGained: step.answers.certification,
              certificationComment: step.answers.certificationComment ?? null,
              comment: step.answers.comment ?? null,
            };
            audit({ occurredAt: when, actorId: rating.raterId, actingAs: 'self', entityType: 'training_rating', entityId: rating.id, action: 'submit', metadata: { loop: 3 }, label: `Feedback round 3 · ${label}` });
            break;
          }
        }
      }

      let from: Status = plan.initialState;
      for (const t of transitions) {
        audit({
          occurredAt: t.occurredAt,
          actorId: t.actorId,
          actingAs: t.actingAs,
          entityType: 'training_attendee',
          entityId: id,
          action: t.action,
          fromState: from,
          toState: t.to,
          reason: t.reason ?? null,
          label,
        });
        from = t.to;
      }

      if (a.goals) {
        const goalsAt = new Date((row.bookedAt ? (row.bookedAt as Date) : created).getTime() + 2 * 3_600_000);
        Object.assign(row, { goal1: a.goals[0], goal2: a.goals[1], goalsUpdatedAt: goalsAt });
        audit({
          occurredAt: goalsAt,
          actorId: userId,
          actingAs: 'self',
          entityType: 'training_attendee',
          entityId: id,
          action: 'update_goals',
          changes: [
            { field: 'goal1', label: 'Goal 1', from: null, to: a.goals[0] },
            ...(a.goals[1] ? [{ field: 'goal2', label: 'Goal 2', from: null, to: a.goals[1] }] : []),
          ],
          label,
        });
      }

      row.status = status;
      row.version = 1 + transitions.length + (a.goals ? 1 : 0);
      row.updatedAt = transitions.at(-1)?.occurredAt ?? created;
      await prisma.trainingAttendee.create({ data: row as Prisma.TrainingAttendeeUncheckedCreateInput });
      for (const rating of ratings.values()) {
        await prisma.trainingRating.create({
          data: {
            id: rating.id,
            attendeeId: id,
            loop: rating.loop,
            raterId: rating.raterId,
            dueAt: rating.dueAt,
            submittedAt: rating.submittedAt,
            lastRemindedAt: rating.lastRemindedAt,
            reminderCount: rating.reminderCount,
            createdAt: rating.createdAt,
            ...rating.answers,
          },
        });
      }
      seededAttendee.status = status;
      attendees.push(seededAttendee);
    }

    // Back-office billing on requests with booked or attended attendees (SPEC §10.2).
    if (spec.billing && spec.billing.status !== 'open') {
      const billable = attendees.filter((a) => a.bookingReference && a.status !== 'cancelled').length;
      const actual =
        spec.billing.status === 'free_of_charge'
          ? 0
          : Math.round(spec.costCents * billable * (spec.billing.actualFactor ?? 1));
      const when = new Date(lastActivity.getTime() + 3 * 86_400_000);
      const billedAt = when.getTime() > ctx.at(0, 6, 0).getTime() ? ctx.at(-1, 16, 0) : when;
      await prisma.trainingRequest.update({
        where: { id: requestId },
        data: {
          billingStatus: spec.billing.status,
          actualCostCents: actual,
          backOfficeComment: spec.billing.comment ?? null,
          version: 2,
          updatedAt: billedAt,
        },
      });
      audit({
        occurredAt: billedAt,
        actorId: uid('tina'),
        actingAs: 'back_office',
        entityType: 'training_request',
        entityId: requestId,
        action: 'update_back_office',
        changes: [
          { field: 'billingStatus', label: 'Billing status', from: 'open', to: spec.billing.status },
          { field: 'actualCostCents', label: 'Actual cost', from: null, to: actual },
        ],
        label: reference,
      });
    }
    seeded.set(spec.number, { request: spec, id: requestId, attendees });
  }

  // Story records carry explicit reference numbers; new requests continue after them.
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('training_requests', 'number'), (SELECT MAX(number) FROM training_requests))`,
  );
  await prisma.auditLog.createMany({ data: audits });

  // In-app notifications of the story records, rendered with the real templates.
  for (const n of TRAINING_STORY_NOTIFICATIONS) {
    const entry = seeded.get(n.request)!;
    const spec = entry.request;
    const attendee = entry.attendees.find((a) => a.spec.user === n.attendee)!;
    const base = {
      attendeeId: attendee.id,
      attendee: attendee.name,
      topic: spec.topic,
      reference: trainingReference(spec.number),
      provider: spec.provider,
      dates: formatDateRange(ctx.d(spec.startsOn), ctx.d(spec.endsOn), ctx.today),
    };
    const approverName = name(attendee.spec.approver);
    const rendered = (() => {
      switch (n.template) {
        case 'training.participation_created': {
          const c = {
            ...base,
            requester: name(spec.requester),
            nextStep: attendee.spec.auto ? 'Approved automatically. The training office books it next.' : `${approverName} decides next.`,
            approver: attendee.spec.auto === 'executive_self' ? null : approverName,
            approverReason: attendee.spec.auto === 'executive_self' ? null : REASON_LABEL[attendee.spec.reason],
          };
          return { t: participationCreatedNotification, c };
        }
        case 'training.participation_booked':
          return {
            t: participationBookedNotification,
            c: { ...base, bookingReference: attendee.bookingReference, comment: null, documentCount: attendee.documentCount },
          };
        case 'training.participation_declined':
          return {
            t: participationDeclinedNotification,
            c: { ...base, decider: attendee.decidedBy ?? approverName, reason: attendee.declineReason ?? '' },
          };
        case 'training.approval_requested':
          return {
            t: approvalRequestedNotification,
            c: {
              ...base,
              approver: approverName,
              requester: name(spec.requester),
              cost: formatMoney(spec.costCents),
              escalationNote: attendee.spec.escalatedFrom
                ? `Escalated to you because ${name(attendee.spec.escalatedFrom)} is a site manager.`
                : null,
              executiveNote: spec.executive ? `Executive approval by ${name(spec.executive)} follows.` : null,
            },
          };
        case 'training.executive_approval_requested':
          return {
            t: executiveApprovalRequestedNotification,
            c: {
              ...base,
              cost: formatMoney(spec.costCents),
              threshold: formatMoney(threshold),
              managerDecision: `Approved by ${attendee.decidedBy ?? approverName}.`,
            },
          };
        default:
          throw new Error(`Unknown story notification ${n.template}`);
      }
    })();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = rendered.t as any;
    const createdAt = at(n.at);
    await prisma.notification.create({
      data: {
        id: ctx.uuid(createdAt),
        userId: uid(n.to),
        templateId: n.template,
        module: 'training',
        title: String(t.subject(rendered.c)).slice(0, 140),
        body: String(t.body(rendered.c)).slice(0, 500),
        link: t.link?.(rendered.c) ?? null,
        priority: 'normal',
        entityType: 'training_attendee',
        entityId: attendee.id,
        readAt: n.read ? new Date(createdAt.getTime() + 3 * 3_600_000) : null,
        createdAt,
      },
    });
  }

  const attendeeCount = [...seeded.values()].reduce((sum, r) => sum + r.attendees.length, 0);
  ctx.log(`training: ${seeded.size} requests, ${attendeeCount} attendees, ${audits.length} audit rows`);
}

export const seeder: Seeder = { name: 'training story records (SPEC §10.2)', run: seedTraining };
