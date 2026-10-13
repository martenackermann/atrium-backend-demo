/**
 * SPEC §10.2 training story: 30 requests, 42 attendees, written as pure data relative to the
 * seed day (`day` = offset from SEED_TODAY, `at` = [day, hh, mm] local time). Users are core
 * seed handles (persona keys, `priya`, `hilTech1`, `sdkAgent5`...). Story records keep their
 * S-T number as reference number (TRN-000001 = S-T1 ... TRN-000017 = S-T17, SPEC_RESOLUTIONS #21);
 * 14, 15 and 18-30 are the generated filler. The frontend MSW seed mirrors this file.
 *
 * Expected routing (`approver`, `reason`, `escalatedFrom`) is stated explicitly and checked
 * against the core approver resolution when seeding.
 */

export type At = [day: number, hh: number, mm: number];

export type Rating1 = { participated: boolean; grades?: [number, number, number]; comment?: string };
export type Rating2 = { answers: ['A' | 'B' | 'C' | 'D', 'A' | 'B' | 'C' | 'D', 'A' | 'B' | 'C' | 'D']; comment?: string };
export type Rating3 = { improvement: 1 | 2 | 3 | 4; certification: boolean; certificationComment?: string; comment?: string };

export type StoryStep =
  | { kind: 'approve'; at: At; by: string; comment?: string }
  | { kind: 'decline'; at: At; by: string; reason: string }
  | { kind: 'withdraw'; at: At; by: string; reason?: string }
  | { kind: 'book'; at: At; by: string; reference: string; document?: boolean }
  | { kind: 'mark_booking_impossible'; at: At; by: string; reason: string }
  | { kind: 'request_cancellation'; at: At; by: string; reason: string }
  | { kind: 'confirm_cancellation'; at: At; by: string; comment?: string }
  | { kind: 'rate1'; at: At; answers: Rating1 }
  | { kind: 'rate2'; at: At; answers: Rating2 }
  | { kind: 'rate3'; at: At; answers: Rating3 }
  /** Rating reminder sent by the job (07:15, moved to a weekday). */
  | { kind: 'remind'; loop: 1 | 2 | 3; day: number };

export interface StoryAttendee {
  user: string;
  approver: string;
  reason: 'direct_manager' | 'site_manager_escalation' | 'manager_unavailable' | 'executive_self' | 'fallback';
  escalatedFrom?: string;
  /** Expected entry auto-approval (manager step). */
  auto?: 'executive_self' | 'requester_is_approver';
  hotel?: { checkIn: number; checkOut: number; costCents?: number };
  goals?: [string | null, string | null];
  steps: StoryStep[];
}

export interface StoryRequest {
  number: number;
  /** S-T id from SPEC §10.2 (null = generated filler). */
  story: string | null;
  topic: string;
  provider: string;
  format: 'in_person' | 'online' | 'hybrid';
  location: string | null;
  startsOn: number;
  endsOn: number;
  costCents: number;
  requester: string;
  executive?: string;
  created: At;
  registrationUrl?: string;
  registrationDetails?: string;
  certificateExpected?: boolean;
  reimbursementAgreement?: boolean;
  comment?: string;
  /** Request document (training_document) uploaded by the requester at creation. */
  agenda?: string;
  billing?: { status: 'open' | 'invoice_received' | 'free_of_charge'; actualFactor?: number; comment?: string };
  attendees: StoryAttendee[];
}

const GOALS = {
  emma4: ['Build the weekly dispatch report without help', 'Share one reusable template with the team'],
  emma5: ['Calm down escalations on site within the first five minutes', 'Write a short debrief after each conflict'],
} as const;

export const TRAINING_STORY: StoryRequest[] = [
  {
    number: 1,
    story: 'S-T1',
    topic: 'Customer Communication Masterclass',
    provider: 'Brightpath Academy',
    format: 'in_person',
    location: 'Riverton',
    startsOn: 21,
    endsOn: 22,
    costCents: 89000,
    requester: 'emma',
    created: [-2, 10, 12],
    registrationUrl: 'https://training.example.com/brightpath/customer-communication',
    certificateExpected: true,
    comment: 'Would help with the escalation calls from Westbay customers.',
    attendees: [{ user: 'emma', approver: 'max', reason: 'direct_manager', steps: [] }],
  },
  {
    number: 2,
    story: 'S-T2',
    topic: 'First Aid at Work Refresher',
    provider: 'Harbor Training Group',
    format: 'in_person',
    location: 'Riverton',
    startsOn: 6,
    endsOn: 6,
    costCents: 24000,
    requester: 'emma',
    created: [-15, 9, 5],
    certificateExpected: true,
    agenda: 'First-aid-refresher-agenda.pdf',
    billing: { status: 'open' },
    attendees: [
      {
        user: 'emma',
        approver: 'max',
        reason: 'direct_manager',
        steps: [
          { kind: 'approve', at: [-12, 11, 40], by: 'max' },
          { kind: 'book', at: [-9, 14, 20], by: 'tina', reference: 'HTG-20417' },
        ],
      },
    ],
  },
  {
    number: 3,
    story: 'S-T3',
    topic: 'Project Fundamentals Workshop',
    provider: 'Northgate Learning',
    format: 'in_person',
    location: 'Riverton',
    startsOn: -4,
    endsOn: -3,
    costCents: 65000,
    requester: 'emma',
    created: [-40, 9, 30],
    billing: { status: 'open' },
    attendees: [
      {
        user: 'emma',
        approver: 'max',
        reason: 'direct_manager',
        goals: ['Plan the Hillford rollout in clear phases', null],
        steps: [
          { kind: 'approve', at: [-38, 16, 5], by: 'max' },
          { kind: 'book', at: [-35, 10, 0], by: 'tina', reference: 'NGL-88310' },
          { kind: 'remind', loop: 1, day: -2 },
        ],
      },
    ],
  },
  {
    number: 4,
    story: 'S-T4',
    topic: 'Spreadsheet Analysis Essentials',
    provider: 'Summit Skills',
    format: 'online',
    location: null,
    startsOn: -76,
    endsOn: -75,
    costCents: 42000,
    requester: 'emma',
    created: [-110, 10, 0],
    billing: { status: 'invoice_received', actualFactor: 1 },
    attendees: [
      {
        user: 'emma',
        approver: 'max',
        reason: 'direct_manager',
        goals: [...GOALS.emma4],
        steps: [
          { kind: 'approve', at: [-108, 9, 20], by: 'max' },
          { kind: 'book', at: [-104, 13, 0], by: 'tina', reference: 'SUM-30115' },
          {
            kind: 'rate1',
            at: [-62, 18, 10],
            answers: { participated: true, grades: [2, 1, 2], comment: 'Pivot tables finally make sense.' },
          },
        ],
      },
    ],
  },
  {
    number: 5,
    story: 'S-T5',
    topic: 'Conflict Resolution for Field Teams',
    provider: 'Oakridge Learning Center',
    format: 'in_person',
    location: 'Riverton',
    startsOn: -131,
    endsOn: -130,
    costCents: 78000,
    requester: 'emma',
    created: [-170, 11, 0],
    billing: { status: 'invoice_received', actualFactor: 0.95 },
    attendees: [
      {
        user: 'emma',
        approver: 'max',
        reason: 'direct_manager',
        goals: [...GOALS.emma5],
        steps: [
          { kind: 'approve', at: [-168, 10, 5], by: 'max' },
          { kind: 'book', at: [-160, 14, 30], by: 'tina', reference: 'OLC-55102' },
          { kind: 'rate1', at: [-125, 17, 45], answers: { participated: true, grades: [1, 2, 2] } },
          {
            kind: 'rate2',
            at: [-35, 8, 50],
            answers: { answers: ['A', 'B', 'A'], comment: 'Used the de-escalation steps twice last month.' },
          },
        ],
      },
    ],
  },
  {
    number: 6,
    story: 'S-T6',
    topic: 'Presentation Skills',
    provider: 'Brightpath Academy',
    format: 'in_person',
    location: 'Riverton',
    startsOn: -10,
    endsOn: -9,
    costCents: 69000,
    requester: 'emma',
    created: [-44, 15, 0],
    attendees: [
      {
        user: 'emma',
        approver: 'max',
        reason: 'direct_manager',
        steps: [
          {
            kind: 'decline',
            at: [-40, 9, 50],
            by: 'max',
            reason: 'Please join the internal session in Q1 instead.',
          },
        ],
      },
    ],
  },
  {
    number: 7,
    story: 'S-T7',
    topic: 'Fiber Splicing Certification',
    provider: 'Clearview Institute',
    format: 'in_person',
    location: 'Hillford',
    startsOn: 27,
    endsOn: 29,
    costCents: 145000,
    requester: 'sofia',
    created: [-1, 8, 45],
    certificateExpected: true,
    reimbursementAgreement: true,
    registrationDetails: 'Two seats reserved under the Hillford site account until the end of the month.',
    attendees: [
      {
        user: 'hilTech1',
        approver: 'max',
        reason: 'site_manager_escalation',
        escalatedFrom: 'sofia',
        hotel: { checkIn: 26, checkOut: 29, costCents: 32000 },
        steps: [],
      },
      { user: 'hilTech2', approver: 'max', reason: 'site_manager_escalation', escalatedFrom: 'sofia', steps: [] },
    ],
  },
  {
    number: 8,
    story: 'S-T8',
    topic: 'Advanced Troubleshooting Lab',
    provider: 'Northgate Learning',
    format: 'hybrid',
    location: 'Campus',
    startsOn: 18,
    endsOn: 19,
    costCents: 98000,
    requester: 'tina',
    created: [-3, 11, 0],
    comment: 'Registered by the training office for the second-level support pilot.',
    attendees: [
      { user: 'sdkAgent5', approver: 'priya', reason: 'direct_manager', steps: [] },
      { user: 'sdkAgent6', approver: 'priya', reason: 'direct_manager', steps: [] },
    ],
  },
  {
    number: 9,
    story: 'S-T9',
    topic: 'Cloud Architecture Bootcamp',
    provider: 'Summit Skills',
    format: 'online',
    location: null,
    startsOn: 35,
    endsOn: 39,
    costCents: 690000,
    requester: 'ito2',
    executive: 'clara',
    created: [-6, 10, 20],
    certificateExpected: true,
    reimbursementAgreement: true,
    attendees: [
      {
        user: 'ito2',
        approver: 'victor',
        reason: 'direct_manager',
        steps: [{ kind: 'approve', at: [-4, 15, 30], by: 'victor', comment: 'Fits the platform migration plan.' }],
      },
    ],
  },
  {
    number: 10,
    story: 'S-T10',
    topic: 'Site Operations Leadership Certificate',
    provider: 'Oakridge Learning Center',
    format: 'in_person',
    location: 'Oakridge',
    startsOn: 42,
    endsOn: 44,
    costCents: 560000,
    requester: 'sofia',
    executive: 'clara',
    created: [-8, 9, 0],
    certificateExpected: true,
    reimbursementAgreement: true,
    attendees: [
      {
        user: 'sofia',
        approver: 'max',
        reason: 'direct_manager',
        hotel: { checkIn: 41, checkOut: 44, costCents: 54000 },
        steps: [{ kind: 'approve', at: [-5, 17, 10], by: 'max' }],
      },
    ],
  },
  {
    number: 11,
    story: 'S-T11',
    topic: 'Field Operations Leadership Programme',
    provider: 'Brightpath Academy',
    format: 'in_person',
    location: 'Eastgate',
    startsOn: 49,
    endsOn: 51,
    costCents: 520000,
    requester: 'easLead',
    executive: 'clara',
    created: [-7, 13, 0],
    attendees: [
      {
        user: 'easLead',
        approver: 'max',
        reason: 'direct_manager',
        steps: [{ kind: 'approve', at: [-3, 10, 15], by: 'max' }],
      },
    ],
  },
  {
    number: 12,
    story: 'S-T12',
    topic: 'Strategic People Partnering',
    provider: 'Northgate Learning',
    format: 'in_person',
    location: 'Riverton',
    startsOn: 24,
    endsOn: 25,
    costCents: 190000,
    requester: 'grace',
    created: [-1, 14, 30],
    attendees: [{ user: 'grace', approver: 'clara', reason: 'direct_manager', steps: [] }],
  },
  {
    number: 13,
    story: 'S-T13',
    topic: 'Negotiation Skills for Managers',
    provider: 'Harbor Training Group',
    format: 'in_person',
    location: 'Riverton',
    startsOn: 15,
    endsOn: 16,
    costCents: 120000,
    requester: 'max',
    created: [-10, 9, 15],
    attendees: [
      {
        user: 'max',
        approver: 'clara',
        reason: 'direct_manager',
        steps: [{ kind: 'approve', at: [-8, 12, 0], by: 'clara' }],
      },
    ],
  },
  {
    number: 14,
    story: null,
    topic: 'Safety Inspection Basics',
    provider: 'Harbor Training Group',
    format: 'in_person',
    location: 'Eastgate',
    startsOn: 30,
    endsOn: 30,
    costCents: 65000,
    requester: 'easTech1',
    created: [-2, 7, 50],
    attendees: [{ user: 'easTech1', approver: 'easLead', reason: 'direct_manager', steps: [] }],
  },
  {
    number: 15,
    story: null,
    topic: 'Electrical Safety Refresher',
    provider: 'Harbor Training Group',
    format: 'in_person',
    location: 'Hillford',
    startsOn: 8,
    endsOn: 9,
    costCents: 38000,
    requester: 'sofia',
    created: [-20, 10, 0],
    billing: { status: 'open' },
    attendees: [
      {
        user: 'hilTech3',
        approver: 'max',
        reason: 'site_manager_escalation',
        escalatedFrom: 'sofia',
        steps: [
          { kind: 'approve', at: [-18, 9, 30], by: 'max' },
          { kind: 'book', at: [-14, 11, 0], by: 'tina', reference: 'HTG-20633', document: true },
        ],
      },
      {
        user: 'hilTech4',
        approver: 'max',
        reason: 'site_manager_escalation',
        escalatedFrom: 'sofia',
        steps: [
          { kind: 'approve', at: [-18, 9, 31], by: 'max' },
          { kind: 'book', at: [-14, 11, 2], by: 'tina', reference: 'HTG-20634' },
          {
            kind: 'request_cancellation',
            at: [-1, 16, 5],
            by: 'hilTech4',
            reason: 'Shift conflict with the Hillford on-call rota.',
          },
        ],
      },
    ],
  },
  {
    number: 16,
    story: 'S-T16',
    topic: 'Data Protection Officer Course',
    provider: 'Clearview Institute',
    format: 'hybrid',
    location: 'Campus',
    startsOn: 20,
    endsOn: 24,
    costCents: 240000,
    requester: 'ito3',
    created: [-12, 10, 0],
    certificateExpected: true,
    attendees: [
      {
        user: 'ito3',
        approver: 'victor',
        reason: 'direct_manager',
        steps: [
          { kind: 'approve', at: [-11, 9, 0], by: 'victor' },
          {
            kind: 'mark_booking_impossible',
            at: [-6, 11, 20],
            by: 'tina',
            reason: 'Provider fully booked until next quarter',
          },
        ],
      },
    ],
  },
  {
    number: 17,
    story: 'S-T17',
    topic: 'Finance Leadership Forum',
    provider: 'Northgate Learning',
    format: 'in_person',
    location: 'Riverton',
    startsOn: 12,
    endsOn: 13,
    costCents: 320000,
    requester: 'helen',
    created: [-16, 8, 30],
    billing: { status: 'open' },
    attendees: [
      {
        user: 'helen',
        approver: 'helen',
        reason: 'executive_self',
        auto: 'executive_self',
        steps: [{ kind: 'book', at: [-13, 15, 0], by: 'tina', reference: 'NGL-90044', document: true }],
      },
    ],
  },
  {
    number: 18,
    story: null,
    topic: 'ITIL Foundation',
    provider: 'Northgate Learning',
    format: 'online',
    location: null,
    startsOn: 5,
    endsOn: 6,
    costCents: 110000,
    requester: 'sdkLead',
    created: [-9, 11, 0],
    certificateExpected: true,
    attendees: [
      { user: 'sdkAgent1', approver: 'sdkLead', reason: 'direct_manager', auto: 'requester_is_approver', steps: [] },
      {
        user: 'sdkAgent2',
        approver: 'sdkLead',
        reason: 'direct_manager',
        auto: 'requester_is_approver',
        steps: [
          { kind: 'request_cancellation', at: [-1, 9, 40], by: 'sdkAgent2', reason: 'Moved to the night shift that week.' },
        ],
      },
    ],
  },
  {
    number: 19,
    story: null,
    topic: 'Fleet Vehicle Maintenance Basics',
    provider: 'Clearview Institute',
    format: 'in_person',
    location: 'Eastgate',
    startsOn: 33,
    endsOn: 34,
    costCents: 54000,
    requester: 'easLead',
    created: [-6, 15, 0],
    attendees: [
      {
        user: 'easTech2',
        approver: 'easLead',
        reason: 'direct_manager',
        auto: 'requester_is_approver',
        hotel: { checkIn: 32, checkOut: 34, costCents: 21000 },
        steps: [],
      },
      { user: 'easTech3', approver: 'easLead', reason: 'direct_manager', auto: 'requester_is_approver', steps: [] },
      {
        user: 'easTech4',
        approver: 'easLead',
        reason: 'direct_manager',
        auto: 'requester_is_approver',
        steps: [
          {
            kind: 'request_cancellation',
            at: [-4, 10, 0],
            by: 'easTech4',
            reason: 'Starting parental leave earlier than planned.',
          },
          { kind: 'confirm_cancellation', at: [-3, 9, 10], by: 'tina', comment: 'The provider refunds the fee.' },
        ],
      },
    ],
  },
  {
    number: 20,
    story: null,
    topic: 'High-Voltage Switching Certification',
    provider: 'Clearview Institute',
    format: 'in_person',
    location: 'Hillford',
    startsOn: 25,
    endsOn: 27,
    costCents: 210000,
    requester: 'rivSeniorTech',
    created: [-5, 9, 0],
    certificateExpected: true,
    attendees: [
      {
        user: 'rivSeniorTech',
        approver: 'max',
        reason: 'direct_manager',
        steps: [{ kind: 'approve', at: [-4, 8, 30], by: 'max' }],
      },
    ],
  },
  {
    number: 21,
    story: null,
    topic: 'Customer Service Excellence',
    provider: 'Brightpath Academy',
    format: 'online',
    location: null,
    startsOn: 11,
    endsOn: 11,
    costCents: 36000,
    requester: 'priya',
    created: [-21, 10, 30],
    billing: { status: 'invoice_received', actualFactor: 1.02 },
    attendees: [
      {
        user: 'sdkAgent7',
        approver: 'priya',
        reason: 'direct_manager',
        auto: 'requester_is_approver',
        steps: [{ kind: 'book', at: [-17, 9, 0], by: 'tina', reference: 'BPA-71201', document: true }],
      },
      {
        user: 'sdkAgent8',
        approver: 'priya',
        reason: 'direct_manager',
        auto: 'requester_is_approver',
        steps: [{ kind: 'book', at: [-17, 9, 2], by: 'tina', reference: 'BPA-71202' }],
      },
    ],
  },
  {
    number: 22,
    story: null,
    topic: 'IFRS Update Seminar',
    provider: 'Summit Skills',
    format: 'online',
    location: null,
    startsOn: 19,
    endsOn: 19,
    costCents: 69000,
    requester: 'fin1',
    created: [-14, 9, 40],
    billing: { status: 'free_of_charge', comment: 'Covered by the auditors partner programme.' },
    attendees: [
      {
        user: 'fin1',
        approver: 'helen',
        reason: 'direct_manager',
        steps: [
          { kind: 'approve', at: [-13, 10, 10], by: 'helen' },
          { kind: 'book', at: [-11, 15, 45], by: 'tina', reference: 'SUM-30770' },
        ],
      },
    ],
  },
  {
    number: 23,
    story: null,
    topic: 'Interviewing Techniques',
    provider: 'Northgate Learning',
    format: 'in_person',
    location: 'Riverton',
    startsOn: -6,
    endsOn: -5,
    costCents: 58000,
    requester: 'grace',
    created: [-45, 11, 15],
    billing: { status: 'open' },
    attendees: [
      {
        user: 'ppl1',
        approver: 'grace',
        reason: 'direct_manager',
        auto: 'requester_is_approver',
        steps: [{ kind: 'book', at: [-40, 10, 0], by: 'tina', reference: 'NGL-89901' }],
      },
      {
        user: 'paula',
        approver: 'grace',
        reason: 'direct_manager',
        auto: 'requester_is_approver',
        steps: [
          { kind: 'book', at: [-40, 10, 2], by: 'tina', reference: 'NGL-89902' },
          {
            kind: 'request_cancellation',
            at: [-20, 14, 0],
            by: 'paula',
            reason: 'Conflicts with the onboarding week at Campus.',
          },
          { kind: 'confirm_cancellation', at: [-19, 9, 30], by: 'tina' },
        ],
      },
    ],
  },
  {
    number: 24,
    story: null,
    topic: 'Endpoint Management Workshop',
    provider: 'Summit Skills',
    format: 'online',
    location: null,
    startsOn: -3,
    endsOn: -2,
    costCents: 47000,
    requester: 'ito4',
    created: [-30, 9, 0],
    billing: { status: 'open' },
    attendees: [
      {
        user: 'ito4',
        approver: 'victor',
        reason: 'direct_manager',
        steps: [
          { kind: 'approve', at: [-29, 14, 0], by: 'victor' },
          { kind: 'book', at: [-26, 10, 30], by: 'tina', reference: 'SUM-30542' },
        ],
      },
    ],
  },
  {
    number: 25,
    story: null,
    topic: 'Route Planning Essentials',
    provider: 'Clearview Institute',
    format: 'in_person',
    location: 'Riverton',
    startsOn: -73,
    endsOn: -72,
    costCents: 39000,
    requester: 'max',
    created: [-100, 9, 0],
    billing: { status: 'invoice_received', actualFactor: 1.04 },
    attendees: [
      {
        user: 'rivDispatcher',
        approver: 'max',
        reason: 'direct_manager',
        auto: 'requester_is_approver',
        steps: [
          { kind: 'book', at: [-95, 11, 0], by: 'tina', reference: 'CVI-12087' },
          { kind: 'rate1', at: [-70, 16, 20], answers: { participated: true, grades: [2, 2, 3] } },
          { kind: 'remind', loop: 2, day: -10 },
          { kind: 'remind', loop: 2, day: -3 },
        ],
      },
      {
        user: 'hilTech5',
        approver: 'max',
        reason: 'site_manager_escalation',
        escalatedFrom: 'sofia',
        auto: 'requester_is_approver',
        steps: [
          { kind: 'book', at: [-95, 11, 2], by: 'tina', reference: 'CVI-12088' },
          { kind: 'rate1', at: [-63, 7, 55], answers: { participated: true, grades: [3, 2, 3] } },
        ],
      },
    ],
  },
  {
    number: 26,
    story: null,
    topic: 'Team Leadership Fundamentals',
    provider: 'Oakridge Learning Center',
    format: 'in_person',
    location: 'Campus',
    startsOn: -119,
    endsOn: -118,
    costCents: 95000,
    requester: 'sdkLead',
    created: [-150, 10, 0],
    billing: { status: 'free_of_charge', comment: 'Voucher from the provider partnership.' },
    attendees: [
      {
        user: 'sdkLead',
        approver: 'priya',
        reason: 'direct_manager',
        steps: [
          { kind: 'approve', at: [-148, 9, 10], by: 'priya' },
          { kind: 'book', at: [-140, 13, 0], by: 'tina', reference: 'OLC-54010' },
          { kind: 'rate1', at: [-115, 18, 0], answers: { participated: true, grades: [2, 1, 2] } },
          { kind: 'rate2', at: [-54, 12, 30], answers: { answers: ['B', 'C', 'B'] } },
          { kind: 'remind', loop: 3, day: -24 },
          { kind: 'remind', loop: 3, day: -17 },
          { kind: 'remind', loop: 3, day: -10 },
          { kind: 'remind', loop: 3, day: -3 },
        ],
      },
      {
        user: 'sdkAgent4',
        approver: 'sdkLead',
        reason: 'direct_manager',
        auto: 'requester_is_approver',
        steps: [
          { kind: 'book', at: [-140, 13, 2], by: 'tina', reference: 'OLC-54011' },
          {
            kind: 'rate1',
            at: [-116, 9, 15],
            answers: { participated: false, comment: 'Called in for a major incident on both days.' },
          },
        ],
      },
    ],
  },
  {
    number: 27,
    story: null,
    topic: 'Advanced Excel for Controllers',
    provider: 'Summit Skills',
    format: 'online',
    location: null,
    startsOn: -151,
    endsOn: -150,
    costCents: 45000,
    requester: 'helen',
    created: [-185, 9, 30],
    billing: { status: 'invoice_received', actualFactor: 0.97 },
    attendees: (
      [
        ['fin2', -147, -85, -50, [1, 2, 1], ['A', 'A', 'A'], 1],
        ['fin3', -146, -84, -49, [2, 2, 2], ['B', 'A', 'B'], 2],
        ['fin4', -145, -83, -48, [2, 3, 2], ['B', 'B', 'A'], 2],
      ] as const
    ).map(([user, r1, r2, r3, grades, likert, improvement], i) => ({
      user,
      approver: 'helen',
      reason: 'direct_manager' as const,
      auto: 'requester_is_approver' as const,
      steps: [
        { kind: 'book' as const, at: [-178, 10, i] as At, by: 'tina', reference: `SUM-2990${i + 1}` },
        {
          kind: 'rate1' as const,
          at: [r1, 17, 0] as At,
          answers: { participated: true, grades: [...grades] as [number, number, number] },
        },
        { kind: 'rate2' as const, at: [r2, 11, 0] as At, answers: { answers: [...likert] as Rating2['answers'] } },
        {
          kind: 'rate3' as const,
          at: [r3, 15, 0] as At,
          answers: {
            improvement,
            certification: false,
            comment: i === 0 ? 'Month-end closing runs a day faster.' : undefined,
          } as Rating3,
        },
      ],
    })),
  },
  {
    number: 28,
    story: null,
    topic: 'Drone Inspection Course',
    provider: 'Clearview Institute',
    format: 'in_person',
    location: 'Hillford',
    startsOn: 40,
    endsOn: 42,
    costCents: 280000,
    requester: 'hilTech6',
    created: [-18, 13, 20],
    attendees: [
      {
        user: 'hilTech6',
        approver: 'max',
        reason: 'site_manager_escalation',
        escalatedFrom: 'sofia',
        steps: [
          {
            kind: 'decline',
            at: [-15, 10, 30],
            by: 'max',
            reason: 'Drone inspections are not planned for Hillford this year.',
          },
        ],
      },
    ],
  },
  {
    number: 29,
    story: null,
    topic: 'Event Management Certificate',
    provider: 'Brightpath Academy',
    format: 'online',
    location: null,
    startsOn: 45,
    endsOn: 47,
    costCents: 150000,
    requester: 'ppl2',
    created: [-12, 16, 0],
    attendees: [
      {
        user: 'ppl2',
        approver: 'grace',
        reason: 'direct_manager',
        steps: [
          {
            kind: 'decline',
            at: [-10, 11, 5],
            by: 'grace',
            reason: 'The budget for this quarter is already allocated.',
          },
        ],
      },
    ],
  },
  {
    number: 30,
    story: null,
    topic: 'Kubernetes Fundamentals',
    provider: 'Summit Skills',
    format: 'online',
    location: null,
    startsOn: 28,
    endsOn: 30,
    costCents: 120000,
    requester: 'ito1',
    created: [-9, 14, 10],
    attendees: [
      {
        user: 'ito1',
        approver: 'victor',
        reason: 'direct_manager',
        steps: [{ kind: 'withdraw', at: [-7, 8, 40], by: 'ito1', reason: 'Found an internal course instead.' }],
      },
    ],
  },
];

/**
 * In-app notifications of the story records for the personas (SPEC_RESOLUTIONS #7): request
 * number, attendee handle, template id, recipient, day/time and whether it was read.
 */
export const TRAINING_STORY_NOTIFICATIONS: {
  request: number;
  attendee: string;
  template: string;
  to: string;
  at: At;
  read: boolean;
}[] = [
  { request: 1, attendee: 'emma', template: 'training.participation_created', to: 'emma', at: [-2, 10, 12], read: false },
  { request: 2, attendee: 'emma', template: 'training.participation_booked', to: 'emma', at: [-9, 14, 20], read: true },
  { request: 6, attendee: 'emma', template: 'training.participation_declined', to: 'emma', at: [-40, 9, 50], read: true },
  { request: 1, attendee: 'emma', template: 'training.approval_requested', to: 'max', at: [-2, 10, 12], read: false },
  { request: 7, attendee: 'hilTech1', template: 'training.approval_requested', to: 'max', at: [-1, 8, 45], read: false },
  { request: 8, attendee: 'sdkAgent5', template: 'training.approval_requested', to: 'max', at: [-3, 11, 0], read: false },
  { request: 10, attendee: 'sofia', template: 'training.participation_created', to: 'sofia', at: [-8, 9, 0], read: true },
  { request: 7, attendee: 'hilTech1', template: 'training.participation_created', to: 'sofia', at: [-1, 8, 45], read: true },
  {
    request: 9,
    attendee: 'ito2',
    template: 'training.executive_approval_requested',
    to: 'clara',
    at: [-4, 15, 30],
    read: false,
  },
  {
    request: 10,
    attendee: 'sofia',
    template: 'training.executive_approval_requested',
    to: 'clara',
    at: [-5, 17, 10],
    read: false,
  },
  {
    request: 11,
    attendee: 'easLead',
    template: 'training.executive_approval_requested',
    to: 'clara',
    at: [-3, 10, 15],
    read: true,
  },
  { request: 12, attendee: 'grace', template: 'training.approval_requested', to: 'clara', at: [-1, 14, 30], read: false },
  { request: 17, attendee: 'helen', template: 'training.participation_created', to: 'helen', at: [-16, 8, 30], read: true },
  { request: 17, attendee: 'helen', template: 'training.participation_booked', to: 'helen', at: [-13, 15, 0], read: true },
];
