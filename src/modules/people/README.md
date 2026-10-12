# People module (`src/modules/people`)

**Status:** empty shell (phase 2a). Filled by **slice A4**.

**Scope (to be detailed from `_spec/atrium/SPEC.md` / `API.md`):** onboarding/offboarding requests.

## Owned files

- `src/modules/people/**` - controllers, services, DTOs, machines, abilities, jobs, mail templates, seeders, tests
- `prisma/schema/people.prisma` - this module's Prisma models

Anything outside these paths is shared. Change it only through the registries documented in
`CONVENTIONS.md` (seeders list, AppModule import), or ask the foundation owner.

## Layout

```
src/modules/people/
  people.module.ts
  controllers/   services/   dto/   machines/   abilities/
  jobs/          mail/       seed/
```

See `CONVENTIONS.md` for patterns (DTOs, pagination, workflow actions, jobs, mail, tests).
