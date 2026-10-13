/**
 * SPEC §10.6 news posts (S-N1..S-N8) and the 10 useful links. Pure data, mirrored by the
 * frontend MSW seed. Times are `[dayOffset, hour, minute]` relative to SEED_TODAY.
 */

export type At = [day: number, hour: number, minute: number];

export interface StoryNewsPost {
  key: string;
  title: string;
  type: 'changelog' | 'update' | 'information';
  status: 'draft' | 'scheduled' | 'published' | 'archived';
  summary: string;
  bodyHtml: string;
  author: string;
  pinned?: boolean;
  cover?: boolean;
  createdAt: At;
  publishedAt?: At;
  publishAt?: At;
  expireAt?: At;
  archivedAt?: At;
}

export const NEWS_STORY: StoryNewsPost[] = [
  {
    key: 'S-N1',
    title: 'Welcome to Atrium',
    type: 'information',
    status: 'published',
    pinned: true,
    cover: true,
    author: 'paula',
    summary:
      'Training, travel, devices and people requests now live in one place, and every request shows whose desk it is on.',
    bodyHtml: [
      '<p>Atrium replaces the separate request forms and the long email threads that came with them. Everything you ask for now travels through one place, and you can always see where it is.</p>',
      '<h2>What you can do here</h2>',
      '<ul><li><strong>Training</strong>: request a course for yourself or your team, set learning goals and give feedback.</li><li><strong>Travel</strong>: book car rentals, train journeys and flights. Atrium tells you before you submit whether a trip needs approval.</li><li><strong>My devices</strong>: confirm the laptops and phones assigned to you.</li><li><strong>People requests</strong>: start an onboarding, an offboarding or a role change.</li></ul>',
      '<h2>Whose desk is it on?</h2>',
      '<p>Every request shows its route: who asked, who approves and which desk books it. The highlighted stop is where it sits right now.</p>',
      '<p>Questions? Write to <a href="mailto:people-ops@example.com">People Ops</a> or open the <a href="https://wiki.example.com/atrium">Atrium guide</a> in the wiki.</p>',
    ].join(''),
    createdAt: [-14, 9, 0],
    publishedAt: [-12, 9, 0],
  },
  {
    key: 'S-N2',
    title: 'Atrium update: deputies with validity windows',
    type: 'changelog',
    status: 'published',
    author: 'ian',
    summary:
      'Name a deputy for your approvals from one date to another. Atrium routes requests to them only inside that window.',
    bodyHtml: [
      '<p>Managers and executives can now give each deputy a start and an end date. Outside that window the deputy no longer sees your approvals.</p>',
      '<h3>How to set it up</h3>',
      '<ol><li>Open <strong>Settings → Deputies</strong>.</li><li>Choose a colleague and, optionally, a date range.</li><li>Add a note such as "Annual leave" so your team knows why.</li></ol>',
      '<p>Deputies can approve training and travel requests for you, but never their own.</p>',
    ].join(''),
    createdAt: [-5, 16, 0],
    publishedAt: [-4, 10, 30],
  },
  {
    key: 'S-N3',
    title: 'Hillford site: new parking arrangement',
    type: 'information',
    status: 'published',
    author: 'paula',
    summary:
      'From next month visitors park in the north lot. Staff permits stay valid; the barrier code changes on the same day.',
    bodyHtml: [
      '<p>The south lot at Hillford is being resurfaced, so visitor parking moves to the north lot from the first of next month.</p>',
      '<ul><li>Staff permits stay valid in both lots.</li><li>The new barrier code is shared by the site manager one week before the change.</li><li>Van bays near the workshop are not affected.</li></ul>',
      '<p>Questions go to Sofia Site-Manager.</p>',
    ].join(''),
    createdAt: [-7, 15, 0],
    publishedAt: [-6, 8, 15],
  },
  {
    key: 'S-N4',
    title: 'Travel desk hours during the holidays',
    type: 'update',
    status: 'published',
    author: 'paula',
    summary: 'The travel desk works reduced hours over the holidays. Book trips for early January before the break.',
    bodyHtml: [
      '<p>Between the holidays the travel desk answers requests from 09:00 to 12:00 on working days.</p>',
      '<p>Trips that start in the first week of January should be requested before the break, so the desk can book them in time.</p>',
      '<blockquote>Urgent changes to an existing booking: call the travel desk line listed in the wiki.</blockquote>',
    ].join(''),
    createdAt: [-3, 10, 0],
    publishedAt: [-2, 11, 0],
    expireAt: [40, 18, 0],
  },
  {
    key: 'S-N5',
    title: 'Quarterly town hall at Campus',
    type: 'information',
    status: 'scheduled',
    author: 'paula',
    summary: 'Clara CEO shares the results of the quarter and the plans for the next one. Join in person or online.',
    bodyHtml: [
      '<p>The quarterly town hall takes place in the Campus auditorium. Doors open 15 minutes before the start.</p>',
      '<ul><li>Results of the quarter</li><li>Plans for the field teams</li><li>Open questions from the team</li></ul>',
      '<p>Send your questions in advance to <a href="mailto:people-ops@example.com">People Ops</a>.</p>',
    ].join(''),
    createdAt: [-1, 14, 0],
    publishAt: [2, 8, 0],
  },
  {
    key: 'S-N6',
    title: 'New laptop models in IT stock',
    type: 'update',
    status: 'scheduled',
    author: 'paula',
    summary: 'IT Operations adds two new laptop models to the stock. Replacements are handed out in the usual order.',
    bodyHtml: [
      '<p>Two new laptop models arrive in IT stock. They replace the oldest devices first.</p>',
      '<p>You will see the new device in <strong>My devices</strong> once it is assigned to you. Confirm it there when you receive it.</p>',
    ].join(''),
    createdAt: [-1, 15, 0],
    publishAt: [9, 8, 0],
  },
  {
    key: 'S-N7',
    title: 'Training budget for next year',
    type: 'information',
    status: 'draft',
    author: 'paula',
    summary: 'How the training budget is split across the teams next year, and how to plan your requests.',
    bodyHtml: '<p>Draft: figures to be confirmed with Finance &amp; Administration.</p>',
    createdAt: [-2, 9, 30],
  },
  {
    key: 'S-N8',
    title: 'Summer get-together recap',
    type: 'information',
    status: 'archived',
    author: 'paula',
    summary: 'Thanks to everyone who joined the summer get-together at Riverton.',
    bodyHtml: '<p>More than a hundred colleagues came to Riverton for the summer get-together. Thank you all.</p>',
    createdAt: [-92, 9, 0],
    publishedAt: [-90, 9, 0],
    archivedAt: [-60, 9, 0],
  },
];

export interface StoryLink {
  title: string;
  url: string;
  description: string;
  icon: string;
  category: string;
  active: boolean;
}

/** SPEC §10.6: 10 links on fictional example.com hosts; one inactive (editors only). */
export const LINKS_STORY: StoryLink[] = [
  {
    title: 'Wiki',
    url: 'https://wiki.example.com',
    description: 'Guides, how-tos and team pages.',
    icon: 'book',
    category: 'Work',
    active: true,
  },
  {
    title: 'Canteen menu',
    url: 'https://canteen.example.com',
    description: "This week's menu at Riverton and Campus.",
    icon: 'utensils',
    category: 'Workplace',
    active: true,
  },
  {
    title: 'Expense claims',
    url: 'https://expenses.example.com',
    description: 'Submit receipts and track reimbursements.',
    icon: 'receipt',
    category: 'Travel & expenses',
    active: true,
  },
  {
    title: 'Hotel booking portal',
    url: 'https://hotels.example.com',
    description: 'Company rates for business trips.',
    icon: 'bed',
    category: 'Travel & expenses',
    active: true,
  },
  {
    title: 'IT service portal',
    url: 'https://it.example.com',
    description: 'Report an incident or ask for help.',
    icon: 'life-buoy',
    category: 'Help',
    active: true,
  },
  {
    title: 'Holiday calendar',
    url: 'https://calendar.example.com',
    description: 'Public holidays per site.',
    icon: 'calendar',
    category: 'Workplace',
    active: true,
  },
  {
    title: 'Org chart',
    url: 'https://org.example.com',
    description: 'Who reports to whom.',
    icon: 'network',
    category: 'Work',
    active: true,
  },
  {
    title: 'Brand assets',
    url: 'https://brand.example.com',
    description: 'Logos, templates and fonts.',
    icon: 'palette',
    category: 'Work',
    active: false,
  },
  {
    title: 'Safety handbook',
    url: 'https://safety.example.com',
    description: 'Rules for field work and workshops.',
    icon: 'shield',
    category: 'Help',
    active: true,
  },
  {
    title: 'Benefits overview',
    url: 'https://benefits.example.com',
    description: 'Health, mobility and wellbeing benefits.',
    icon: 'heart',
    category: 'People',
    active: true,
  },
];
