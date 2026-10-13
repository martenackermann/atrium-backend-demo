import { ACTING_AS, APPROVER_REASONS, AUTO_APPROVALS, ROLE_NAMES } from '@/common/domain/vocabulary';
import type { AuditLabels } from '../audit/audit-label.registry';
import { type EnumOption, enumOptions } from './enum.registry';

/** Enums owned by core (API.md §3.6). Slices register theirs the same way. */
export const CORE_ENUMS: Record<string, EnumOption[]> = {
  role: enumOptions(ROLE_NAMES, {
    employee: 'Employee',
    manager: 'Manager',
    executive: 'Executive',
    training_office: 'Training office',
    travel_desk: 'Travel desk',
    asset_admin: 'Asset admin',
    people_ops: 'People ops',
    news_editor: 'News editor',
    it_admin: 'IT admin',
  }),
  actingAs: enumOptions(ACTING_AS, {
    manager_chain: 'Manager chain',
    back_office: 'Back office',
  }),
  approverReason: enumOptions(APPROVER_REASONS, {
    direct_manager: 'Direct manager',
    site_manager_escalation: 'Escalated past site manager',
    manager_unavailable: 'Manager unavailable',
    executive_self: 'Executive self-approval',
    fallback: 'Fallback approver',
  }),
  autoApproval: enumOptions(AUTO_APPROVALS, {
    executive_self: 'Approved automatically (executive)',
    requester_is_approver: 'Approved automatically (requested by approver)',
    same_approver: 'Approved automatically (same approver)',
  }),
};

/** Audit labels of core entity types. */
export const CORE_AUDIT_LABELS: Record<string, AuditLabels> = {
  deputy: { entity: 'Deputy', fields: { validFrom: 'Valid from', validTo: 'Valid to', note: 'Note' } },
  user: {
    entity: 'User',
    fields: {
      firstName: 'First name',
      lastName: 'Last name',
      jobTitle: 'Job title',
      employeeNumber: 'Employee number',
      departmentId: 'Department',
      siteId: 'Site',
      costCenterId: 'Cost centre',
      managerId: 'Manager',
      isSiteManager: 'Site manager',
      active: 'Active',
      roles: 'Roles',
    },
  },
};
