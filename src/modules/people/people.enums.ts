import type { AuditLabels } from '@/modules/core/audit/audit-label.registry';
import { type EnumOption, enumOptions } from '@/modules/core/meta/enum.registry';
import type { WorkflowMeta } from '@/modules/core/meta/workflow.registry';
import { peopleRequestMachine } from './machines/people-request.machine';
import {
  PEOPLE_COMMENT_KINDS,
  PEOPLE_REQUEST_STATUSES,
  PEOPLE_REQUEST_TYPES,
  PRIORITIES,
  SALUTATIONS,
  STATUS_LABELS,
  TYPE_LABELS,
} from './people.constants';

/** `GET /meta/enums` (API.md §3.6) - tones are DESIGN.md §2.4 tones (SPEC_RESOLUTIONS #8). */
export const PEOPLE_ENUMS: Record<string, EnumOption[]> = {
  peopleRequestType: enumOptions(PEOPLE_REQUEST_TYPES, TYPE_LABELS),
  peopleRequestStatus: enumOptions(PEOPLE_REQUEST_STATUSES, {
    open: [STATUS_LABELS.open, 'waiting'],
    in_progress: [STATUS_LABELS.in_progress, 'moving'],
    waiting_internal: [STATUS_LABELS.waiting_internal, 'waiting'],
    waiting_on_requester: [STATUS_LABELS.waiting_on_requester, 'waiting'],
    reopened: [STATUS_LABELS.reopened, 'moving'],
    completed: [STATUS_LABELS.completed, 'positive'],
    rejected: [STATUS_LABELS.rejected, 'negative'],
    cancelled: [STATUS_LABELS.cancelled, 'neutral'],
  }),
  priority: enumOptions(PRIORITIES, {
    critical: ['Critical', 'negative'],
    high: ['High', 'negative'],
    normal: ['Normal', 'neutral'],
    low: ['Low', 'neutral'],
  }),
  salutation: enumOptions(SALUTATIONS, { mr: 'Mr', ms: 'Ms', mx: 'Mx' }),
  peopleCommentKind: enumOptions(PEOPLE_COMMENT_KINDS, {
    comment: 'Comment',
    question: 'Question',
    status_note: 'Status note',
  }),
};

/** Personal-data fields are masked in audit diffs (SPEC §4.5). */
export const PEOPLE_PERSONAL_FIELDS = [
  'birthDate',
  'placeOfBirth',
  'nationality',
  'privateAddress',
  'privatePhone',
  'privateEmail',
] as const;

export const PEOPLE_AUDIT_LABELS: Record<string, AuditLabels> = {
  people_request: {
    entity: 'People request',
    fields: {
      title: 'Title',
      priority: 'Priority',
      jobRole: 'Job role',
      subject: 'Person',
      salutation: 'Salutation',
      firstName: 'First name',
      lastName: 'Last name',
      effectiveDate: 'Effective date',
      department: 'Department',
      site: 'Site',
      manager: 'Manager',
      managerDeputy: "Manager's deputy",
      reason: 'Reason',
      furtherInformation: 'Further information',
      equipmentNotes: 'Equipment notes',
      birthDate: 'Birth date',
      placeOfBirth: 'Place of birth',
      nationality: 'Nationality',
      privateAddress: 'Private address',
      privatePhone: 'Private phone',
      privateEmail: 'Private email',
      assignee: 'Assignee',
      internalNote: 'Internal note',
    },
    // Internal notes are never shown to requesters (SPEC §3.4), so they are masked like PII.
    masked: [...PEOPLE_PERSONAL_FIELDS, 'internalNote'],
    actions: {
      create: 'created the request',
      update: 'updated the request',
      start_work: 'started work',
      wait_internal: 'set the request to waiting (internal)',
      wait_on_requester: 'asked the requester a question',
      requester_replied: 'replied to the question',
      resume: 'resumed work',
      complete: 'completed the request',
      reject: 'rejected the request',
      cancel: 'cancelled the request',
      reopen: 'reopened the request',
    },
  },
  job_role: {
    entity: 'Job role',
    fields: { name: 'Name', category: 'Category', active: 'Active' },
  },
};

/** `GET /meta/workflows/people_request`. */
export const peopleRequestWorkflowMeta: WorkflowMeta = {
  name: 'people_request',
  label: 'People request',
  machine: peopleRequestMachine,
  initialStates: ['open'],
  states: {
    open: { label: STATUS_LABELS.open, tone: 'waiting' },
    in_progress: { label: STATUS_LABELS.in_progress, tone: 'moving' },
    waiting_internal: { label: STATUS_LABELS.waiting_internal, tone: 'waiting' },
    waiting_on_requester: { label: STATUS_LABELS.waiting_on_requester, tone: 'waiting' },
    reopened: { label: STATUS_LABELS.reopened, tone: 'moving' },
    completed: { label: STATUS_LABELS.completed, tone: 'positive' },
    rejected: { label: STATUS_LABELS.rejected, tone: 'negative' },
    cancelled: { label: STATUS_LABELS.cancelled, tone: 'neutral' },
  },
  events: {
    start_work: { label: 'Start work', actors: ['People Ops'] },
    wait_internal: { label: 'Wait (internal)', actors: ['People Ops'] },
    wait_on_requester: { label: 'Ask requester', actors: ['People Ops'] },
    resume: { label: 'Resume', actors: ['People Ops'] },
    requester_replied: { label: 'Requester replies', actors: ['Requester'] },
    complete: { label: 'Complete', actors: ['People Ops'] },
    reject: { label: 'Reject', actors: ['People Ops'] },
    cancel: { label: 'Cancel', actors: ['Requester', 'People Ops'] },
    reopen: { label: 'Reopen', actors: ['People Ops', 'Requester (completed, within 30 days)'] },
  },
};
