import type { TimelineEntryView } from '@/modules/core/audit/audit.service';
import { ASSET_AUDIT_LABELS } from '../assets.enums';

const ASSIGN_PHRASE = ASSET_AUDIT_LABELS.asset.actions?.assign ?? 'assigned the device';
/** Audit rows are written right after the assignment row; allow for that gap. */
const MATCH_WINDOW_MS = 5_000;

interface AssignmentStamp {
  assetId: string;
  assignedAt: Date;
  user: { displayName: string };
}

/**
 * The audit row of `assign` does not name the assignee, so timelines add it from the
 * assignment history: "Arne Assets assigned the device to Emma Employee (back office)".
 */
export function withAssignees<T extends TimelineEntryView>(entries: T[], assignments: AssignmentStamp[]): T[] {
  const byAsset = new Map<string, AssignmentStamp[]>();
  for (const a of [...assignments].sort((x, y) => x.assignedAt.getTime() - y.assignedAt.getTime())) {
    const list = byAsset.get(a.assetId) ?? [];
    list.push(a);
    byAsset.set(a.assetId, list);
  }
  return entries.map((entry) => {
    if (entry.action !== 'assign' || entry.entityType !== 'asset') return entry;
    const at = new Date(entry.occurredAt).getTime() + MATCH_WINDOW_MS;
    const match = (byAsset.get(entry.entityId) ?? []).filter((a) => a.assignedAt.getTime() <= at).at(-1);
    if (!match || !entry.summary.includes(ASSIGN_PHRASE)) return entry;
    return { ...entry, summary: entry.summary.replace(ASSIGN_PHRASE, `${ASSIGN_PHRASE} to ${match.user.displayName}`) };
  });
}
