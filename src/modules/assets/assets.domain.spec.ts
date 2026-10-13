import { describe, expect, it } from 'vitest';
import {
  acceptanceDueAt,
  acceptanceDueDate,
  assetTag,
  isAcceptanceOverdue,
  overdueAssignedBefore,
  parseAssetTag,
} from './assets.domain';
import { withAssignees } from './services/asset-timeline';

const ZONE = 'Europe/Berlin';

describe('asset references', () => {
  it('formats and parses AST tags exactly', () => {
    expect(assetTag(87)).toBe('AST-00087');
    expect(parseAssetTag('AST-00087')).toBe(87);
    expect(parseAssetTag(' ast-87 ')).toBe(87);
    expect(parseAssetTag('AST-')).toBeNull();
    expect(parseAssetTag('00087')).toBeNull();
    expect(parseAssetTag('XAST-00087')).toBeNull();
  });
});

describe('acceptance due date (SPEC_RESOLUTIONS #23)', () => {
  // Assigned Friday 9 Oct 2026, 10:15 Berlin (08:15Z)
  const assignedAt = new Date('2026-10-09T08:15:00.000Z');

  it('is the assignment day + due days, 00:00 app time as UTC', () => {
    expect(acceptanceDueDate(assignedAt, 7, ZONE)).toBe('2026-10-16');
    expect(acceptanceDueAt(assignedAt, 7, ZONE).toISOString()).toBe('2026-10-15T22:00:00.000Z');
  });

  it('is overdue from the due day on', () => {
    expect(isAcceptanceOverdue(assignedAt, new Date('2026-10-15T21:59:59.000Z'), 7, ZONE)).toBe(false);
    expect(isAcceptanceOverdue(assignedAt, new Date('2026-10-15T22:00:00.000Z'), 7, ZONE)).toBe(true);
  });

  it('overdueAssignedBefore matches isAcceptanceOverdue for a given day', () => {
    const before = overdueAssignedBefore('2026-10-16', 7, ZONE);
    expect(before.toISOString()).toBe('2026-10-09T22:00:00.000Z');
    expect(assignedAt < before).toBe(true);
    expect(overdueAssignedBefore('2026-10-15', 7, ZONE) > assignedAt).toBe(false);
  });
});

describe('timeline assignee names', () => {
  it('adds the assignee to assign entries', () => {
    const entry = {
      id: '1',
      occurredAt: '2026-10-12T08:15:00.010Z',
      actor: null,
      actingAs: 'back_office' as const,
      entityType: 'asset',
      entityId: 'a1',
      entityLabel: 'AST-00118',
      action: 'assign',
      fromState: 'in_stock',
      toState: 'pending_acceptance',
      reason: null,
      changes: null,
      summary: 'Arne Assets assigned the device (back office)',
    };
    const [out] = withAssignees(
      [entry],
      [
        { assetId: 'a1', assignedAt: new Date('2025-01-01T00:00:00Z'), user: { displayName: 'Old Holder' } },
        { assetId: 'a1', assignedAt: new Date('2026-10-12T08:15:00.000Z'), user: { displayName: 'Emma Employee' } },
      ],
    );
    expect(out.summary).toBe('Arne Assets assigned the device to Emma Employee (back office)');
  });
});
