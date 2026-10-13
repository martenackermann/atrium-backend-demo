import type { PersonaKey } from '@/common/domain/vocabulary';

/**
 * Demo personas (SPEC §2.3), in the order the login screen shows them. Names, emails and
 * org data are seeded by core.seed.ts; this file adds the copy for `GET /auth/personas`.
 */
export interface PersonaCopy {
  key: PersonaKey;
  firstName: string;
  lastName: string;
  tagline: string;
  highlights: string[];
}

export const PERSONAS: readonly PersonaCopy[] = [
  {
    key: 'emma',
    firstName: 'Emma',
    lastName: 'Employee',
    tagline: 'A typical requester with something waiting in every module',
    highlights: [
      'Two new devices to accept',
      'Training feedback and learning goals due',
      'A car request awaiting approval and a booked flight with PIN',
      'A people request waiting for her reply',
    ],
  },
  {
    key: 'max',
    firstName: 'Max',
    lastName: 'Manager',
    tagline: 'Approves for two teams - one escalated past a site manager',
    highlights: [
      'Approvals for his direct reports and the Hillford team',
      'Active deputy for Priya Raman',
      'Override approvals in the Team tab',
      'Owes a progress rating for Emma',
    ],
  },
  {
    key: 'sofia',
    firstName: 'Sofia',
    lastName: 'Site-Manager',
    tagline: "A site manager whose team's approvals escalate to her manager",
    highlights: [
      'Six reports at Hillford',
      'High-priority train trip tomorrow',
      "Max's deputy from next week",
      'A training above 5,000 EUR awaiting the CEO',
    ],
  },
  {
    key: 'clara',
    firstName: 'Clara',
    lastName: 'CEO',
    tagline: 'Executive approvals and the top of every chain',
    highlights: [
      'Three executive approvals of 5,000 EUR or more',
      'Approves for her department heads',
      'Her own flight skipped approval',
      'Helen Brooks is her permanent deputy',
    ],
  },
  {
    key: 'tom',
    firstName: 'Tom',
    lastName: 'Travel-Desk',
    tagline: 'Runs the travel desk queues',
    highlights: ['Three high-priority bookings', 'Cancellations to review', 'Bookings with PDF and PIN'],
  },
  {
    key: 'tina',
    firstName: 'Tina',
    lastName: 'Training-Office',
    tagline: 'Books trainings and chases feedback',
    highlights: [
      'To-book and cancellation queues',
      'A booking-impossible retry',
      'Ratings overview with overdue reminders',
    ],
  },
  {
    key: 'arne',
    firstName: 'Arne',
    lastName: 'Assets',
    tagline: 'Keeps the device inventory in order',
    highlights: [
      'Dashboard and 120-asset inventory',
      'Assigns devices awaiting acceptance',
      'Repair, scrap and field history',
    ],
  },
  {
    key: 'paula',
    firstName: 'Paula',
    lastName: 'People-Ops',
    tagline: 'People requests, personal data and news',
    highlights: [
      'People-ops queue across all statuses',
      'Internal notes and personal data',
      'Two scheduled news posts',
    ],
  },
  {
    key: 'ian',
    firstName: 'Ian',
    lastName: 'IT-Admin',
    tagline: 'Administers users, audit log and jobs',
    highlights: [
      'User and role administration',
      'Audit log and job runner',
      'Sees every back office, cannot approve, personal data redacted',
    ],
  },
];

/** SPEC §2.3 email rule: `${firstName}.${lastName}` lowercased, spaces -> '-', @example.com. */
export function personaEmail(firstName: string, lastName: string): string {
  return `${firstName}.${lastName}`.toLowerCase().replace(/\s+/g, '-') + '@example.com';
}
