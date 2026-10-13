# Home module (`src/modules/home`)

**Status:** empty shell, registered in AppModule. Filled by **slice A4**.

**Scope (to be detailed from `_spec/atrium/SPEC.md` / `API.md`):** the home/dashboard view.

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
