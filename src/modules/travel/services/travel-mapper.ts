import type { z } from 'zod';
import { toRef, toUserRef, toUserRefOrNull } from '@/common/domain/mappers';
import type { Address } from '@/common/domain/schemas';
import { isoFromDate } from '@/common/time/time';
import type { AttachmentView } from '@/modules/core/attachments/attachment.service';
import { isHighPriority } from '../domain/travel-rules';
import type { travelRequestDetailSchema, travelRequestSummarySchema } from '../dto/travel-request.dto';
import {
  APPROVAL_EXEMPTION_LABELS,
  APPROVAL_REASON_LABELS,
  type ApprovalReasonCode,
  type TravelAction,
  travelReference,
} from '../travel.constants';
import type { TravelRow, TravelSummaryRow } from './travel-row';

export type TravelSummaryView = z.infer<typeof travelRequestSummarySchema>;
export type TravelDetailView = z.infer<typeof travelRequestDetailSchema>;

export interface MapOptions {
  now: Date;
  highPriorityDays: number;
  availableActions: TravelAction[];
  actingAs: TravelSummaryView['actingAs'];
}

export const reasonDtos = (codes: readonly ApprovalReasonCode[]) =>
  codes.map((code) => ({ code, label: APPROVAL_REASON_LABELS[code] }));

export function toSummary(row: TravelSummaryRow | TravelRow, options: MapOptions): TravelSummaryView {
  return {
    id: row.id,
    reference: travelReference(row.number),
    kind: row.kind,
    status: row.status,
    traveller: toUserRef(row.traveller),
    requester: toUserRef(row.requester),
    approver: toUserRefOrNull(row.approver),
    approverReason: row.approverReason,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    route: row.routeSummary,
    needsApproval: row.needsApproval,
    approvalReasons: reasonDtos(row.approvalReasons),
    approvalExemption: row.approvalExemption
      ? { code: row.approvalExemption, label: APPROVAL_EXEMPTION_LABELS[row.approvalExemption] }
      : null,
    isHighPriority: isHighPriority(row.status, row.startsAt, options.now, options.highPriorityDays),
    actingAs: options.actingAs,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    availableActions: options.availableActions,
  };
}

function address(prefix: 'handover' | 'dropOff', car: NonNullable<TravelRow['car']>): Address | null {
  const street = car[`${prefix}Street`];
  if (!street) return null;
  return {
    street,
    houseNumber: car[`${prefix}HouseNumber`] ?? '',
    postalCode: car[`${prefix}PostalCode`] ?? '',
    city: car[`${prefix}City`] ?? '',
    countryCode: car[`${prefix}CountryCode`] ?? '',
  };
}

function decision(row: TravelRow): TravelDetailView['approval'] {
  if (row.approvedAt) {
    return {
      at: row.approvedAt.toISOString(),
      by: toUserRefOrNull(row.approvedBy),
      actingAs: row.approvalActingAs ?? 'approver',
      autoApproval: row.approvalAutoApproval,
      comment: row.approvalComment,
    };
  }
  if (row.declinedAt) {
    return {
      at: row.declinedAt.toISOString(),
      by: toUserRefOrNull(row.declinedBy),
      actingAs: row.declinedActingAs ?? 'approver',
      autoApproval: null,
      comment: null,
    };
  }
  return null;
}

export function toDetail(
  row: TravelRow,
  options: MapOptions & { showDriver: boolean; bookingAttachments: AttachmentView[] },
): TravelDetailView {
  const car = row.car;
  return {
    ...toSummary(row, options),
    escalatedFrom: toUserRefOrNull(row.escalatedFrom),
    approverSelection: row.approverSelection,
    costCenter: toRef(row.costCenter),
    costCenterReason: row.costCenterReason,
    recharge:
      row.rechargeCustomer && row.rechargeProjectNumber
        ? { customer: row.rechargeCustomer, projectNumber: row.rechargeProjectNumber }
        : null,
    comment: row.comment,
    car: car
      ? {
          vehicleType: car.vehicleType,
          carClass: {
            id: car.carClass.id,
            code: car.carClass.code,
            name: car.carClass.name,
            isDefault: car.carClass.isDefault,
          },
          pickupAt: car.pickupAt.toISOString(),
          returnAt: car.returnAt.toISOString(),
          destination: car.destination,
          equipment: {
            estate: car.estate,
            navigation: car.navigation,
            automaticPreferred: car.automaticPreferred,
            automaticRequired: car.automaticRequired,
            diesel: car.diesel,
            winterTyres: car.winterTyres,
            foreignTravel: car.foreignTravel,
            childSeat: car.childSeat,
          },
          foreignCountries: car.foreignCountries,
          expectedKmPerDay: car.expectedKmPerDay,
          minPayloadKg: car.minPayloadKg,
          handover: { mode: car.handoverMode, branch: car.handoverBranch, address: address('handover', car) },
          dropOff: { mode: car.dropOffMode, branch: car.dropOffBranch, address: address('dropOff', car) },
          driver: options.showDriver
            ? {
                firstName: car.driverFirstName,
                lastName: car.driverLastName,
                email: car.driverEmail,
                phone: car.driverPhone,
                birthDate: isoFromDate(car.driverBirthDate),
                licenceNumber: car.driverLicenceNumber,
                additionalDrivers: car.additionalDrivers,
              }
            : null,
          specialEquipmentReason: car.specialEquipmentReason,
        }
      : null,
    train: row.train
      ? {
          tripType: row.train.tripType,
          outboundAt: row.train.outboundAt.toISOString(),
          returnAt: row.train.returnAt?.toISOString() ?? null,
          fromStation: row.train.fromStation,
          viaStation: row.train.viaStation,
          toStation: row.train.toStation,
          fareType: row.train.fareType,
          seatReservations: row.train.seatReservations,
          separateTickets: row.train.separateTickets,
          localTransportTicket: row.train.localTransportTicket,
          companions: row.companions.map((c) => toUserRef(c.user)),
          notes: row.train.notes,
        }
      : null,
    flight: row.flight
      ? {
          tripType: row.flight.tripType,
          outboundDepartureAt: row.flight.outboundDepartureAt.toISOString(),
          outboundFrom: row.flight.outboundFrom,
          outboundTo: row.flight.outboundTo,
          returnDepartureAt: row.flight.returnDepartureAt?.toISOString() ?? null,
          returnFrom: row.flight.returnFrom,
          returnTo: row.flight.returnTo,
          handLuggageOnly: row.flight.handLuggageOnly,
          notes: row.flight.notes,
        }
      : null,
    approval: decision(row),
    declinedAt: row.declinedAt?.toISOString() ?? null,
    declineReason: row.declineReason,
    bookingImpossibleReason: row.bookingImpossibleReason,
    cancellationRequestedAt: row.cancellationRequestedAt?.toISOString() ?? null,
    cancellationReason: row.cancellationReason,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    booking: row.booking
      ? {
          bookingNumber: row.booking.bookingNumber,
          pinAvailable: !!row.booking.pinEncrypted,
          comment: row.booking.comment,
          bookedBy: toUserRef(row.booking.bookedBy),
          bookedAt: row.booking.bookedAt.toISOString(),
          attachments: options.bookingAttachments,
        }
      : null,
    version: row.version,
  };
}
