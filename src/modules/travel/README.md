# Travel module (`src/modules/travel`)

**Status:** empty shell, registered in AppModule. Filled by **slice A2**.

**Scope (to be detailed from `_spec/atrium/SPEC.md` / `API.md`):** travel requests and their approval workflow.

## Owned files

- `src/modules/travel/**` - controllers, services, DTOs, machines, abilities, jobs, mail templates, seeders, tests
- `prisma/schema/travel.prisma` - this module's Prisma models

Anything outside these paths is shared (see CONVENTIONS §1.9). Back-relations to core models go
only inside your `// >>> A<n> relations` block in `prisma/schema/core.prisma`.

## Layout

```
src/modules/travel/
  travel.module.ts
  controllers/   services/   dto/   machines/   abilities/
  jobs/          mail/       seed/
```

Follow the slice recipe in `CONVENTIONS.md` §1 (files, Prisma block, registrations, seed hook, tests).
`_spec/atrium/SPEC_RESOLUTIONS.md` overrides SPEC/API/SCREENS where they conflict.
