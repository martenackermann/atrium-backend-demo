# Atrium API

**The NestJS backend of Atrium, an employee self-service portal:** training and travel requests
with multi-step approvals, company devices, onboarding and offboarding requests, and company news.

[![CI](https://github.com/martenackermann/atrium-backend-demo/actions/workflows/ci.yml/badge.svg)](https://github.com/martenackermann/atrium-backend-demo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
![Node 22](https://img.shields.io/badge/node-22-339933?logo=node.js&logoColor=white)
![NestJS 11](https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white)

**[Live demo](https://atrium-demo.vercel.app)** (the web app in demo mode, runs in your browser) ·
**[Frontend repository](https://github.com/martenackermann/atrium-frontend-demo)** ·
API reference at `/api/docs` once the API runs

![The Atrium web app: My day for Emma Employee](./docs/images/atrium-my-day.png)

<sub>The Atrium web app from the frontend repository. This repository is the API behind it.</sub>

## About this project

Atrium is a clean-room re-engineering of an internal employee portal, built as a portfolio demo.
All people, companies and data are fictional: the company is "Acme IT Services", and every
address uses the reserved `example.com` domain. Every integration is local or mocked. Emails go to
Mailpit, files to the local disk, and sign-in uses demo personas instead of a corporate identity
provider.

## Contents

- [What it does](#what-it-does)
- [Why this stack](#why-this-stack)
- [Architecture](#architecture)
- [Domain and workflows](#domain-and-workflows)
- [API documentation](#api-documentation)
- [Quick start](#quick-start)
- [Demo personas](#demo-personas)
- [Testing](#testing)
- [Project structure](#project-structure)
- [Configuration](#configuration)
- [License](#license)

## What it does

| Module       | What the API covers                                                                                                                                                                                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Training** | Training requests for one or more attendees, manager approval plus an executive step from €5,000, booking by the training office, cancellations, billing status and actual cost, learning goals, and three feedback rounds with reminders.                                 |
| **Travel**   | Car rental, train and flight requests. Whether a request needs approval depends on the choices (car class, gearbox, foreign travel, saver fares, flights). The travel desk books with a confirmation PDF and an encrypted booking PIN and maintains a car-class catalogue. |
| **Devices**  | An inventory of 120 devices, a model catalogue, assignment with accept or decline by the employee, repair and scrap, a field-level change history, a dashboard and a nightly cost-centre sync.                                                                             |
| **People**   | Onboarding and offboarding requests with a people-ops queue, internal notes, personal data that only people ops can read, and replies from the requester.                                                                                                                  |
| **News**     | Articles with a sanitized rich-text body, cover images, scheduled publishing and archiving, plus a list of useful links.                                                                                                                                                   |
| **Home**     | "My day": one endpoint that gathers every module's to-dos, open requests and upcoming dates.                                                                                                                                                                               |
| **Core**     | Sign-in, users and org chart, approver resolution, deputies, the cross-module inbox and search, in-app notifications and email, attachments with signed URLs, audit log, user and role admin, and a job runner.                                                            |

## Why this stack

Every choice answers a concrete job in the product.

| Tool                                             | Why it is here                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **NestJS 11**                                    | Six business modules were built in parallel against one core. Nest modules give each of them its own controllers, services, permission rules and jobs, and dependency injection lets the core collect what modules register (inbox items, search hits, "My day" fragments, attachment policies) without ever importing module code.                                      |
| **Prisma 7 (multi-file schema) + PostgreSQL 17** | One schema file per module (`prisma/schema/training.prisma`, `travel.prisma`, ...), so a module owns its tables and migrations, and the generated client is fully typed. PostgreSQL does the work that has to be exact: row locks for workflow transitions, partial unique indexes (one open assignment per device), and an append-only audit log enforced by a trigger. |
| **XState v5**                                    | Approvals are state machines, not if-statements spread across services. Guards encode the rules: nobody approves their own request, approval only before the start date, an executive step from €5,000, cancellation until the trip is over. The same machine answers `availableActions` on every response, and its metadata drives the state diagrams in the UI.        |
| **CASL**                                         | Role rules ("the travel desk may book") plus relationship rules resolved by one `ApprovalService`: approver, active deputy, manager chain, site-manager escalation. `accessibleBy` filters lists in the database, and a record you may not see answers 404, never 403.                                                                                                   |
| **pg-boss**                                      | A job queue inside the same PostgreSQL, so there is no Redis to run. Emails and follow-up jobs are enqueued in the same transaction as the change that caused them: if the transaction rolls back, no email goes out.                                                                                                                                                    |
| **@nestjs/schedule**                             | Reminder crons in the company time zone: feedback rounds, learning goals, device acceptance, the travel desk's high-priority digest, scheduled news and nightly clean-up. Each slot is recorded in `job_runs`, and every job can be run by hand from the admin job runner.                                                                                               |
| **Nodemailer + MJML**                            | Notifications are typed definitions: a zod context schema, a subject, a short in-app body, an MJML email and a link back into the app. One `send()` writes an in-app notification per user and queues a responsive email. Mailpit catches everything in development, and every template has a preview endpoint.                                                          |
| **zod → OpenAPI** (nestjs-zod)                   | One zod schema validates the request, serialises the response and documents the endpoint. `openapi.json` is committed, CI fails when it is stale, and the frontend generates its API types from it.                                                                                                                                                                      |

How they come together for the product's hard parts:

- **Conditional forms with a rule preview.** `POST /travel/requests/preview` and
  `POST /training/requests/preview` run the same pure rule functions as create. The form shows
  "Needs approval because..." and the approval route while the employee is still filling it in, so
  the preview and the final decision never disagree.
- **Multi-step approvals.** Approver resolution follows the org chart: the direct manager,
  escalation past a site manager, an active deputy, the manager chain as an override, an executive
  step above the cost threshold, automatic approval when the approver is the requester, and a
  fallback approver. Every decision is audited with the capacity the person acted in ("as deputy
  for Priya Raman").
- **Reminders.** Feedback rounds, learning goals and device acceptance send reminders on a cadence
  with a maximum count, then show up as overdue in the back office.
- **Files.** Uploads are staged first, checked by magic bytes and size, linked to a record in the
  same transaction, and downloaded through short-lived signed URLs.

Also in the box: argon2 password hashing, Helmet, login rate limits, pino logging with request
ids, RFC 9457 problem responses, idempotency keys on `POST`, and Vitest + Supertest.

## Architecture

```mermaid
flowchart LR
    spa["Atrium web app<br/>(Nuxt SPA)"] -- "HTTPS /api/v1<br/>Bearer JWT" --> http

    subgraph api["NestJS API"]
        direction LR
        http["HTTP layer<br/>Helmet · CORS · request id<br/>zod validation · problem+json"]
        subgraph modules["Feature modules"]
            direction TB
            training[Training]
            travel[Travel]
            assets[Devices]
            people[People]
            news[News]
            home["Home · My day"]
        end
        subgraph core["Core"]
            direction TB
            authz["Auth + CASL abilities"]
            approvals["ApprovalService<br/>approvers · deputies · manager chain"]
            workflow["WorkflowService<br/>XState machines"]
            registry["Provider registry<br/>inbox · search · My day · attachment policies"]
            notify["NotificationService"]
            files["Attachments + signed URLs"]
            audit["Audit log"]
            jobs["Scheduler + job runner"]
        end
        http --> modules
        modules --> core
        modules -. "register providers" .-> registry
    end

    core --> prisma["Prisma client"] --> pg[("PostgreSQL")]
    notify -- "enqueue in the same transaction" --> boss["pg-boss queue<br/>(tables in PostgreSQL)"]
    jobs -- "cron slot → job_runs" --> boss
    boss --> worker["Mail worker<br/>MJML → HTML"] --> smtp["SMTP<br/>(Mailpit in dev)"]
    files --> disk[("Local file storage")]
```

**One way to change a record.** Every state change goes through `WorkflowService.apply()`: one
database transaction with a fixed order of checks, so the error codes are predictable.

```mermaid
flowchart LR
    a["POST /travel/requests/{id}/actions/approve"] --> load["Load and lock the row<br/>404 if not visible"]
    load --> perm["CASL + relationship check<br/>403"]
    perm --> body["Validate the body with zod<br/>422"]
    body --> guard["State machine guard<br/>409 invalid_transition"]
    guard --> persist["Persist with version check<br/>409 version_conflict"]
    persist --> auditrow["Audit row<br/>actor, acting as, reason"]
    auditrow --> after["Notifications and jobs<br/>same transaction"]
    after --> dto["200 + detail<br/>with availableActions"]
```

**Modules plug in; the core never imports them.** A module registers providers with decorators
(`@RegisterInboxProvider()`, `@RegisterSearchProvider()`, `@RegisterMyDayContributor()`,
`@RegisterAttachmentPolicy()`, `@ScheduledJob()`) and notification templates with
`defineNotification()`. The core discovers them at startup and aggregates `/me/inbox`, `/search`,
`/home/my-day` and `/admin/jobs` across modules. [`CONVENTIONS.md`](./CONVENTIONS.md) walks
through building a module.

## Domain and workflows

The org chart (52 users, 6 departments, 4 sites, 9 cost centres) drives every approval. Each
stateful record has a workflow, and the API serves its diagram at
`GET /api/v1/meta/workflows/{name}`.

**Training participation** (one per attendee of a training request)

```mermaid
stateDiagram-v2
    direction LR
    state "Awaiting manager" as pending_manager_approval
    state "Awaiting executive" as pending_executive_approval
    state "To book" as to_book
    state "Booked" as booked
    state "Booking impossible" as booking_impossible
    state "Cancellation requested" as cancellation_requested
    state "Attended" as attended
    state "Did not attend" as not_attended
    state "Declined" as declined
    state "Cancelled" as cancelled

    [*] --> pending_manager_approval: request
    [*] --> pending_executive_approval: manager step automatic
    [*] --> to_book: no approval needed
    pending_manager_approval --> pending_executive_approval: approve, €5,000 or more
    pending_manager_approval --> to_book: approve
    pending_manager_approval --> declined: decline
    pending_manager_approval --> cancelled: withdraw
    pending_executive_approval --> to_book: approve
    pending_executive_approval --> declined: decline
    pending_executive_approval --> cancelled: withdraw
    to_book --> booked: book
    to_book --> booking_impossible: mark impossible
    to_book --> cancellation_requested: request cancellation
    booked --> cancellation_requested: request cancellation
    booked --> attended: feedback round 1
    booked --> not_attended: feedback round 1
    booking_impossible --> to_book: retry booking
    booking_impossible --> cancelled: withdraw or close
    cancellation_requested --> cancelled: confirm
    cancellation_requested --> booked: reject
    cancellation_requested --> to_book: reject
    attended --> [*]
    not_attended --> [*]
    declined --> [*]
    cancelled --> [*]
```

**Travel request** (car rental, train or flight)

```mermaid
stateDiagram-v2
    direction LR
    state "Awaiting approval" as pending_approval
    state "To book" as to_book
    state "Booked" as booked
    state "Booking impossible" as booking_impossible
    state "Cancellation requested" as cancellation_requested
    state "Declined" as declined
    state "Cancelled" as cancelled

    [*] --> pending_approval: a rule needs approval
    [*] --> to_book: standard choices only
    pending_approval --> to_book: approve
    pending_approval --> declined: decline
    pending_approval --> cancelled: withdraw
    to_book --> booked: book with confirmation and PIN
    to_book --> booking_impossible: mark impossible
    to_book --> cancellation_requested: request cancellation
    booked --> cancellation_requested: request cancellation
    booking_impossible --> to_book: retry booking
    booking_impossible --> cancelled: withdraw or close
    cancellation_requested --> cancelled: confirm
    cancellation_requested --> to_book: reject
    cancellation_requested --> booked: reject
    declined --> [*]
    cancelled --> [*]
```

A travel request needs approval when a rule in
[`travel-rules.ts`](./src/modules/travel/domain/travel-rules.ts) applies: a car class above the
standard one, an estate, an automatic gearbox, diesel, foreign travel, delivery or collection of
the car, a saver fare or separate train tickets, and every flight. Economy with a manual gearbox
goes straight to the travel desk.

Devices (in stock → waiting for acceptance → in use, plus repair, return and scrap) and people
requests (open → in progress → waiting on the requester or internally → completed, plus reject,
cancel and reopen) work the same way; their machines live in `src/modules/*/machines/`.

## API documentation

- **Swagger UI:** `http://localhost:3100/api/docs` while the API runs
- **OpenAPI document:** `http://localhost:3100/api/openapi.json`, also committed as
  [`openapi.json`](./openapi.json) (96 paths)
- **Mail templates:** `GET /api/v1/dev/mail-preview` renders every template with sample data
  (development only)

Conventions across all endpoints: the base path is `/api/v1`. Errors are RFC 9457
`application/problem+json` with a stable `code`. Lists return `{ data, meta }` and take `page`,
`perPage`, `sort` and filters. State changes are `POST /<resource>/{id}/actions/{action}`, and every
detail response lists the `availableActions` for the current user. `POST` requests accept an
`Idempotency-Key`.

## Quick start

### With Docker (API + PostgreSQL + Mailpit)

```bash
docker compose up --build
```

The first start applies the migrations and seeds the demo data. Then:

- API health: <http://localhost:3100/api/v1/health>, Swagger UI: <http://localhost:3100/api/docs>
- Mailpit, which catches every email the API sends: <http://localhost:8025>
- Sign in as any persona with the demo-only password `demo1234`:

```bash
curl -s http://localhost:3100/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"emma.employee@example.com","password":"demo1234"}'
```

Ports already taken? Choose others: `API_PORT=3200 MAILPIT_UI_PORT=8026 docker compose up --build`.
PostgreSQL is not published on the host, so a local database on 5432 does not get in the way.
`docker compose down -v` removes the containers and the data.

To use the web app against this API, run the
[frontend](https://github.com/martenackermann/atrium-frontend-demo) with `pnpm dev`; it expects the
API at `http://localhost:3100/api/v1`.

### Local development

Requirements: Node 22.12+, pnpm 10, PostgreSQL 17 and an SMTP catcher. Both services in Docker:

```bash
docker run -d --name atrium-postgres -p 5432:5432 \
  -e POSTGRES_USER=dev -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=atrium_main postgres:17-alpine
docker run -d --name atrium-mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit
```

```bash
pnpm install              # also runs `prisma generate`
cp .env.example .env      # local-dev placeholders, no secrets
pnpm db:migrate:deploy    # create the schema
pnpm db:seed              # demo data: 52 users, 9 personas (password demo1234)
pnpm start:dev            # http://localhost:3100, docs at /api/docs
```

| Script                                                           | Purpose                                                    |
| ---------------------------------------------------------------- | ---------------------------------------------------------- |
| `pnpm start:dev` / `pnpm build` / `pnpm start`                   | Watch mode / compile to `dist/` / run the build            |
| `pnpm lint` / `pnpm typecheck`                                   | ESLint + Prettier check / `tsc --noEmit`                   |
| `pnpm test` (`test:unit`, `test:e2e`)                            | Vitest; e2e boots the app against a throwaway database     |
| `pnpm db:migrate:deploy` / `db:push` / `db:migration:new <name>` | Apply migrations / sync the schema / write a new migration |
| `pnpm db:seed` / `db:reset` / `demo:reset`                       | Seed / truncate, push and seed / truncate and seed         |
| `pnpm openapi:export`                                            | Write `openapi.json` (CI fails when it is stale)           |
| `pnpm seed:export-users <path>`                                  | Export the seeded org as JSON for the frontend mocks       |

The seed is deterministic and relative to today (`SEED_TODAY` overrides it), so due dates,
overdue reminders and "starts tomorrow" stay true whenever you run it.

## Demo personas

Every persona signs in with the demo-only password `demo1234`. `GET /api/v1/auth/personas` lists
them, and `POST /api/v1/auth/demo-login` signs in without a password. Both exist only while
`DEMO_MODE=true`.

| Persona              | Email                              | Roles                   | What they demonstrate                                                                                                                                                                    |
| -------------------- | ---------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Emma Employee        | `emma.employee@example.com`        | employee                | The typical requester: devices to accept, feedback due, learning goals to write, a car request waiting for approval, a booked flight with a PIN, a people request waiting for her reply. |
| Max Manager          | `max.manager@example.com`          | manager                 | Approvals for his team and escalated ones from Hillford, decisions as Priya's deputy, overrides along the manager chain, a round-3 rating for Emma.                                      |
| Sofia Site-Manager   | `sofia.site-manager@example.com`   | manager, site manager   | Why her team's requests escalate past her, her own high-priority train trip, a training above €5,000 waiting for the CEO.                                                                |
| Clara CEO            | `clara.ceo@example.com`            | executive               | Executive approvals from €5,000, her own flight without approval, a permanent deputy.                                                                                                    |
| Tom Travel-Desk      | `tom.travel-desk@example.com`      | travel desk             | The booking queue with high-priority trips, cancellations, confirmation PDFs and PINs, the car-class catalogue.                                                                          |
| Tina Training-Office | `tina.training-office@example.com` | training office         | Trainings to book, cancellations, a booking-impossible retry, billing and actual cost, the feedback overview with overdue reminders.                                                     |
| Arne Assets          | `arne.assets@example.com`          | asset admin             | The device dashboard, the 120-device inventory, the catalogue, assigning devices, repair and scrap, field-level history.                                                                 |
| Paula People-Ops     | `paula.people-ops@example.com`     | people ops, news editor | The people-ops queue with personal data and internal notes, scheduled news and useful links.                                                                                             |
| Ian IT-Admin         | `ian.it-admin@example.com`         | IT admin                | User and role admin, the audit log and the job runner. Sees every back office but cannot approve, and personal data is redacted for him.                                                 |

## Testing

```bash
pnpm test         # unit + e2e
pnpm test:unit    # pure logic: machines, rules, mappers (src/**/*.spec.ts)
pnpm test:e2e     # HTTP tests with Supertest against a real PostgreSQL (test/e2e)
```

The e2e suite needs PostgreSQL and Mailpit (see [Local development](#local-development)). Each run
creates a fresh database next to `TEST_DATABASE_URL` (default
`postgresql://dev:dev@localhost:5432/atrium_test`), pushes the schema, seeds what each file needs,
and drops the database afterwards. Tests sign in as the demo personas, cover the permission
matrix row by row, and move time with an injectable clock.

CI ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)) runs lint, typecheck, unit and e2e
tests against PostgreSQL and Mailpit service containers, the build and the OpenAPI staleness
check, then builds the Docker image and signs in against the Compose stack.

## Project structure

```
src/
  main.ts, app.module.ts      bootstrap and module registry
  bootstrap/                  Helmet, CORS, request ids, Swagger, OpenAPI document
  config/                     every environment variable, validated with zod at startup
  common/                     building blocks without business logic: problem+json, pagination,
                              sorting, auth decorators, CASL types, clock, rate limits
  infra/                      pg-boss queue, MJML mail rendering + SMTP, file storage, health
  database/                   PrismaService, seed runner, users export, migration helper
  modules/
    core/                     auth, users, approvals, deputies, workflow engine, inbox, search,
                              notifications, attachments, audit, meta, admin, jobs
    training/ travel/ assets/ people/ news/ home/
                              one folder per module: controllers, services, dto, machines,
                              abilities, jobs, mail templates, seed
prisma/
  schema/                     schema.prisma + one file per module
  migrations/                 SQL migrations
test/
  e2e/                        Supertest suites per module
  support/                    test app, per-run database, fixtures
docker/entrypoint.sh          migrate, seed on the first start, run
```

[`CONVENTIONS.md`](./CONVENTIONS.md) has the rules and the recipe for a new module.

## Configuration

Every variable is validated at startup (`src/config/env.schema.ts`), and the API refuses to start
with an invalid configuration. [`.env.example`](./.env.example) lists all of them with local-dev
placeholders. The important ones:

| Variable                                | Default                                | Purpose                                                      |
| --------------------------------------- | -------------------------------------- | ------------------------------------------------------------ |
| `DATABASE_URL`                          | (required)                             | PostgreSQL connection string                                 |
| `PORT`                                  | `3100`                                 | HTTP port                                                    |
| `APP_BASE_URL`                          | `http://localhost:3000`                | Web app URL for links in emails and notifications            |
| `API_PUBLIC_URL`                        | `http://localhost:3100`                | Public URL of this API for signed download links             |
| `CORS_ORIGINS`                          | the local frontends                    | Comma-separated allowlist, no wildcard                       |
| `JWT_SECRET`                            | (required)                             | Signs access tokens                                          |
| `JWT_TTL_MINUTES`                       | `480`                                  | Token lifetime; signing out revokes the session              |
| `ENCRYPTION_KEY`                        | local placeholder                      | 64 hex characters, AES-256-GCM key for travel booking PINs   |
| `FILE_SIGNING_SECRET`                   | local placeholder                      | Signs download URLs                                          |
| `FILE_URL_TTL_SECONDS`                  | `300`                                  | Lifetime of a signed download URL                            |
| `STORAGE_DIR` / `UPLOAD_MAX_BYTES`      | `./storage` / `10485760`               | Upload directory / upload size limit                         |
| `SMTP_HOST` / `SMTP_PORT` / `MAIL_FROM` | `127.0.0.1` / `1025` / Atrium no-reply | Outgoing mail (Mailpit in development)                       |
| `MAILBOX_*`                             | `travel-desk@example.com`, ...         | Shared mailboxes of the desks                                |
| `APP_TIMEZONE`                          | `Europe/Berlin`                        | "Today", due dates and cron schedules                        |
| `LOGIN_RATE_LIMIT`                      | `10`                                   | Password sign-ins per 15 minutes per email and IP            |
| `DEMO_MODE`                             | `true`                                 | Persona list and passwordless demo sign-in                   |
| `ENABLE_REMINDER_CRONS`                 | `false`                                | Reminder crons stay off in demo mode unless this is set      |
| `DEMO_RESET_CRON`                       | (unset)                                | For example `0 4 * * *` to reset the demo data every night   |
| `SEED_TODAY` / `SEED_FAKER_SEED`        | today / `4711`                         | Reference date and random seed of the demo data              |
| `TRAINING_EXECUTIVE_THRESHOLD_CENTS`    | `500000`                               | Cost from which a training needs the executive step (€5,000) |
| `CRON_*`                                | see `.env.example`                     | Schedules of the reminder and maintenance jobs               |

Business rules such as reminder cadences, high-priority windows, the acceptance deadline for
devices and the reopen window for people requests are variables too; see `.env.example`.

## License

[MIT](./LICENSE) © 2026 Marten Ackermann
