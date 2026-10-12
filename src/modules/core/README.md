# Core module (`src/modules/core`)

**Status:** empty shell (phase 2a). Filled by **the foundation (phase 2b)**.

**Scope (to be detailed from `_spec/atrium/SPEC.md` / `API.md`):** users, org units, roles/personas, login, inbox and notification fan-out.

## Owned files

- `src/modules/core/**` - controllers, services, DTOs, machines, abilities, jobs, mail templates, seeders, tests
- `prisma/schema/core.prisma` - this module's Prisma models

Anything outside these paths is shared. Change it only through the registries documented in
`CONVENTIONS.md` (seeders list, AppModule import), or ask the foundation owner.

## Layout

```
src/modules/core/
  core.module.ts
  controllers/   services/   dto/   machines/   abilities/
  jobs/          mail/       seed/
```

See `CONVENTIONS.md` for patterns (DTOs, pagination, workflow actions, jobs, mail, tests).
