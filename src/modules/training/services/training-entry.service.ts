import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import type { ActingAs, AutoApproval } from '@/common/domain/vocabulary';
import { type FieldErrors } from '@/common/http/problem';
import { Clock } from '@/common/time/clock.service';
import { addDaysIso, dateFromIso, type IsoDate } from '@/common/time/time';
import { AppConfig } from '@/config/app-config';
import type { PrismaTx } from '@/database/prisma.types';
import { type ApproverResolution, type OrgSnapshot, resolveApprover } from '@/modules/core/approvals/approval-rules';
import { AuditService } from '@/modules/core/audit/audit.service';
import type { AttendeeInput } from '../dto/training-request.dto';
import type { AttendeeStatus } from '../training.constants';
import type { TrainingViewer } from './training-access.service';
import { TrainingNotifier } from './training-notifier.service';
import { attendeeInclude, type AttendeeRow } from './training.includes';

/** How a new participation enters the lifecycle (SPEC §5.1 entry table). */
export interface EntryPlan {
  resolution: ApproverResolution;
  initialState: Extract<AttendeeStatus, 'pending_manager_approval' | 'pending_executive_approval' | 'to_book'>;
  managerAuto: AutoApproval | null;
  executiveAuto: AutoApproval | null;
  /** Executive approver of this participation (null when the step is not required). */
  executiveApproverId: string | null;
}

/**
 * Pure entry rules. Order (SPEC §5.1): executive attendee -> both steps auto; requester is the
 * resolved approver -> manager step auto, then the executive step is auto too when the executive
 * approver is the requester (same_approver) or not required; otherwise pending manager approval.
 */
export function planEntry(
  org: OrgSnapshot,
  attendeeId: string,
  requesterId: string,
  executiveApproverId: string | null,
  fallbackEmail: string,
): EntryPlan {
  const resolution = resolveApprover(org, attendeeId, requesterId, fallbackEmail);
  const execRequired = executiveApproverId !== null;
  if (resolution.reason === 'executive_self') {
    return {
      resolution,
      initialState: 'to_book',
      managerAuto: 'executive_self',
      executiveAuto: execRequired ? 'executive_self' : null,
      executiveApproverId,
    };
  }
  if (resolution.auto === 'requester_is_approver') {
    if (!execRequired) {
      return {
        resolution,
        initialState: 'to_book',
        managerAuto: 'requester_is_approver',
        executiveAuto: null,
        executiveApproverId,
      };
    }
    if (executiveApproverId === requesterId) {
      return {
        resolution,
        initialState: 'to_book',
        managerAuto: 'requester_is_approver',
        executiveAuto: 'same_approver',
        executiveApproverId,
      };
    }
    return {
      resolution,
      initialState: 'pending_executive_approval',
      managerAuto: 'requester_is_approver',
      executiveAuto: null,
      executiveApproverId,
    };
  }
  return {
    resolution,
    initialState: 'pending_manager_approval',
    managerAuto: null,
    executiveAuto: null,
    executiveApproverId,
  };
}

export interface RequestDates {
  startsOn: IsoDate;
  endsOn: IsoDate;
}

/**
 * Creates participations (request create and `POST .../attendees`): validation of attendee
 * inputs, entry plan, row + audit trail + entry notifications, all in the caller's transaction.
 */
@Injectable()
export class TrainingEntryService {
  constructor(
    private readonly audit: AuditService,
    private readonly notifier: TrainingNotifier,
    private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  plan(org: OrgSnapshot, attendeeId: string, requesterId: string, executiveApproverId: string | null): EntryPlan {
    return planEntry(org, attendeeId, requesterId, executiveApproverId, this.config.get('FALLBACK_APPROVER_EMAIL'));
  }

  /**
   * Validates attendee inputs (SPEC §6.4 "creating for others", active users, cost centres,
   * hotel window startsOn-2 ... endsOn+2). Returns field errors keyed `${prefix}${i}.field`.
   */
  async validateAttendees(
    tx: PrismaTx,
    inputs: AttendeeInput[],
    viewer: TrainingViewer,
    dates: RequestDates,
    prefix = 'attendees.',
    indexed = true,
  ): Promise<FieldErrors> {
    const errors: FieldErrors = {};
    const add = (i: number, field: string, message: string) => {
      const key = `${prefix}${indexed ? `${i}.` : ''}${field}`;
      (errors[key] ??= []).push(message);
    };
    const costCenterIds = inputs.map((a) => a.costCenterId).filter((id): id is string => !!id);
    const costCenters = costCenterIds.length
      ? await tx.costCenter.findMany({ where: { id: { in: costCenterIds } }, select: { id: true, active: true } })
      : [];
    const minHotel = addDaysIso(dates.startsOn, -2);
    const maxHotel = addDaysIso(dates.endsOn, 2);

    inputs.forEach((input, i) => {
      const user = viewer.org.get(input.userId);
      if (!user) add(i, 'userId', 'This person does not exist.');
      else if (!user.active) add(i, 'userId', `${user.displayName} is no longer active.`);
      else if (!viewer.mayActFor(input.userId)) add(i, 'userId', 'You can only request for yourself or your team');
      if (input.costCenterId) {
        const cc = costCenters.find((c) => c.id === input.costCenterId);
        if (!cc || !cc.active) add(i, 'costCenterId', 'Pick an active cost centre.');
      }
      if (input.hotel) {
        const { checkInOn, checkOutOn } = input.hotel;
        if (checkOutOn < checkInOn) add(i, 'hotel.checkOutOn', 'The check-out is before the check-in.');
        if (checkInOn < minHotel || checkInOn > maxHotel)
          add(i, 'hotel.checkInOn', `Check in between ${minHotel} and ${maxHotel} (two days around the training).`);
        if (checkOutOn < minHotel || checkOutOn > maxHotel)
          add(i, 'hotel.checkOutOn', `Check out between ${minHotel} and ${maxHotel} (two days around the training).`);
      }
    });
    return errors;
  }

  /** Creates one participation with its entry state, audit rows and notifications. */
  async create(
    tx: PrismaTx,
    params: {
      requestId: string;
      input: AttendeeInput;
      requester: AuthUser;
      viewer: TrainingViewer;
      executiveApproverId: string | null;
      /** actingAs of the creator on the audit rows. */
      actingAs: ActingAs;
    },
  ): Promise<AttendeeRow> {
    const { input, requester, viewer } = params;
    const plan = this.plan(viewer.org, input.userId, requester.id, params.executiveApproverId);
    const user = viewer.org.require(input.userId);
    const now = this.clock.now();
    const userRow = await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: { costCenterId: true } });
    const managerAutoBy = plan.managerAuto === 'executive_self' ? input.userId : plan.resolution.approver.id;
    const executiveAutoBy = plan.executiveAuto === 'executive_self' ? input.userId : plan.executiveApproverId;

    const created = await tx.trainingAttendee.create({
      data: {
        requestId: params.requestId,
        userId: input.userId,
        costCenterId: input.costCenterId ?? userRow.costCenterId,
        status: plan.initialState,
        approverId: plan.resolution.approver.id,
        approverReason: plan.resolution.reason,
        escalatedFromId: plan.resolution.escalatedFromId,
        executiveApproverId: plan.executiveApproverId,
        hotelNeeded: input.hotel !== null,
        hotelCheckInOn: input.hotel ? dateFromIso(input.hotel.checkInOn) : null,
        hotelCheckOutOn: input.hotel ? dateFromIso(input.hotel.checkOutOn) : null,
        hotelCostCents: input.hotel?.cost?.amountCents ?? null,
        ...(plan.managerAuto
          ? {
              managerDecisionAt: now,
              managerDecisionById: managerAutoBy,
              managerDecisionAs: 'system' as const,
              managerAutoApproval: plan.managerAuto,
            }
          : {}),
        ...(plan.executiveAuto
          ? {
              executiveDecisionAt: now,
              executiveDecisionById: executiveAutoBy,
              executiveDecisionAs: 'system' as const,
              executiveAutoApproval: plan.executiveAuto,
            }
          : {}),
      },
    });

    const base = {
      module: 'training' as const,
      entityType: 'training_attendee',
      entityId: created.id,
      entityLabel: user.displayName,
      occurredAt: now,
    };
    await this.audit.record(
      {
        ...base,
        action: 'create',
        actorId: requester.id,
        actingAs: params.actingAs,
        toState: 'pending_manager_approval',
        metadata: {
          approverId: plan.resolution.approver.id,
          approverReason: plan.resolution.reason,
          escalatedFromId: plan.resolution.escalatedFromId,
        },
      },
      tx,
    );
    if (plan.managerAuto) {
      await this.audit.record(
        {
          ...base,
          action: 'auto_approve',
          actorId: null,
          actingAs: 'system',
          fromState: 'pending_manager_approval',
          toState: plan.initialState === 'pending_executive_approval' ? 'pending_executive_approval' : 'to_book',
          reason: plan.managerAuto,
          metadata: { step: 'manager', autoApproval: plan.managerAuto },
        },
        tx,
      );
    }
    if (plan.executiveAuto) {
      await this.audit.record(
        {
          ...base,
          action: 'auto_approve',
          actorId: null,
          actingAs: 'system',
          fromState: 'pending_executive_approval',
          toState: 'to_book',
          reason: plan.executiveAuto,
          metadata: { step: 'executive', autoApproval: plan.executiveAuto },
        },
        tx,
      );
    }

    const row = await tx.trainingAttendee.findUniqueOrThrow({ where: { id: created.id }, include: attendeeInclude });
    await this.notifier.onEntry(tx, row);
    return row;
  }
}
