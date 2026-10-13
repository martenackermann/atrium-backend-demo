/**
 * SPEC §10.5 people requests - 11 story records (S-P1..S-P11, reference numbers 1..11,
 * SPEC_RESOLUTIONS #21) plus 4 filler records (12..15). Pure data; `people.seed.ts` writes
 * rows, comments, audit history and in-app notifications from it. The frontend MSW seed
 * mirrors these values.
 *
 * Times are `[dayOffset, hour, minute]` relative to SEED_TODAY in APP_TIMEZONE.
 * Users are core seed handles (persona keys, `priya`, `hilTech6`, `ppl3`...).
 */

export type At = [day: number, hour: number, minute: number];

export interface StoryEvent {
  action: 'start_work' | 'wait_internal' | 'wait_on_requester' | 'resume' | 'complete' | 'reject' | 'cancel' | 'reopen';
  by: string;
  at: At;
  note?: string;
  question?: string;
  reason?: string;
}

export interface StoryComment {
  by: string;
  at: At;
  body: string;
  internal?: boolean;
}

export interface StoryPersonalData {
  birthDate: string;
  placeOfBirth: string | null;
  nationality: string | null;
  privateAddress: { street: string; houseNumber: string; postalCode: string; city: string; countryCode: string } | null;
  privatePhone: string | null;
  privateEmail: string | null;
}

export interface StoryPeopleRequest {
  key: string;
  number: number;
  type: 'onboarding' | 'offboarding' | 'role_change';
  title: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  requester: string;
  subject?: string;
  salutation?: 'mr' | 'ms' | 'mx';
  firstName?: string;
  lastName?: string;
  jobRole?: string;
  department?: string;
  site?: string;
  manager?: string;
  managerDeputy?: string;
  effective: number;
  reason?: string;
  furtherInformation?: string;
  equipmentNotes?: string;
  personalData?: StoryPersonalData;
  internalNote?: string;
  createdAt: At;
  history: StoryEvent[];
  comments: StoryComment[];
}

/** SPEC §4.5: 37 job roles. */
export const JOB_ROLES: { name: string; category: string }[] = [
  ['Project Manager', 'Projects'],
  ['Senior Project Manager', 'Projects'],
  ['Field Technician', 'Field Services'],
  ['Senior Field Technician', 'Field Services'],
  ['Field Service Team Lead', 'Field Services'],
  ['Site Manager', 'Field Services'],
  ['Dispatcher', 'Field Services'],
  ['Service Coordinator', 'Field Services'],
  ['Service Desk Agent', 'Service Desk'],
  ['Senior Service Desk Agent', 'Service Desk'],
  ['Service Desk Team Lead', 'Service Desk'],
  ['Workplace Engineer', 'IT Operations'],
  ['Network Engineer', 'IT Operations'],
  ['Systems Administrator', 'IT Operations'],
  ['Cloud Engineer', 'IT Operations'],
  ['Security Analyst', 'IT Operations'],
  ['Asset Manager', 'IT Operations'],
  ['IT Technician', 'IT Operations'],
  ['Logistics Coordinator', 'Logistics'],
  ['Warehouse Operator', 'Logistics'],
  ['Procurement Specialist', 'Finance & Administration'],
  ['Travel Coordinator', 'Finance & Administration'],
  ['Accountant', 'Finance & Administration'],
  ['Controller', 'Finance & Administration'],
  ['Payroll Specialist', 'Finance & Administration'],
  ['People Operations Partner', 'People & Workplace'],
  ['People Ops Specialist', 'People & Workplace'],
  ['Recruiter', 'People & Workplace'],
  ['Learning & Development Coordinator', 'People & Workplace'],
  ['Office Manager', 'People & Workplace'],
  ['Executive Assistant', 'Executive Office'],
  ['Quality Manager', 'Quality'],
  ['Data Analyst', 'Data & Software'],
  ['Software Developer', 'Data & Software'],
  ['Product Owner', 'Data & Software'],
  ['Account Manager', 'Sales'],
  ['Apprentice', 'Training'],
].map(([name, category]) => ({ name, category }));

export const PEOPLE_STORY: StoryPeopleRequest[] = [
  {
    key: 'S-P1',
    number: 1,
    type: 'onboarding',
    title: 'Field Technician – Hillford',
    priority: 'high',
    requester: 'max',
    salutation: 'mr',
    firstName: 'Jonah',
    lastName: 'Weller',
    jobRole: 'Field Technician',
    department: 'FLD',
    site: 'HIL',
    manager: 'sofia',
    effective: 14,
    reason: 'Replacement hire for the Hillford field team.',
    furtherInformation: 'Jonah holds a valid driving licence for vans up to 3.5 t.',
    equipmentNotes: 'Laptop, phone, van key card.',
    personalData: {
      birthDate: '1994-03-18',
      placeOfBirth: 'Northport',
      nationality: 'DE',
      privateAddress: {
        street: 'Mill Lane',
        houseNumber: '12',
        postalCode: '10115',
        city: 'Riverton',
        countryCode: 'DE',
      },
      privatePhone: '555-0187',
      privateEmail: 'jonah.weller@example.com',
    },
    createdAt: [-5, 9, 12],
    history: [{ action: 'start_work', by: 'paula', at: [-4, 10, 5], note: 'Laptop and van access are requested.' }],
    comments: [
      { by: 'max', at: [-5, 9, 15], body: 'Jonah joins the Hillford team; Sofia onboards him on site.' },
      {
        by: 'paula',
        at: [-4, 10, 7],
        body: 'Contract signed. Waiting for the signed data protection form.',
        internal: true,
      },
      { by: 'sofia', at: [-3, 14, 20], body: 'Please add him to the Hillford dispatch group as well.' },
    ],
  },
  {
    key: 'S-P2',
    number: 2,
    type: 'onboarding',
    title: 'Dispatcher – Riverton',
    priority: 'normal',
    requester: 'max',
    salutation: 'ms',
    firstName: 'Lena',
    lastName: 'Hartwell',
    jobRole: 'Dispatcher',
    department: 'FLD',
    site: 'RIV',
    manager: 'max',
    effective: -20,
    reason: 'Second dispatcher for the Riverton desk.',
    equipmentNotes: 'Laptop with two screens, headset.',
    personalData: {
      birthDate: '1990-11-02',
      placeOfBirth: 'Westbay',
      nationality: 'GB',
      privateAddress: {
        street: 'Harbour Road',
        houseNumber: '7a',
        postalCode: '20095',
        city: 'Westbay',
        countryCode: 'DE',
      },
      privatePhone: '555-0142',
      privateEmail: 'lena.hartwell@example.com',
    },
    createdAt: [-40, 10, 30],
    history: [
      { action: 'start_work', by: 'paula', at: [-38, 9, 0] },
      { action: 'complete', by: 'paula', at: [-21, 16, 45], note: 'Accounts, badge and phone are ready.' },
    ],
    comments: [
      { by: 'max', at: [-40, 10, 32], body: 'Lena joins the Riverton dispatch desk.' },
      { by: 'paula', at: [-30, 11, 10], body: 'IT accounts requested.', internal: true },
    ],
  },
  {
    key: 'S-P3',
    number: 3,
    type: 'offboarding',
    title: 'Leaver: Field Technician Hillford',
    priority: 'normal',
    requester: 'max',
    subject: 'formerHilTech',
    manager: 'sofia',
    effective: -45,
    reason: 'Resignation; last working day after the Hillford handover.',
    equipmentNotes: 'Collect laptop, phone and van key card.',
    createdAt: [-60, 14, 0],
    history: [
      { action: 'start_work', by: 'ppl3', at: [-58, 9, 30] },
      { action: 'complete', by: 'ppl3', at: [-44, 15, 20], note: 'Equipment returned, accounts closed.' },
    ],
    comments: [
      { by: 'max', at: [-60, 14, 2], body: 'Last working day after the Hillford handover.' },
      { by: 'ppl3', at: [-50, 10, 0], body: 'Exit interview scheduled.', internal: true },
    ],
  },
  {
    key: 'S-P4',
    number: 4,
    type: 'role_change',
    title: 'Access to the dispatch planning board',
    priority: 'normal',
    requester: 'emma',
    subject: 'emma',
    manager: 'max',
    effective: 7,
    reason: 'I coordinate Riverton field jobs and need to see the planning board.',
    createdAt: [-6, 11, 20],
    history: [
      { action: 'start_work', by: 'paula', at: [-5, 9, 30] },
      {
        action: 'wait_on_requester',
        by: 'paula',
        at: [-2, 15, 10],
        question: 'Which regions do you need to plan for?',
      },
    ],
    comments: [
      {
        by: 'emma',
        at: [-6, 11, 22],
        body: 'I would like to plan the Riverton technicians directly instead of asking dispatch.',
      },
      { by: 'paula', at: [-5, 9, 32], body: 'Board access needs a region list from the requester.', internal: true },
    ],
  },
  {
    key: 'S-P5',
    number: 5,
    type: 'offboarding',
    title: 'Technician leaving Hillford',
    priority: 'normal',
    requester: 'sofia',
    subject: 'hilTech6',
    manager: 'sofia',
    effective: 30,
    reason: 'Moves to a partner company.',
    equipmentNotes: 'Van key card and tablet to be returned on the last day.',
    createdAt: [-1, 16, 40],
    history: [],
    comments: [
      { by: 'sofia', at: [-1, 16, 42], body: 'Handover plan follows next week.' },
      { by: 'sofia', at: [-1, 16, 50], body: 'Please collect the van key card on the last day.' },
    ],
  },
  {
    key: 'S-P6',
    number: 6,
    type: 'onboarding',
    title: 'Service Desk Agent – Campus',
    priority: 'normal',
    requester: 'priya',
    salutation: 'ms',
    firstName: 'Ava',
    lastName: 'Lindgren',
    jobRole: 'Service Desk Agent',
    department: 'SDK',
    site: 'CAM',
    manager: 'priya',
    managerDeputy: 'sdkLead',
    effective: 12,
    reason: 'New agent for the second-level queue.',
    equipmentNotes: 'Laptop, headset, two screens.',
    personalData: {
      birthDate: '1998-06-24',
      placeOfBirth: 'Lakeside',
      nationality: 'SE',
      privateAddress: {
        street: 'Birch Avenue',
        houseNumber: '31',
        postalCode: '30159',
        city: 'Lakeside',
        countryCode: 'DE',
      },
      privatePhone: '555-0163',
      privateEmail: 'ava.lindgren@example.com',
    },
    internalNote: 'Waiting for laptop from IT stock',
    createdAt: [-9, 10, 0],
    history: [
      { action: 'start_work', by: 'paula', at: [-8, 9, 15] },
      { action: 'wait_internal', by: 'paula', at: [-3, 13, 40], note: 'Waiting for laptop from IT stock' },
    ],
    comments: [
      { by: 'priya', at: [-9, 10, 3], body: 'Ava starts in the Campus service desk team.' },
      { by: 'paula', at: [-8, 9, 17], body: 'Accounts requested.', internal: true },
    ],
  },
  {
    key: 'S-P7',
    number: 7,
    type: 'role_change',
    title: 'Recruiter → Senior Recruiter access',
    priority: 'normal',
    requester: 'grace',
    subject: 'ppl1',
    manager: 'grace',
    effective: 10,
    reason: 'Promotion to senior recruiter; needs the applicant reports.',
    createdAt: [-4, 13, 0],
    history: [{ action: 'start_work', by: 'ppl3', at: [-3, 10, 20], note: 'Access request sent to IT Operations.' }],
    comments: [
      { by: 'grace', at: [-4, 13, 2], body: 'Needs access to the applicant tracking reports.' },
      { by: 'ppl3', at: [-3, 10, 22], body: 'Check the report licence with IT Operations.', internal: true },
    ],
  },
  {
    key: 'S-P8',
    number: 8,
    type: 'onboarding',
    title: 'Cloud Engineer – Campus',
    priority: 'critical',
    requester: 'victor',
    salutation: 'mr',
    firstName: 'Felix',
    lastName: 'Brandner',
    jobRole: 'Cloud Engineer',
    department: 'ITO',
    site: 'CAM',
    manager: 'victor',
    effective: 5,
    reason: 'Start date moved forward for the platform migration.',
    equipmentNotes: 'Laptop with docking station, security key.',
    personalData: {
      birthDate: '1989-01-09',
      placeOfBirth: 'Highmoor',
      nationality: 'AT',
      privateAddress: null,
      privatePhone: '555-0171',
      privateEmail: null,
    },
    createdAt: [-1, 17, 5],
    history: [],
    comments: [
      { by: 'victor', at: [-1, 17, 6], body: 'He needs cloud console access on day one.' },
      { by: 'victor', at: [-1, 17, 10], body: 'Private address follows once he has moved.' },
    ],
  },
  {
    key: 'S-P9',
    number: 9,
    type: 'onboarding',
    title: 'Senior Field Technician – Riverton',
    priority: 'normal',
    requester: 'max',
    salutation: 'mr',
    firstName: 'Tobias',
    lastName: 'Renwick',
    jobRole: 'Senior Field Technician',
    department: 'FLD',
    site: 'RIV',
    manager: 'max',
    effective: -8,
    reason: 'Experienced technician for the Riverton depot.',
    equipmentNotes: 'Laptop, phone, depot badge.',
    personalData: {
      birthDate: '1985-09-30',
      placeOfBirth: 'Oakridge',
      nationality: 'DE',
      privateAddress: {
        street: 'Station Street',
        houseNumber: '4',
        postalCode: '10178',
        city: 'Riverton',
        countryCode: 'DE',
      },
      privatePhone: '555-0154',
      privateEmail: 'tobias.renwick@example.com',
    },
    createdAt: [-25, 9, 40],
    history: [
      { action: 'start_work', by: 'paula', at: [-24, 10, 0] },
      { action: 'complete', by: 'paula', at: [-6, 16, 0], note: 'All accounts and the badge are set up.' },
      { action: 'reopen', by: 'paula', at: [-2, 9, 15], reason: 'Building badge was not activated.' },
    ],
    comments: [
      { by: 'max', at: [-25, 9, 42], body: 'Tobias leads the depot jobs from day one.' },
      { by: 'max', at: [-3, 8, 50], body: 'His badge does not open the Riverton depot.' },
      { by: 'paula', at: [-2, 9, 17], body: 'Facility team informed.', internal: true },
    ],
  },
  {
    key: 'S-P10',
    number: 10,
    type: 'onboarding',
    title: 'Service Desk Agent – Campus',
    priority: 'normal',
    requester: 'priya',
    salutation: 'ms',
    firstName: 'Ava',
    lastName: 'Lindgren',
    jobRole: 'Service Desk Agent',
    department: 'SDK',
    site: 'CAM',
    manager: 'priya',
    effective: 12,
    createdAt: [-9, 10, 6],
    history: [{ action: 'reject', by: 'paula', at: [-8, 9, 20], reason: 'Duplicate of PPL-000006' }],
    comments: [
      { by: 'paula', at: [-8, 9, 21], body: 'Closing this one; we continue on PPL-000006.' },
      { by: 'priya', at: [-8, 11, 0], body: 'Thanks, sent it twice by mistake.' },
    ],
  },
  {
    key: 'S-P11',
    number: 11,
    type: 'onboarding',
    title: 'Security Analyst – Campus',
    priority: 'high',
    requester: 'victor',
    salutation: 'mx',
    firstName: 'Robin',
    lastName: 'Carrow',
    jobRole: 'Security Analyst',
    department: 'ITO',
    site: 'CAM',
    manager: 'victor',
    effective: 20,
    createdAt: [-15, 11, 0],
    history: [
      { action: 'start_work', by: 'ppl3', at: [-14, 9, 0] },
      { action: 'cancel', by: 'victor', at: [-10, 12, 30], reason: 'Candidate withdrew' },
    ],
    comments: [
      { by: 'victor', at: [-15, 11, 2], body: 'Offer accepted today.' },
      { by: 'ppl3', at: [-14, 9, 2], body: 'Background check initiated.', internal: true },
    ],
  },
  // --- Filler (distribution: SPEC §10.5) ---------------------------------------------
  {
    key: 'F-12',
    number: 12,
    type: 'offboarding',
    title: 'Service Desk Agent leaving Campus',
    priority: 'normal',
    requester: 'priya',
    subject: 'sdkAgent8',
    effective: 21,
    reason: 'Fixed-term contract ends.',
    createdAt: [-7, 15, 0],
    history: [{ action: 'start_work', by: 'ppl3', at: [-6, 9, 45] }],
    comments: [
      { by: 'priya', at: [-7, 15, 2], body: 'Please plan the handover of the open tickets.' },
      { by: 'ppl3', at: [-6, 9, 47], body: 'Exit checklist started.', internal: true },
    ],
  },
  {
    key: 'F-13',
    number: 13,
    type: 'role_change',
    title: 'Cloud Engineer → Security Analyst',
    priority: 'normal',
    requester: 'victor',
    subject: 'ito2',
    jobRole: 'Security Analyst',
    effective: 10,
    reason: 'Internal move into the security team.',
    internalNote: 'Waiting for security clearance from IT Operations',
    createdAt: [-12, 10, 0],
    history: [
      { action: 'start_work', by: 'paula', at: [-11, 9, 0] },
      {
        action: 'wait_internal',
        by: 'paula',
        at: [-4, 14, 0],
        note: 'Waiting for security clearance from IT Operations',
      },
    ],
    comments: [
      { by: 'victor', at: [-12, 10, 2], body: 'The move is agreed with both team leads.' },
      { by: 'paula', at: [-11, 9, 2], body: 'We update the role once IT Operations confirms.' },
    ],
  },
  {
    key: 'F-14',
    number: 14,
    type: 'role_change',
    title: 'Planning board access – Eastgate',
    priority: 'high',
    requester: 'easLead',
    subject: 'easTech2',
    effective: 14,
    reason: 'Covers dispatch during the team lead’s leave.',
    createdAt: [-8, 8, 30],
    history: [
      { action: 'start_work', by: 'paula', at: [-7, 9, 10] },
      {
        action: 'wait_on_requester',
        by: 'paula',
        at: [-1, 11, 30],
        question: 'Should the access include the Lakeside region too?',
      },
    ],
    comments: [{ by: 'easLead', at: [-8, 8, 32], body: 'Read access is enough; no editing rights needed.' }],
  },
  {
    key: 'F-15',
    number: 15,
    type: 'offboarding',
    title: 'Leaver: Service Desk Agent Campus',
    priority: 'low',
    requester: 'priya',
    subject: 'formerSdkAgent',
    effective: -60,
    reason: 'Resignation.',
    createdAt: [-75, 10, 0],
    history: [
      { action: 'start_work', by: 'ppl3', at: [-74, 9, 0] },
      { action: 'complete', by: 'ppl3', at: [-59, 16, 0], note: 'Accounts closed, headset returned.' },
    ],
    comments: [
      { by: 'priya', at: [-75, 10, 2], body: 'Last day is confirmed.' },
      { by: 'ppl3', at: [-65, 10, 0], body: 'Exit interview done.', internal: true },
    ],
  },
];
