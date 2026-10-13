import { describe, expect, it } from 'vitest';
import type { AuthUser } from '@/common/auth/auth-user';
import type { RoleName } from '@/common/domain/vocabulary';
import { canComment, canEdit, canSeePersonalData, canView } from './people-access';

const user = (id: string, ...roles: RoleName[]): AuthUser => ({
  id,
  email: `${id}@example.com`,
  displayName: id,
  roles: ['employee', ...roles],
  isSiteManager: false,
  sessionId: null,
});

const row = { requesterId: 'req', managerId: 'mgr', managerDeputyId: 'dep', status: 'open' as const };

describe('people request access rules (SPEC §3.4, SPEC_RESOLUTIONS #24/#25)', () => {
  const requester = user('req');
  const manager = user('mgr');
  const deputy = user('dep');
  const ops = user('ops', 'people_ops');
  const it_ = user('it', 'it_admin');
  const stranger = user('other');

  it('view: requester, manager, deputy, people_ops, it_admin', () => {
    expect([requester, manager, deputy, ops, it_].every((u) => canView(u, row))).toBe(true);
    expect(canView(stranger, row)).toBe(false);
  });

  it('personal data: requester, manager, people_ops - not the deputy or it_admin', () => {
    expect(canSeePersonalData(requester, row)).toBe(true);
    expect(canSeePersonalData(manager, row)).toBe(true);
    expect(canSeePersonalData(ops, row)).toBe(true);
    expect(canSeePersonalData(deputy, row)).toBe(false);
    expect(canSeePersonalData(it_, row)).toBe(false);
  });

  it('edit: requester only while open; back office until closed', () => {
    expect(canEdit(requester, row)).toBe(true);
    expect(canEdit(requester, { ...row, status: 'in_progress' })).toBe(false);
    expect(canEdit(manager, row)).toBe(false);
    expect(canEdit(ops, { ...row, status: 'waiting_internal' })).toBe(true);
    expect(canEdit(it_, { ...row, status: 'reopened' })).toBe(true);
    expect(canEdit(ops, { ...row, status: 'completed' })).toBe(false);
  });

  it('public comments: requester, manager, back office while not closed', () => {
    expect(canComment(requester, row)).toBe(true);
    expect(canComment(manager, row)).toBe(true);
    expect(canComment(deputy, row)).toBe(false);
    expect(canComment(ops, { ...row, status: 'cancelled' })).toBe(false);
  });
});
