# Assets module (`src/modules/assets`)

**Status:** empty shell, registered in AppModule. Filled by **slice A3**.

**Scope (to be detailed from `_spec/atrium/SPEC.md` / `API.md`):** IT assets and asset requests.

## Owned files

- `src/modules/assets/**` - controllers, services, DTOs, machines, abilities, jobs, mail templates, seeders, tests
- `prisma/schema/assets.prisma` - this module's Prisma models

Anything outside these paths is shared (see CONVENTIONS §1.9). Back-relations to core models go
only inside your `// >>> A<n> relations` block in `prisma/schema/core.prisma`.

## Layout

```
src/modules/assets/
  assets.module.ts
  controllers/   services/   dto/   machines/   abilities/
  jobs/          mail/       seed/
```

Follow the slice recipe in `CONVENTIONS.md` §1 (files, Prisma block, registrations, seed hook, tests).
`_spec/atrium/SPEC_RESOLUTIONS.md` overrides SPEC/API/SCREENS where they conflict.
