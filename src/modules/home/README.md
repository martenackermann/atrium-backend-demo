# Home module (`src/modules/home`)

**Status:** built by slice A4 - `GET /home/my-day` (API.md §7.4).

No tables. `services/home.service.ts` combines the core inbox head (`InboxService.inbox`, first 5)
with the merged `MyDayContributor` fragments (`InboxService.myDay`): upcoming items of the next
30 days (max 8, sorted), assets, news and links.

## Owned files

- `src/modules/home/**` - controllers, services, DTOs, machines, abilities, jobs, mail templates, seeders, tests
- `prisma/schema/home.prisma` - this module's Prisma models

Anything outside these paths is shared (see CONVENTIONS §1.9). Back-relations to core models go
only inside your `// >>> A<n> relations` block in `prisma/schema/core.prisma`.

## Layout

```
src/modules/home/
  home.module.ts
  controllers/   services/   dto/   machines/   abilities/
  jobs/          mail/       seed/
```

Follow the slice recipe in `CONVENTIONS.md` §1 (files, Prisma block, registrations, seed hook, tests).
`_spec/atrium/SPEC_RESOLUTIONS.md` overrides SPEC/API/SCREENS where they conflict.
