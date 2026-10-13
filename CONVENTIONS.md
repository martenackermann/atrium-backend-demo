# Conventions

Rules for everyone working in `atrium-backend-demo` (foundation and slices A1-A4).

**Sources of truth, in order:** `_spec/atrium/SPEC_RESOLUTIONS.md` (binding, overrides the
others) > `API.md` (paths and payloads) > `SPEC.md` (rules, states, permissions) >
`SCREENS.md` / `DESIGN.md`. When this file and the code disagree, the code in
`src/modules/core` is right - and tell the foundation owner.

---

## 1. How to build a slice (recipe)

You own `src/modules/<m>/**`, `prisma/schema/<m>.prisma`, your block in
`prisma/schema/core.prisma` and `test/e2e/<m>-*.e2e-spec.ts`. Nothing else (see §1.9).
Your module is already imported in `AppModule`, with a README.

### 1.1 Files to create

```
src/modules/<m>/
  <m>.module.ts                     exists - add imports/controllers/providers
  controllers/<resource>.controller.ts
  services/<resource>.service.ts
  services/<m>-inbox.provider.ts    @RegisterInboxProvider()      (if the module has to-dos)
  services/<m>-search.provider.ts   @RegisterSearchProvider()
  services/<m>-my-day.contributor.ts @RegisterMyDayContributor()  (if it feeds /home/my-day)
  services/<m>-attachment.policy.ts @RegisterAttachmentPolicy()   (if it links attachments)
  dto/<resource>.dto.ts             zod schemas + createZodDto classes
  machines/<resource>.machine.ts    XState machine (pure)
  machines/<resource>.workflow.ts   defineWorkflow(...) + WorkflowMeta (diagram)
  abilities/<m>.abilities.ts        @AbilityRules() provider
  jobs/<m>.jobs.ts                  @ScheduledJob() / @JobHandler() methods
  mail/<id>.notification.ts         defineNotification(...)   - auto-discovered
  seed/<m>.seed.ts                  export const seeder: Seeder - auto-discovered
  <m>.enums.ts                      enumOptions(...) for /meta/enums
  **/*.spec.ts                      unit tests next to the code
prisma/schema/<m>.prisma            your models and enums
test/e2e/<m>-*.e2e-spec.ts          e2e tests
```

### 1.2 The module

```ts
@Module({
  imports: [
    CoreExtensionsModule.forFeature({
      enums: TRAINING_ENUMS,                       // GET /meta/enums
      workflows: [trainingAttendeeWorkflowMeta],   // GET /meta/workflows/{name}
      auditLabels: TRAINING_AUDIT_LABELS,          // FieldChange labels + timeline phrases
    }),
  ],
  controllers: [TrainingRequestsController, ...],  // static paths (export.csv, queues/counts) BEFORE /:id routes
  providers: [TrainingService, TrainingAbilities, TrainingInboxProvider, TrainingSearchProvider, TrainingJobs, ...],
})
export class TrainingModule {}
```

Core services are global - just inject them: `PrismaService`, `ApprovalService`,
`WorkflowService`, `NotificationService`, `AttachmentService`, `AuditService`,
`QueueService`, `StorageService`, `Clock`, `AppConfig`.

### 1.3 Prisma model file and back-relations

`prisma/schema/<m>.prisma` holds your models. Rules (SPEC §1, §4):

- `id String @id @default(uuid(7)) @db.Uuid`; tables plural snake_case (`@@map("training_requests")`), columns snake_case (`@map("starts_on")`), Prisma fields camelCase.
- Timestamps `DateTime @db.Timestamptz(3)` + `createdAt @default(now())`, `updatedAt @updatedAt`; calendar dates `DateTime @db.Date` (convert with `dateFromIso`/`isoFromDate`).
- Money: `costCents Int` (+ API `Money`, always EUR). `version Int @default(1)` on PATCHable rows.
- Human references: `number Int @unique @default(autoincrement())`; `reference` is computed (`TRN-000123`), not stored.
- FKs to users: `requesterId String @map("requester_id") @db.Uuid` + relation with a **named** relation (`@relation("TrainingRequestRequester", ...)`).
- **Back-relations on core models** go only inside your block in `core.prisma`:

  ```prisma
  model User {
    ...
    // >>> A1 relations
    trainingRequestsRequested TrainingRequest[] @relation("TrainingRequestRequester")
    trainingAttendeesEscalated TrainingAttendee[] @relation("TrainingAttendeeEscalatedFrom")
    // <<< A1
  ```

  Blocks exist in `User`, `Department`, `Site`, `CostCenter` and `Attachment`.

- **Reserved core enums** (never redefine, reference them): `AssignableRole`, `ActingAs`,
  `ApproverReason`, `AutoApproval`, `NotificationPriority`, `AttachmentPurpose`, `EmailStatus`,
  `JobTrigger`, `JobRunStatus`. Your own enums get your module prefix if a name could clash
  (`TrainingFormat`, `TravelStatus`...), snake_case values = API values.
- Addresses: flat prefixed columns (`deliveryStreet`, `deliveryHouseNumber`, `deliveryPostalCode`,
  `deliveryCity`, `deliveryCountryCode`) and `addressSchema` in DTOs.
- Approval steps store `approverId`, `approverReason ApproverReason`, `escalatedFromId String?`
  (first skipped site manager) - from `ApprovalService.resolveApprover`.
- During development: `pnpm db:push` against your own DB (`atrium_aN`, see WORKSPACE.md).
  Migrations: on a fresh DB run `pnpm db:migrate:deploy`, then `pnpm db:migration:new a1_training_init`
  (read-only diff, writes `prisma/migrations/<timestamp>_a1_training_init/migration.sql`). Commit it.

### 1.4 Endpoints, DTOs and errors

- Paths and payloads exactly as API.md. Global prefix `/api/v1`.
- Request bodies: `z.strictObject(...)` (unknown keys -> 422). Optional text: `optionalTextSchema(max)` (`""` -> null).
  Reasons `reasonSchema` (3-1000), comments `commentSchema` (<= 2000), `attachmentIdsSchema` (<= 10).
- Responses: build from the shared schemas in `src/common/domain/schemas.ts` (`userRefSchema`,
  `refSchema`, `moneySchema`, `attachmentDtoSchema`, `timelineEntrySchema`, `decisionSchema`,
  `approverCandidateSchema`, `addressSchema`...). Every field present; empty = `null` / `[]`.
  Use `@ZodResponse({ type: XDto })` (serialises + documents). A DTO class must not wrap a schema
  that has `.meta({ id })` - use `z.object(shared.shape)` instead.
- Path ids: `@Param('id', UuidPipe) id` (malformed -> 404).
- Visibility: a row the user may not see -> **404** (`ProblemException.notFound()`), not 403.
- Errors: throw `ProblemException` helpers - `notFound()`, `forbidden()`, `conflict(detail, code)`,
  `versionConflict()`, `invalidTransition(action, state)`, `validation({ 'attendees.0.userId': ['...'] })`,
  `fieldError(field, msg)`. Codes are the closed list in `ERROR_CODES` (API.md §2.4); slice codes
  (`serial_taken`, `model_in_use`, `in_use`) already exist. Document with `@ApiProblemResponses(404, 409, 422)`.
- Lists: `paginationQuerySchema.extend({ ..., sort: sortParam({ allowed: [...], default: '-createdAt' }) })`
  and `paginate(query, findPage, count)` -> `{ data, meta }` (perPage default 25, max 100);
  `toPrismaOrderBy(query.sort, fieldMap)` for nested sorts. Filters: comma lists, `q` with ILIKE
  (`contains`, `mode: 'insensitive'`), references matched exactly.
- Creates: 201 + `Location` header (`@Res({ passthrough: true })`). Deletes: 204. Job triggers: 202.
- Idempotency-Key on POST is handled globally - nothing to do.
- Times: `IsoDateTime` = `date.toISOString()`; `IsoDate` = `isoFromDate(date)`; "today" = `clock.today()`
  (APP_TIMEZONE); calendar due dates as instants = `startOfDayInZone(isoDate, clock.timeZone)`.

### 1.5 Permissions

1. Role rules in `abilities/<m>.abilities.ts`:

   ```ts
   @Injectable()
   @AbilityRules()
   export class TrainingAbilities implements AbilityRulesContributor {
     define(user: AuthUser, { can }: AppAbilityBuilder) {
       if (hasRole(user, 'training_office', 'it_admin')) can(['book', 'mark_booking_impossible'], 'TrainingAttendee');
       can('withdraw', 'TrainingAttendee', { attendeeId: user.id });
     }
   }
   ```

2. Route checks `@CheckAbility('read', 'TrainingRequest')`; instance checks
   `assertCan(ability, 'update', subject('TrainingRequest', row))`; query filters
   `accessibleBy(ability, 'read').ofType('TrainingRequest')`. Get the ability with `@CurrentAbility()`.
3. Relationships (approver, deputy, manager chain, reporting tree) come from **`ApprovalService`**
   (D18, SPEC_RESOLUTIONS #1/#12): `resolveApprover(subjectId, requesterId)` ->
   `{ approverId, reason, auto, escalatedFromId }`, `canDecide(userId, { kind, approverId, subjectId })`
   -> `'approver' | 'executive' | 'deputy' | 'manager_chain' | false`, `isActiveDeputy`,
   `activeDeputiesOf` (cc for approval mails), `principalsOf`, `ancestors`, `isInReportingTree`,
   `mayActFor` (creating for others; back office and it_admin are exempt). Never re-implement them.
   Rows where the subject is the viewer never appear in their approval scopes, counts or inbox (#13).
4. `it_admin` grants no approval rights and no people personal data (D13).

### 1.6 Workflows (one per stateful resource)

```ts
// machines/training-attendee.machine.ts
export const trainingAttendeeMachine = setup({
  types: {
    context: {} as Ctx,
    events: {} as WorkflowEvent<'approve', { comment?: string }> | WorkflowEvent<'decline', { reason: string }>,
  },
  guards: { notSubject: ({ context, event }) => event.actor.id !== context.attendeeId },
  actions: { ...workflowActions },
}).createMachine({
  initial: 'pending_manager_approval',
  states: {
    pending_manager_approval: {
      on: {
        approve: { guard: 'notSubject', target: 'to_book' },
        decline: { guard: 'notSubject', target: 'declined' },
      },
    },
    to_book: { entry: { type: 'notify', params: { kind: 'training.participation_approved' } } },
    declined: { type: 'final' },
  },
});
```

```ts
// machines/training-attendee.workflow.ts  (inside an @Injectable when hooks need services)
this.workflow = defineWorkflow({
  name: 'training_attendee', module: 'training', entityType: 'training_attendee', subjectType: 'TrainingAttendee',
  machine: trainingAttendeeMachine,
  actions: {                                     // canonical machine order = availableActions order
    approve: { ability: false, input: approveBody, authorize: ({ tx, entity, actor }) =>
      approvals.canDecide(actor.id, { kind: 'manager', approverId: entity.approverId, subjectId: entity.attendeeId }, tx) },
    decline: { ability: false, input: z.strictObject({ reason: reasonSchema }), authorize: /* same */ },
    book: { input: bookBody },                   // CASL: can('book', 'TrainingAttendee'); actingAs defaults to back_office
  },
  entityId: (row) => row.id,
  entityLabel: (row) => row.attendee.displayName,
  toState: (row) => ({ value: row.status, context: { attendeeId: row.attendeeId } }),
  load: async (tx, id, actor) => { await lockRow(tx, 'training_attendees', id); return findVisible(tx, id, actor); },
  persist: (tx, row, next, change) => tx.trainingAttendee.update({ where: { id: row.id }, data: { status: next.value, version: { increment: 1 } } }),
  afterTransition: async ({ tx, entity, change, notifies }) => { /* notifications.send(..., { tx }) */ },
});
```

Controller (the whole `POST /<resource>/{id}/actions/{action}` endpoint):

```ts
@Post(':id/actions/:action')
async act(@Param('id', UuidPipe) id: string, @Param('action') action: string, @Body() body: unknown,
          @CurrentUser() user: AuthUser, @CurrentAbility() ability: AppAbility) {
  await this.workflows.apply(this.workflow, { id, action, actor: user, ability, input: body });
  return this.service.detail(id, user, ability);   // 200 + full detail DTO (API.md §1)
}
```

`apply()` = one transaction: `load` (404) -> permission: CASL then `authorize` (403; 409 if the
state has no such action) -> body (422) -> machine guard (409 `invalid_transition`) -> `persist`
(null -> 409 `version_conflict`) -> audit row (`actingAs`, `reason` from `input.reason`, correlation id)
-> `afterTransition`. Unknown action -> 404. DTOs include `availableActions: await workflows.availableActions(def, row, user, ability)`
plus capability flags (`edit`, `view_pin`...). Diagram: register a `WorkflowMeta`
(states with DESIGN tones, events with actor labels). Reference: `src/modules/core/workflow/examples/`
and the e2e fixture in `test/support/fixtures.module.ts`.

### 1.7 Provider framework (core never imports slice code)

| Contract (`src/modules/core/contracts/`)              | Decorator                     | Notes                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `InboxProvider { module; items(user) }`               | `@RegisterInboxProvider()`    | Items per API.md §8: `id = inboxItemId(type, entityId)`, `link` (frontend route), `actionsPath` (`/training/participations/{id}`), `dueAt` = `startOfDayInZone(date)` as ISO, `quickActions` subset of availableActions. Exclude items whose subject is the viewer; it_admin gets no back-office items. Core sorts and caps at 200. |
| `SearchProvider { module; search(user, q) }`          | `@RegisterSearchProvider()`   | <= 5 permission-filtered hits.                                                                                                                                                                                                                                                                                                      |
| `MyDayContributor { contribute(user) }`               | `@RegisterMyDayContributor()` | Partial `MyDayFragments`; A4 calls `InboxService.myDay(user)` for `/home/my-day`.                                                                                                                                                                                                                                                   |
| `AttachmentPolicy { entityTypes; canView; canLink? }` | `@RegisterAttachmentPolicy()` | Decides who sees attachments linked to your entity types.                                                                                                                                                                                                                                                                           |

### 1.8 Notifications, jobs, seeds

**Notifications** (SPEC §7) - `src/modules/<m>/mail/<id>.notification.ts`, discovered automatically:

```ts
export const approvalRequested = defineNotification({
  id: 'training.approval_requested',
  module: 'training',
  schema: z.object({ attendee: z.string(), topic: z.string(), attendeeId: z.uuid() }),
  subject: (c) => `Approval needed: ${c.attendee} – ${c.topic}`,
  body: (c) => `${c.attendee} asks to attend ${c.topic}.`, // in-app, plain, <= 500
  email: (c) => mjml`<mj-text>${c.attendee} asks to attend <b>${c.topic}</b>.</mj-text>`,
  link: (c) => `/training/approvals?tab=approvals&selected=${c.attendeeId}`,
  preview: { attendee: 'Emma Employee', topic: 'First Aid', attendeeId: '00000000-0000-7000-8000-000000000000' },
});
await this.notifications.send(
  approvalRequested,
  {
    to: [{ userId: approverId }],
    cc: deputies.map((d) => ({ userId: d.id })), // or { mailbox: 'training_office' }
    context,
    priority: high ? 'high' : 'normal',
    entity: { type: 'training_attendee', id },
    attachmentIds,
  },
  { tx },
);
```

Email (queued, rendered in the shared layout with "View in Atrium" + "[High priority] " prefix /
X-Priority) and one in-app row per user recipient (D17). Use the `mjml` tag (escapes); nested
fragments need `raw(mjml\`...\`)`. Preview: `GET /api/v1/dev/mail-preview/<id>[?format=text&priority=high]`.

**Jobs** (SPEC §8):

```ts
@ScheduledJob({ name: 'training.rating-reminders', slice: 'A1', cronEnv: 'CRON_TRAINING_RATINGS', reminder: true,
                description: 'Sends due rating reminders' })
async ratingReminders(ctx: JobRunContext): Promise<JobSummary> { ...; return { loop1, loop2, loop3, skippedMax }; }
```

Cron in APP_TIMEZONE -> one `job_runs` row per scheduled slot (dedupe) -> pg-boss -> your method;
manual run: `POST /admin/jobs/{name}/run`. `reminder: true` = cron off in DEMO_MODE unless
`ENABLE_REMINDER_CRONS=true`. All cron env vars already exist (`CRON_*`). Plain queue workers:
`@JobHandler('training.something')` + `queue.send(name, data, { tx })`. Jobs must be idempotent.

**Seeds** (SPEC §10) - `src/modules/<m>/seed/<m>.seed.ts`, discovered automatically and run in
order core -> training -> travel -> assets -> people -> news -> home:

```ts
export const seeder: Seeder = {
  name: 'training story records',
  run: async ({ prisma, faker, d, at, uuid, users, storeFile, today }) => {
    const emma = users.get('emma');                 // persona keys, handles (priya, victor, hilTech1, sdkAgent3...) or emails
    const id = uuid(at(-10, 9));                    // deterministic UUIDv7 from createdAt
    ...                                             // dates relative to today: d(+21) = IsoDate, at(-3, 14) = instant
  },
};
```

Write state **and** coherent `audit_logs` rows for each transition, and the in-app notifications of
your story records (core seeds only `core.*` notifications). Use `storeFile` for seeded PDFs.

### 1.9 Files a slice must never touch

Everything outside its own paths, in particular: `src/common/**`, `src/config/**` (all env vars
already exist), `src/database/**`, `src/infra/**`, `src/modules/core/**`, `src/app.module.ts`,
`prisma/schema/schema.prisma`, `core.prisma` outside your block, other slices' folders and
migrations, `package.json` / lockfile (no new dependencies), `openapi.json` (regenerated on main),
CI/Docker files. Need something there? Ask the foundation owner.

### 1.10 Test template

```ts
// test/e2e/training-requests.e2e-spec.ts
describe('training requests', () => {
  let t: TestApp;
  let emma: string;
  beforeAll(async () => {
    t = await createTestApp({ seed: ['core', 'training'] });   // fresh tables + seeds
    emma = await t.login('emma');                               // real demo login (demo1234)
  });
  afterAll(async () => { await t?.close(); });

  it('creates a request', async () => {
    const res = await t.http().post('/api/v1/training/requests').set('Authorization', emma).send({ ... }).expect(201);
    expect(res.body.availableActions).toEqual(['withdraw']);
  });

  it('hides other people\'s requests (404)', async () => {
    const res = await t.http().get(`/api/v1/training/requests/${id}`).set('Authorization', emma).expect(404);
    expect(res.body.code).toBe('not_found');
  });
});
```

- Every run creates a fresh database `<TEST_DATABASE_URL db>_run_<time>` (dropped afterwards), so
  set `TEST_DATABASE_URL` to your base, e.g. `postgresql://dev:dev@localhost:5432/atrium_a1_test`.
- Tables are truncated before each file; files run sequentially.
- Background jobs: `t.app.get(QueueService).spy(name).waitForJob(selector, 'completed')`.
- Time: `t.app.get(Clock).set(new Date(...))` (remember to reset).
- Assert `code`/`status`/`errors` keys, not message texts. Cover each permission-matrix row.

---

## 2. Repository layout

```
src/
  main.ts / app.module.ts        bootstrap; infrastructure + module registry (pre-filled)
  bootstrap/                     configureApp (prefix, request id, helmet, CORS, Swagger), OpenAPI builder
  config/                        env schema (all SPEC §9 vars) + AppConfig
  database/                      PrismaService, truncate, seed runner (cli, discovery), users export, migration helper
  common/                        libraries without business logic
    domain/                      vocabulary (role names, actingAs, tones...), shared zod schemas, mappers
    http/                        problem+json, validation pipe, pagination, sort, UuidPipe, request context
    auth/  authz/                AuthUser, @Public, @CurrentUser, password hashing / CASL types, @AbilityRules, @CheckAbility
    time/  logging/  throttle/   Clock + date helpers / pino / login rate limit
  infra/                         queue (pg-boss), mail (MJML layout + SMTP), storage (private blobs, signing), health
  modules/core/                  foundation domain - feature folders instead of controllers/services/:
    auth/ users/ approvals/ deputies/ notifications/ mail/ inbox/ meta/ attachments/ audit/ admin/ jobs/
    workflow/ idempotency/ contracts/ abilities/ seed/
  modules/{training,travel,assets,people,news,home}/   slice modules
  generated/prisma/              Prisma client (git-ignored)
prisma/schema/                   schema.prisma (generator/datasource), core.prisma, <m>.prisma
prisma/migrations/               SQL migrations (<timestamp>_<slice>_<topic>)
prisma/seed.ts                   `prisma db seed` entry
test/                            e2e tests + support (test app, fixtures, per-run database)
```

## 3. Reference

- **Errors:** RFC 9457 `{ type, title, status, detail, instance, code, traceId, errors? }`,
  `type = https://atrium.example.com/problems/<code>`, `traceId` = `X-Request-Id`. Field errors use dot
  paths (`attendees.0.userId`), `_root` for payload-level errors.
- **Auth:** `Authorization: Bearer <jwt>`; each token is an `auth_sessions` row (logout revokes it);
  roles are loaded per request (`employee` implicit, `manager` derived from active reports,
  `isSiteManager` flag). `/auth/personas` and `/auth/demo-login` only with `DEMO_MODE=true`.
  Login is rate limited (`LOGIN_RATE_LIMIT` per 15 min per email + IP).
- **Attachments:** `POST /attachments` (multipart `file`, `purpose`) stages; MIME from magic bytes;
  `AttachmentService.link(tx, { ids, entityType, entityId, purposes, actor })` links (422 per index);
  `listFor(entityType, id)`, `downloadUrl(user, id)` (signed, `FILE_URL_TTL_SECONDS`; news covers 3600).
- **Audit:** `AuditService.record({ module, entityType, entityId, action, actorId, actingAs, ... }, tx)`;
  `audit.diff(entityType, before, after)` uses registered labels/masks; `audit.timeline([{ entityType, entityId }])`
  -> `TimelineEntry[]`. `audit_logs` is append-only (DB trigger in migrations).
- **Enums:** `enumOptions(values, { value: ['Label', tone] })` with DESIGN tones
  `neutral | waiting | you | moving | positive | negative | blocked`; `you` is applied client-side.
- **Scripts:** `pnpm lint`, `typecheck`, `test` (`test:unit`, `test:e2e`), `build`, `openapi:export`,
  `db:push`, `db:migrate:deploy`, `db:migration:new <name>`, `db:seed`, `db:reset` (truncate + push + seed),
  `demo:reset` (truncate + seed), `seed:export-users <path>` (frontend `users.json`).

## 4. Decisions (foundation)

- NestJS 11 (nestjs-zod 5 supports Nest <= 11), TypeScript 6.0 (typescript-eslint does not support
  TS 7 yet), Prisma 7.10 (8.0 is a release candidate) with the `prisma-client` generator and `@prisma/adapter-pg`.
- Ids use Prisma's `uuid(7)` (generated in the app, D1) instead of a separate `uuidv7` package;
  seeds use `ctx.uuid(createdAt)` for deterministic ids.
- Email is stored lowercased (`text unique`) instead of `citext`; user search uses ILIKE instead of
  a trigram index (52 users) - no Postgres extensions needed for `db push`.
- Cross-module contracts live in `src/modules/core/contracts/` (SPEC §1 says `src/core/contracts/`).
- `JWT_TTL_MINUTES`, `APP_BASE_URL` (frontend links) as in SPEC §9, plus `API_PUBLIC_URL` (signed URLs).
- Swagger UI at `/api/docs`, JSON at `/api/openapi.json` (API.md §1).
- `GET /health` answers 200 for `ok`/`degraded` and 503 only when the database is down.
- CORS without credentials (bearer tokens only).
- `canDecide` returns 403 vs 409 like this: permission denied and the state has the action -> 403;
  the state lacks the action -> 409 `invalid_transition`.
- The deputy create endpoint accepts `principalId` for it_admin (manages anyone's deputies, #24).
- `demo.reset` is cron/CLI only (`pnpm demo:reset`); `POST /admin/jobs/demo.reset/run` -> 403.
- Prisma blocks destructive commands (`--force-reset`, `--accept-data-loss`) from AI agents without
  user consent, so: tests use a fresh per-run database, `db:reset` truncates and pushes (fails on
  destructive schema changes - then recreate your dev database by hand), migrations are generated
  read-only with `db:migration:new`.
- `SMTP_HOST` defaults to `127.0.0.1` (nodemailer resolves names via DNS, not the hosts file).
