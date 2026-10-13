import { describe, expect, it } from 'vitest';
import {
  activeAncestors,
  activeDeputiesOf,
  type ApprovalStepKind,
  canDecide,
  type DeputyWindow,
  isActiveDeputy,
  OrgSnapshot,
  type OrgUser,
  principalsOf,
  reportingTree,
  resolveApprover,
} from './approval-rules';

const FALLBACK = 'clara.ceo@example.com';

function user(id: string, managerId: string | null, extra: Partial<OrgUser> = {}): OrgUser {
  return {
    id,
    displayName: id,
    email: `${id}@example.com`,
    jobTitle: null,
    active: true,
    isSiteManager: false,
    isExecutive: false,
    managerId,
    ...extra,
  };
}

// 11 inactive managers in a row: the hop limit (10) ends on an inactive user.
const longChain = Array.from({ length: 11 }, (_, i) =>
  user(`gone${i + 1}`, i === 10 ? 'max' : `gone${i + 2}`, { active: false }),
);

const users: OrgUser[] = [
  user('clara', null, { email: FALLBACK, isExecutive: true }),
  user('helen', 'clara', { isExecutive: true }),
  user('oldExec', 'clara', { isExecutive: true, active: false }),
  user('max', 'clara'),
  user('sofia', 'max', { isSiteManager: true }),
  user('emma', 'max'),
  user('hilTech', 'sofia'),
  user('priya', 'clara'),
  user('sdkAgent', 'priya'),
  user('gone', 'max', { active: false }),
  user('orphan', 'gone'),
  user('goneTwice', 'gone', { active: false }),
  user('deepOrphan', 'goneTwice'),
  ...longChain,
  user('veryDeep', 'gone1'),
  user('eastLead', 'max'),
  user('eastTech', 'eastLead'),
  user('loneSite', null, { isSiteManager: true }),
  user('loneSiteReport', 'loneSite'),
  user('loner', null),
  user('inactiveDeputy', 'max', { active: false }),
  user('ian', 'clara'), // it_admin in the demo; roles never grant approval rights
];

const TODAY = '2026-10-13';
const deputies: DeputyWindow[] = [
  { principalId: 'priya', deputyId: 'max', validFrom: '2026-10-11', validTo: '2026-10-25' }, // S-D1: active
  { principalId: 'max', deputyId: 'sofia', validFrom: '2026-10-20', validTo: '2026-11-03' }, // S-D2: upcoming
  { principalId: 'clara', deputyId: 'helen', validFrom: null, validTo: null }, // S-D3: permanent
  { principalId: 'eastLead', deputyId: 'emma', validFrom: '2026-09-01', validTo: '2026-09-30' }, // expired
  { principalId: 'max', deputyId: 'inactiveDeputy', validFrom: null, validTo: null }, // inactive deputy
  { principalId: 'oldExec', deputyId: 'helen', validFrom: null, validTo: null }, // deactivated principal
];

const org = new OrgSnapshot(users, deputies);
const step = (kind: ApprovalStepKind, approverId: string, subjectId: string) => ({ kind, approverId, subjectId });

describe('resolveApprover (SPEC §6.1 + SPEC_RESOLUTIONS #2, #12)', () => {
  it('returns the direct manager', () => {
    expect(resolveApprover(org, 'emma', 'emma', FALLBACK)).toMatchObject({
      approver: { id: 'max' },
      reason: 'direct_manager',
      auto: null,
      escalatedFromId: null,
    });
  });

  it('escalates past a site manager and reports whom it skipped', () => {
    expect(resolveApprover(org, 'hilTech', 'sofia', FALLBACK)).toMatchObject({
      approver: { id: 'max' },
      reason: 'site_manager_escalation',
      auto: null,
      escalatedFromId: 'sofia',
    });
  });

  it('skips inactive managers and keeps walking up', () => {
    expect(resolveApprover(org, 'orphan', 'orphan', FALLBACK)).toMatchObject({
      approver: { id: 'max' },
      reason: 'manager_unavailable',
    });
    expect(resolveApprover(org, 'deepOrphan', 'deepOrphan', FALLBACK)).toMatchObject({
      approver: { id: 'max' },
      reason: 'manager_unavailable',
    });
  });

  it('falls back when the hop limit lands on an inactive user', () => {
    expect(resolveApprover(org, 'veryDeep', 'veryDeep', FALLBACK)).toMatchObject({
      approver: { id: 'clara' },
      reason: 'fallback',
    });
  });

  it('lets executives approve themselves', () => {
    expect(resolveApprover(org, 'helen', 'helen', FALLBACK)).toMatchObject({
      approver: { id: 'helen' },
      reason: 'executive_self',
      auto: 'executive_self',
    });
    expect(resolveApprover(org, 'clara', 'max', FALLBACK)).toMatchObject({
      approver: { id: 'clara' },
      reason: 'executive_self',
    });
  });

  it('treats subject == fallback approver as executive_self', () => {
    expect(resolveApprover(org, 'loner', 'loner', 'loner@example.com')).toMatchObject({
      approver: { id: 'loner' },
      reason: 'executive_self',
      auto: 'executive_self',
    });
  });

  it('auto-approves when the requester is the resolved approver', () => {
    expect(resolveApprover(org, 'emma', 'max', FALLBACK)).toMatchObject({
      approver: { id: 'max' },
      auto: 'requester_is_approver',
    });
    expect(resolveApprover(org, 'hilTech', 'max', FALLBACK).auto).toBe('requester_is_approver');
  });

  it('falls back when the chain ends at a site manager or nobody', () => {
    expect(resolveApprover(org, 'loneSiteReport', 'loneSiteReport', FALLBACK)).toMatchObject({
      approver: { id: 'clara' },
      reason: 'fallback',
    });
    expect(resolveApprover(org, 'loner', 'loner', FALLBACK)).toMatchObject({
      approver: { id: 'clara' },
      reason: 'fallback',
    });
  });

  it('throws when the fallback approver does not exist', () => {
    expect(() => resolveApprover(org, 'loner', 'loner', 'nobody@example.com')).toThrow(/Fallback/);
  });
});

describe('canDecide (SPEC §6.2)', () => {
  it('allows the assigned approver; the named executive decides as "executive"', () => {
    expect(canDecide(org, 'max', step('manager', 'max', 'emma'), TODAY)).toBe('approver');
    expect(canDecide(org, 'clara', step('executive', 'clara', 'sofia'), TODAY)).toBe('executive');
  });

  it('never allows self-approval, even for the assigned approver or a deputy', () => {
    expect(canDecide(org, 'max', step('manager', 'max', 'max'), TODAY)).toBe(false);
    expect(canDecide(org, 'max', step('manager', 'priya', 'max'), TODAY)).toBe(false);
  });

  it('allows a deputy only inside the validity window', () => {
    expect(canDecide(org, 'max', step('manager', 'priya', 'sdkAgent'), TODAY)).toBe('deputy');
    expect(canDecide(org, 'max', step('manager', 'priya', 'sdkAgent'), '2026-10-10')).toBe(false);
    expect(canDecide(org, 'max', step('manager', 'priya', 'sdkAgent'), '2026-10-26')).toBe(false);
    expect(canDecide(org, 'sofia', step('manager', 'max', 'emma'), TODAY)).toBe(false); // upcoming
    expect(canDecide(org, 'sofia', step('manager', 'max', 'emma'), '2026-10-20')).toBe('deputy');
    expect(canDecide(org, 'emma', step('manager', 'eastLead', 'eastTech'), TODAY)).toBe(false); // expired
    expect(canDecide(org, 'helen', step('executive', 'clara', 'sofia'), TODAY)).toBe('deputy'); // permanent
  });

  it('ignores inactive deputies but lets a deputy decide for a deactivated executive', () => {
    expect(isActiveDeputy(org, 'inactiveDeputy', 'max', TODAY)).toBe(false);
    expect(canDecide(org, 'inactiveDeputy', step('manager', 'max', 'emma'), TODAY)).toBe(false);
    expect(isActiveDeputy(org, 'helen', 'oldExec', TODAY)).toBe(false);
    expect(canDecide(org, 'helen', step('executive', 'oldExec', 'emma'), TODAY)).toBe('deputy');
  });

  it('applies the manager-chain override to manager steps only (D9)', () => {
    expect(canDecide(org, 'max', step('manager', 'eastLead', 'eastTech'), TODAY)).toBe('manager_chain');
    expect(canDecide(org, 'clara', step('manager', 'max', 'emma'), TODAY)).toBe('manager_chain');
    expect(canDecide(org, 'max', step('executive', 'helen', 'emma'), TODAY)).toBe(false);
    expect(canDecide(org, 'clara', step('executive', 'helen', 'emma'), TODAY)).toBe(false);
    expect(canDecide(org, 'emma', step('manager', 'max', 'hilTech'), TODAY)).toBe(false);
    expect(canDecide(org, 'priya', step('manager', 'max', 'emma'), TODAY)).toBe(false);
  });

  it('grants nothing to users without a relationship (e.g. the it_admin persona)', () => {
    expect(canDecide(org, 'ian', step('manager', 'max', 'emma'), TODAY)).toBe(false);
    expect(canDecide(org, 'ian', step('executive', 'clara', 'emma'), TODAY)).toBe(false);
  });
});

describe('deputy and tree helpers', () => {
  it('lists active deputies and principals for a day', () => {
    expect(activeDeputiesOf(org, 'priya', TODAY).map((u) => u.id)).toEqual(['max']);
    expect(activeDeputiesOf(org, 'max', TODAY).map((u) => u.id)).toEqual([]);
    expect(principalsOf(org, 'max', TODAY)).toEqual(['priya']);
    expect(principalsOf(org, 'helen', TODAY)).toEqual(['clara']);
  });

  it('lists active ancestors nearest first', () => {
    expect(activeAncestors(org, 'deepOrphan').map((u) => u.id)).toEqual(['max', 'clara']);
  });

  it('walks the reporting tree at any depth', () => {
    expect(reportingTree(org, 'eastLead').map((u) => u.id)).toEqual(['eastTech']);
    expect(reportingTree(org, 'sofia').map((u) => u.id)).toEqual(['hilTech']);
    expect(reportingTree(org, 'max').some((u) => u.id === 'veryDeep')).toBe(true);
  });
});
