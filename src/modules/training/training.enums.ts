import type { AuditLabels } from '@/modules/core/audit/audit-label.registry';
import { type EnumOption, enumOptions } from '@/modules/core/meta/enum.registry';
import { ATTENDEE_STATUSES, BILLING_STATUSES, LIKERT, RATING_STATES, TRAINING_FORMATS } from './training.constants';

/**
 * Training enums for `GET /meta/enums` (API.md §3.6). Tones are DESIGN.md §2.4's seven tones
 * (SPEC_RESOLUTIONS #8); the viewer-relative `you` tone is applied client-side.
 */
export const TRAINING_ENUMS: Record<string, EnumOption[]> = {
  trainingFormat: enumOptions(TRAINING_FORMATS, { in_person: 'In person', online: 'Online', hybrid: 'Hybrid' }),
  attendeeStatus: enumOptions(ATTENDEE_STATUSES, {
    pending_manager_approval: ['Awaiting manager', 'waiting'],
    pending_executive_approval: ['Awaiting executive', 'waiting'],
    to_book: ['To book', 'moving'],
    booked: ['Booked', 'positive'],
    declined: ['Declined', 'negative'],
    booking_impossible: ['Booking impossible', 'blocked'],
    cancellation_requested: ['Cancellation requested', 'waiting'],
    cancelled: ['Cancelled', 'neutral'],
    attended: ['Attended', 'positive'],
    not_attended: ['Did not attend', 'neutral'],
  }),
  billingStatus: enumOptions(BILLING_STATUSES, {
    open: ['Open', 'waiting'],
    invoice_received: ['Invoice received', 'positive'],
    free_of_charge: ['Free of charge', 'neutral'],
  }),
  ratingState: enumOptions(RATING_STATES, {
    upcoming: ['Upcoming', 'neutral'],
    due: ['Due', 'waiting'],
    overdue: ['Overdue', 'negative'],
    submitted: ['Submitted', 'positive'],
  }),
  likert: enumOptions(LIKERT, { A: 'Fully agree', B: 'Mostly agree', C: 'Partly agree', D: 'Disagree' }),
  improvement: enumOptions([1, 2, 3, 4], { 1: 'Clearly visible', 2: 'Visible', 3: 'Barely visible', 4: 'Not visible' }),
};

/** Field labels and timeline phrases (SPEC_RESOLUTIONS #6). */
export const TRAINING_AUDIT_LABELS: Record<string, AuditLabels> = {
  training_request: {
    entity: 'Training request',
    fields: {
      topic: 'Topic',
      provider: 'Provider',
      format: 'Format',
      location: 'Location',
      registrationUrl: 'Registration link',
      registrationDetails: 'Registration details',
      startsOn: 'Start date',
      endsOn: 'End date',
      costCents: 'Cost per attendee',
      costCenterId: 'Cost centre',
      executiveApproverId: 'Executive approver',
      certificateExpected: 'Certificate expected',
      reimbursementAgreement: 'Reimbursement agreement',
      requesterComment: 'Comment',
      billingStatus: 'Billing status',
      actualCostCents: 'Actual cost',
      backOfficeComment: 'Back-office comment',
    },
    actions: {
      create: 'created the request',
      update: 'updated the request',
      update_back_office: 'updated the billing details',
      add_attendee: 'added an attendee',
      add_attachment: 'added documents',
      remove_attachment: 'removed a document',
    },
  },
  training_attendee: {
    entity: 'Participation',
    fields: { goal1: 'Goal 1', goal2: 'Goal 2', executiveApproverId: 'Executive approver' },
    actions: {
      create: 'registered the participation',
      auto_approve: 'approved automatically',
      approve: 'approved',
      decline: 'declined',
      withdraw: 'withdrew the participation',
      close: 'closed the request',
      update_goals: 'updated the learning goals',
      remind: 'sent a reminder',
      submit_rating_1: 'submitted feedback round 1',
    },
  },
  training_rating: {
    entity: 'Rating',
    actions: { create: 'opened the feedback round', submit: 'submitted the feedback', remind: 'sent a reminder' },
  },
};
