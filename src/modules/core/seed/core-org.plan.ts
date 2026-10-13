import type { Faker } from '@faker-js/faker';
import type { AssignableRole, PersonaKey } from '@/common/domain/vocabulary';
import { personaEmail } from '../auth/personas.catalog';

/**
 * The core org (SPEC §2, §10.1) as a pure, deterministic plan: same faker seed => same names
 * and the same UUIDs, independent of "today" (timestamps are fixed). Used by core.seed.ts and
 * by `pnpm seed:export-users` (frontend users.json, SPEC_RESOLUTIONS #5).
 */

export const SITES = [
  { code: 'RIV', name: 'Riverton' },
  { code: 'CAM', name: 'Campus' },
  { code: 'HIL', name: 'Hillford' },
  { code: 'EAS', name: 'Eastgate' },
] as const;

export const DEPARTMENTS = [
  { code: 'EXO', name: 'Executive Office' },
  { code: 'FLD', name: 'Field Services' },
  { code: 'SDK', name: 'Service Desk' },
  { code: 'ITO', name: 'IT Operations' },
  { code: 'FIN', name: 'Finance & Administration' },
  { code: 'PPL', name: 'People & Workplace' },
] as const;

export const COST_CENTERS = [
  { code: 'CC-1000', name: 'Executive Office', dept: 'EXO' },
  { code: 'CC-2100', name: 'Field Services Riverton', dept: 'FLD' },
  { code: 'CC-2200', name: 'Field Services Hillford', dept: 'FLD' },
  { code: 'CC-2300', name: 'Field Services Eastgate', dept: 'FLD' },
  { code: 'CC-3100', name: 'Service Desk', dept: 'SDK' },
  { code: 'CC-4100', name: 'IT Operations', dept: 'ITO' },
  { code: 'CC-4900', name: 'IT Stock', dept: 'ITO' },
  { code: 'CC-5100', name: 'Finance & Administration', dept: 'FIN' },
  { code: 'CC-6100', name: 'People & Workplace', dept: 'PPL' },
] as const;

type Dept = (typeof DEPARTMENTS)[number]['code'];
type SiteCode = (typeof SITES)[number]['code'];

interface UserSpec {
  /** Stable handle used for reporting lines inside this file. */
  handle: string;
  firstName?: string;
  lastName?: string;
  jobTitle: string;
  dept: Dept;
  site: SiteCode;
  costCenter: string;
  manager: string | null;
  persona?: PersonaKey;
  roles?: AssignableRole[];
  isSiteManager?: boolean;
  active?: boolean;
}

const NAMED: UserSpec[] = [
  {
    handle: 'clara',
    persona: 'clara',
    firstName: 'Clara',
    lastName: 'CEO',
    jobTitle: 'Chief Executive Officer',
    dept: 'EXO',
    site: 'CAM',
    costCenter: 'CC-1000',
    manager: null,
    roles: ['executive'],
  },
  {
    handle: 'max',
    persona: 'max',
    firstName: 'Max',
    lastName: 'Manager',
    jobTitle: 'Head of Field Services',
    dept: 'FLD',
    site: 'RIV',
    costCenter: 'CC-2100',
    manager: 'clara',
  },
  {
    handle: 'priya',
    firstName: 'Priya',
    lastName: 'Raman',
    jobTitle: 'Head of Service Desk',
    dept: 'SDK',
    site: 'CAM',
    costCenter: 'CC-3100',
    manager: 'clara',
  },
  {
    handle: 'victor',
    firstName: 'Victor',
    lastName: 'Lang',
    jobTitle: 'Head of IT Operations',
    dept: 'ITO',
    site: 'CAM',
    costCenter: 'CC-4100',
    manager: 'clara',
  },
  {
    handle: 'helen',
    firstName: 'Helen',
    lastName: 'Brooks',
    jobTitle: 'Chief Financial Officer',
    dept: 'FIN',
    site: 'RIV',
    costCenter: 'CC-5100',
    manager: 'clara',
    roles: ['executive'],
  },
  {
    handle: 'grace',
    firstName: 'Grace',
    lastName: 'Holloway',
    jobTitle: 'Head of People & Workplace',
    dept: 'PPL',
    site: 'RIV',
    costCenter: 'CC-6100',
    manager: 'clara',
  },
  {
    handle: 'emma',
    persona: 'emma',
    firstName: 'Emma',
    lastName: 'Employee',
    jobTitle: 'Service Coordinator',
    dept: 'FLD',
    site: 'RIV',
    costCenter: 'CC-2100',
    manager: 'max',
  },
  {
    handle: 'sofia',
    persona: 'sofia',
    firstName: 'Sofia',
    lastName: 'Site-Manager',
    jobTitle: 'Site Manager Hillford',
    dept: 'FLD',
    site: 'HIL',
    costCenter: 'CC-2200',
    manager: 'max',
    isSiteManager: true,
  },
  {
    handle: 'tom',
    persona: 'tom',
    firstName: 'Tom',
    lastName: 'Travel-Desk',
    jobTitle: 'Travel Coordinator',
    dept: 'FIN',
    site: 'RIV',
    costCenter: 'CC-5100',
    manager: 'helen',
    roles: ['travel_desk'],
  },
  {
    handle: 'tina',
    persona: 'tina',
    firstName: 'Tina',
    lastName: 'Training-Office',
    jobTitle: 'Learning & Development Coordinator',
    dept: 'PPL',
    site: 'RIV',
    costCenter: 'CC-6100',
    manager: 'grace',
    roles: ['training_office'],
  },
  {
    handle: 'arne',
    persona: 'arne',
    firstName: 'Arne',
    lastName: 'Assets',
    jobTitle: 'Asset Manager',
    dept: 'ITO',
    site: 'CAM',
    costCenter: 'CC-4100',
    manager: 'victor',
    roles: ['asset_admin'],
  },
  {
    handle: 'paula',
    persona: 'paula',
    firstName: 'Paula',
    lastName: 'People-Ops',
    jobTitle: 'People Operations Partner',
    dept: 'PPL',
    site: 'RIV',
    costCenter: 'CC-6100',
    manager: 'grace',
    roles: ['people_ops', 'news_editor'],
  },
  {
    handle: 'ian',
    persona: 'ian',
    firstName: 'Ian',
    lastName: 'IT-Admin',
    jobTitle: 'Systems Administrator',
    dept: 'ITO',
    site: 'CAM',
    costCenter: 'CC-4100',
    manager: 'victor',
    roles: ['it_admin'],
  },
];

/** SPEC §2.4 generated employees (names from seeded faker). */
function generatedSpecs(): UserSpec[] {
  const specs: UserSpec[] = [];
  const add = (count: number, spec: Omit<UserSpec, 'handle'>, prefix: string) => {
    for (let i = 1; i <= count; i++) specs.push({ ...spec, handle: `${prefix}${count > 1 ? i : ''}` });
  };
  add(
    1,
    { jobTitle: 'Executive Assistant', dept: 'EXO', site: 'CAM', costCenter: 'CC-1000', manager: 'clara' },
    'exoAssistant',
  );
  add(
    6,
    { jobTitle: 'Field Technician', dept: 'FLD', site: 'HIL', costCenter: 'CC-2200', manager: 'sofia' },
    'hilTech',
  );
  add(
    1,
    { jobTitle: 'Team Lead Field Services Eastgate', dept: 'FLD', site: 'EAS', costCenter: 'CC-2300', manager: 'max' },
    'easLead',
  );
  add(
    5,
    { jobTitle: 'Field Technician', dept: 'FLD', site: 'EAS', costCenter: 'CC-2300', manager: 'easLead' },
    'easTech',
  );
  add(1, { jobTitle: 'Dispatcher', dept: 'FLD', site: 'RIV', costCenter: 'CC-2100', manager: 'max' }, 'rivDispatcher');
  add(
    1,
    { jobTitle: 'Senior Field Technician', dept: 'FLD', site: 'RIV', costCenter: 'CC-2100', manager: 'max' },
    'rivSeniorTech',
  );
  add(
    1,
    { jobTitle: 'Service Desk Team Lead', dept: 'SDK', site: 'CAM', costCenter: 'CC-3100', manager: 'priya' },
    'sdkLead',
  );
  for (let i = 1; i <= 8; i++) {
    specs.push({
      handle: `sdkAgent${i}`,
      jobTitle: 'Service Desk Agent',
      dept: 'SDK',
      site: 'CAM',
      costCenter: 'CC-3100',
      manager: i <= 4 ? 'sdkLead' : 'priya',
    });
  }
  const ito = ['Network Engineer', 'Cloud Engineer', 'Security Analyst', 'Workplace Engineer', 'IT Technician'];
  ito.forEach((jobTitle, i) =>
    specs.push({
      handle: `ito${i + 1}`,
      jobTitle,
      dept: 'ITO',
      site: 'CAM',
      costCenter: 'CC-4100',
      manager: 'victor',
      roles: jobTitle === 'IT Technician' ? ['asset_admin'] : undefined,
    }),
  );
  ['Accountant', 'Controller', 'Procurement Specialist', 'Payroll Specialist'].forEach((jobTitle, i) =>
    specs.push({ handle: `fin${i + 1}`, jobTitle, dept: 'FIN', site: 'RIV', costCenter: 'CC-5100', manager: 'helen' }),
  );
  const ppl: [string, AssignableRole[] | undefined][] = [
    ['Recruiter', undefined],
    ['Office Manager', undefined],
    ['People Ops Specialist', ['people_ops']],
    ['L&D Assistant', ['training_office']],
  ];
  ppl.forEach(([jobTitle, roles], i) =>
    specs.push({
      handle: `ppl${i + 1}`,
      jobTitle,
      dept: 'PPL',
      site: 'RIV',
      costCenter: 'CC-6100',
      manager: 'grace',
      roles,
    }),
  );
  specs.push({
    handle: 'formerHilTech',
    jobTitle: 'Field Technician',
    dept: 'FLD',
    site: 'HIL',
    costCenter: 'CC-2200',
    manager: 'sofia',
    active: false,
  });
  specs.push({
    handle: 'formerSdkAgent',
    jobTitle: 'Service Desk Agent',
    dept: 'SDK',
    site: 'CAM',
    costCenter: 'CC-3100',
    manager: 'priya',
    active: false,
  });
  return specs;
}

function emailLocal(firstName: string, lastName: string): string {
  return personaEmail(firstName, lastName)
    .replace('@example.com', '')
    .replace(/[^a-z0-9.-]/g, '');
}

/** Fixed creation time of the org (UUIDs must not depend on the seed day). */
export const ORG_EPOCH = Date.UTC(2024, 0, 15, 8, 0, 0);
const DAY_MS = 86_400_000;

export interface PlannedUser {
  handle: string;
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  jobTitle: string;
  employeeNumber: string;
  phone: string;
  personaKey: PersonaKey | null;
  roles: AssignableRole[];
  isSiteManager: boolean;
  active: boolean;
  managerHandle: string | null;
  managerId: string | null;
  departmentCode: Dept;
  siteCode: SiteCode;
  costCenterCode: string;
  createdAt: Date;
}

export interface CoreOrgPlan {
  sites: { id: string; code: string; name: string; createdAt: Date }[];
  departments: { id: string; code: Dept; name: string; headHandle: string; createdAt: Date }[];
  costCenters: { id: string; code: string; name: string; departmentCode: Dept; createdAt: Date }[];
  users: PlannedUser[];
}

const HEADS: Record<Dept, string> = {
  EXO: 'clara',
  FLD: 'max',
  SDK: 'priya',
  ITO: 'victor',
  FIN: 'helen',
  PPL: 'grace',
};

/** Builds the org. `uuid` must be the seed context's deterministic UUIDv7 factory. */
export function planCoreOrg(faker: Faker, uuid: (createdAt: Date) => string): CoreOrgPlan {
  const at = (offsetMs: number) => new Date(ORG_EPOCH + offsetMs);
  const sites = SITES.map((site, i) => ({ id: uuid(at(i)), ...site, createdAt: at(0) }));
  const departments = DEPARTMENTS.map((d, i) => ({
    id: uuid(at(10 + i)),
    ...d,
    headHandle: HEADS[d.code],
    createdAt: at(0),
  }));
  const costCenters = COST_CENTERS.map((cc, i) => ({
    id: uuid(at(20 + i)),
    code: cc.code,
    name: cc.name,
    departmentCode: cc.dept,
    createdAt: at(0),
  }));

  // Named first (personas + heads), then generated - creation order defines E-numbers.
  const specs = [...NAMED, ...generatedSpecs()];
  const usedEmails = new Set<string>();
  const users: PlannedUser[] = specs.map((spec, index) => {
    const firstName = spec.firstName ?? faker.person.firstName();
    const lastName = spec.lastName ?? faker.person.lastName();
    let local = emailLocal(firstName, lastName);
    for (let n = 2; usedEmails.has(local); n++) local = `${emailLocal(firstName, lastName)}${n}`;
    usedEmails.add(local);
    const createdAt = at(DAY_MS + index * 3 * DAY_MS);
    return {
      handle: spec.handle,
      id: uuid(createdAt),
      email: `${local}@example.com`,
      firstName,
      lastName,
      displayName: `${firstName} ${lastName}`,
      jobTitle: spec.jobTitle,
      employeeNumber: `E${10001 + index}`,
      phone: `555-0${String(100 + index).slice(-3)}`,
      personaKey: spec.persona ?? null,
      roles: spec.roles ?? [],
      isSiteManager: spec.isSiteManager ?? false,
      active: spec.active ?? true,
      managerHandle: spec.manager,
      managerId: null,
      departmentCode: spec.dept,
      siteCode: spec.site,
      costCenterCode: spec.costCenter,
      createdAt,
    };
  });
  const byHandle = new Map(users.map((u) => [u.handle, u]));
  for (const user of users) user.managerId = user.managerHandle ? byHandle.get(user.managerHandle)!.id : null;
  return { sites, departments, costCenters, users };
}
