# People module (`src/modules/people`)

**Status:** built by slice A4 - onboarding / offboarding / role-or-access-change requests.

- `prisma/schema/people.prisma`: `people_requests` (personal data as columns, private address as flat
  `private*` columns), `people_request_comments` (`kind`: comment / question / status_note, #19),
  `job_roles` (37 seeded).
- Workflow `people_request` (SPEC §5.4): `machines/people-request.machine.ts` + `.workflow.ts`
  (`requester_replied` is a system event fired by a requester's reply while waiting).
- Visibility and personal data: `services/people-access.ts` (requester, manager, manager's deputy
  read-only; personal data and documents for requester, manager, people_ops - never it_admin,
  SPEC_RESOLUTIONS #24/#25).
- Endpoints (API.md §7.1): `/people/requests*`, `/people/job-roles*`, `/people/queues/counts`.
- Providers: inbox (`people.reply_required`, `people.triage_required`), search, attachment policy.
- Notifications: `people.request_created`, `people.status_changed`, `people.comment_added`.
- Seed: `seed/people.story.ts` (S-P1..S-P11 = PPL-000001..011, fillers 12..15) + `people.seed.ts`.

## Owned files

- `src/modules/people/**` - controllers, services, DTOs, machines, abilities, jobs, mail templates, seeders, tests
- `prisma/schema/people.prisma` - this module's Prisma models

Anything outside these paths is shared (see CONVENTIONS §1.9). Back-relations to core models go
only inside your `// >>> A<n> relations` block in `prisma/schema/core.prisma`.

## Layout

```
src/modules/people/
  people.module.ts
  controllers/   services/   dto/   machines/   abilities/
  jobs/          mail/       seed/
```

Follow the slice recipe in `CONVENTIONS.md` §1 (files, Prisma block, registrations, seed hook, tests).
`_spec/atrium/SPEC_RESOLUTIONS.md` overrides SPEC/API/SCREENS where they conflict.
