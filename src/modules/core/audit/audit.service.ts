import { Injectable } from '@nestjs/common';
import { toUserRefOrNull } from '@/common/domain/mappers';
import type { ActingAs, ModuleName } from '@/common/domain/vocabulary';
import { RequestContext } from '@/common/http/request-context';
import { PrismaService } from '@/database/prisma.service';
import type { PrismaTx } from '@/database/prisma.types';
import type { Prisma } from '@/generated/prisma/client';
import { AuditLabelRegistry } from './audit-label.registry';

/** Stored change entry (`label` is kept for timelines). Masked values are '•••'. */
export interface FieldChange {
  field: string;
  label: string;
  from: unknown;
  to: unknown;
}

export const MASK = '•••';

export interface AuditInput {
  module: ModuleName;
  /** snake_case, e.g. `training_attendee`. */
  entityType: string;
  entityId: string;
  /** Machine event, or create | update | delete | auto_approve | remind ... */
  action: string;
  actorId: string | null;
  actingAs: ActingAs;
  fromState?: string | null;
  toState?: string | null;
  reason?: string | null;
  changes?: FieldChange[] | null;
  metadata?: Record<string, unknown> | null;
  /** Shown in the audit log list, e.g. "Emma Employee" or "TRN-000123". */
  entityLabel?: string;
  occurredAt?: Date;
}

export interface TimelineEntryView {
  id: string;
  occurredAt: string;
  actor: ReturnType<typeof toUserRefOrNull>;
  actingAs: ActingAs;
  entityType: string;
  entityId: string;
  entityLabel: string;
  action: string;
  fromState: string | null;
  toState: string | null;
  reason: string | null;
  changes: FieldChange[] | null;
  summary: string;
}

/** Past-tense phrases for the timeline summary; unknown actions fall back to "<action>ed". */
const VERBS: Record<string, string> = {
  create: 'created',
  update: 'updated',
  delete: 'deleted',
  auto_approve: 'approved automatically',
  remind: 'sent a reminder',
  submit: 'submitted',
  withdraw: 'withdrew',
  approve: 'approved',
  decline: 'declined',
  book: 'booked',
  mark_booking_impossible: 'marked the booking as impossible',
  retry_booking: 'retried the booking',
  request_cancellation: 'requested cancellation',
  confirm_cancellation: 'confirmed the cancellation',
  reject_cancellation: 'rejected the cancellation',
  assign: 'assigned',
  unassign: 'unassigned',
  accept: 'accepted',
  return: 'recorded the return',
  send_to_repair: 'sent to repair',
  complete_repair: 'completed the repair',
  scrap: 'scrapped',
  start_work: 'started work',
  wait_internal: 'set to waiting (internal)',
  wait_on_requester: 'asked the requester',
  requester_replied: 'replied',
  resume: 'resumed',
  complete: 'completed',
  reject: 'rejected',
  cancel: 'cancelled',
  reopen: 'reopened',
  publish: 'published',
  schedule: 'scheduled',
  unschedule: 'unscheduled',
  auto_publish: 'published automatically',
  archive: 'archived',
  auto_expire: 'archived automatically',
  restore: 'restored',
  cost_center_sync: 'synced the cost centre',
  view_pin: 'viewed the PIN',
};

const ACTING_SUFFIX: Partial<Record<ActingAs, string>> = {
  deputy: ' (as deputy)',
  manager_chain: ' (as manager chain)',
  back_office: ' (back office)',
  admin: ' (as admin)',
};

/** "Max Manager approved (as deputy for Priya Raman)" style sentence. */
export function auditSummary(entry: {
  action: string;
  actingAs: ActingAs;
  actorName: string | null;
  metadata: Record<string, unknown> | null;
  reason: string | null;
  /** Phrase from the AuditLabelRegistry, if any. */
  verb?: string;
}): string {
  const actor = entry.actorName ?? 'System';
  const verb =
    entry.verb ?? VERBS[entry.action] ?? `${entry.action.replace(/_/g, ' ')}${entry.action.endsWith('e') ? 'd' : 'ed'}`;
  const onBehalf = typeof entry.metadata?.onBehalfOfName === 'string' ? entry.metadata.onBehalfOfName : null;
  const suffix =
    entry.actingAs === 'deputy' && onBehalf ? ` (as deputy for ${onBehalf})` : (ACTING_SUFFIX[entry.actingAs] ?? '');
  return `${actor} ${verb}${suffix}`;
}

/** Field-level diff for `update` audit rows. `masked` fields are recorded as '•••'. */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  labels: Partial<Record<keyof T & string, string>>,
  masked: readonly string[] = [],
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of Object.keys(labels) as (keyof T & string)[]) {
    if (!(field in after)) continue;
    const from = before[field];
    const to = after[field];
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    const hide = masked.includes(field);
    changes.push({ field, label: labels[field] ?? field, from: hide ? MASK : from, to: hide ? MASK : to });
  }
  return changes;
}

/** Append-only audit log (`audit_logs`) and per-resource timelines. */
@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly labels: AuditLabelRegistry,
  ) {}

  /**
   * Field diff for an `update` row using the registered labels and masked fields of
   * `entityType` (only registered fields are compared unless `fields` is given).
   */
  diff<T extends Record<string, unknown>>(
    entityType: string,
    before: T,
    after: Partial<T>,
    fields?: (keyof T & string)[],
  ): FieldChange[] {
    const registered = this.labels.get(entityType);
    const keys = fields ?? Object.keys(registered.fields ?? {});
    const labels = Object.fromEntries(keys.map((k) => [k, this.labels.fieldLabel(entityType, k)])) as Partial<
      Record<keyof T & string, string>
    >;
    return diffFields(before, after, labels, registered.masked ?? []);
  }

  /** Writes one audit row. Pass the transaction of the change it records. */
  async record(input: AuditInput, db: PrismaTx = this.prisma): Promise<void> {
    const metadata = { ...(input.metadata ?? {}), ...(input.entityLabel ? { entityLabel: input.entityLabel } : {}) };
    await db.auditLog.create({
      data: {
        occurredAt: input.occurredAt ?? new Date(),
        actorId: input.actorId,
        actingAs: input.actingAs,
        module: input.module,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        fromState: input.fromState ?? null,
        toState: input.toState ?? null,
        reason: input.reason ?? null,
        changes: (input.changes ?? undefined) as Prisma.InputJsonValue | undefined,
        metadata: Object.keys(metadata).length ? (metadata as Prisma.InputJsonValue) : undefined,
        correlationId: RequestContext.correlationId(),
      },
    });
  }

  /**
   * Timeline of one or more entities (e.g. a request and its attendees), oldest first.
   * `labelOf` names the entity of each row (defaults to the recorded entityLabel).
   */
  async timeline(
    entities: { entityType: string; entityId: string }[],
    labelOf?: (row: { entityType: string; entityId: string }) => string,
  ): Promise<TimelineEntryView[]> {
    if (entities.length === 0) return [];
    const rows = await this.prisma.auditLog.findMany({
      where: { OR: entities.map((e) => ({ entityType: e.entityType, entityId: e.entityId })) },
      include: { actor: true },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => this.toTimelineEntry(row, labelOf));
  }

  toTimelineEntry(
    row: Prisma.AuditLogGetPayload<{ include: { actor: true } }>,
    labelOf?: (row: { entityType: string; entityId: string }) => string,
  ): TimelineEntryView {
    const metadata = (row.metadata as Record<string, unknown> | null) ?? null;
    const recordedLabel = typeof metadata?.entityLabel === 'string' ? metadata.entityLabel : null;
    return {
      id: row.id,
      occurredAt: row.occurredAt.toISOString(),
      actor: toUserRefOrNull(row.actor),
      actingAs: row.actingAs,
      entityType: row.entityType,
      entityId: row.entityId,
      entityLabel:
        labelOf?.(row) ?? recordedLabel ?? this.labels.get(row.entityType).entity ?? row.entityType.replace(/_/g, ' '),
      action: row.action,
      fromState: row.fromState,
      toState: row.toState,
      reason: row.reason,
      changes:
        ((row.changes as FieldChange[] | null) ?? null)?.map((c) => ({
          ...c,
          label: c.label && c.label !== c.field ? c.label : this.labels.fieldLabel(row.entityType, c.field),
        })) ?? null,
      summary: auditSummary({
        action: row.action,
        actingAs: row.actingAs,
        actorName: row.actor?.displayName ?? null,
        metadata,
        reason: row.reason,
        verb: this.labels.actionPhrase(row.entityType, row.action),
      }),
    };
  }
}
