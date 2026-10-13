# News module (`src/modules/news`)

**Status:** built by slice A4 - news posts and useful links.

- `prisma/schema/news.prisma`: `news_posts` (sanitised `body_html`, cover attachment, soft delete),
  `useful_links`.
- Workflow `news_post` (SPEC §5.5) + job `news.publish-and-expire` (`jobs/news.jobs.ts`, `CRON_NEWS`).
- Body sanitiser: `services/html-sanitizer.ts` (sanitize-html allowlist of SPEC §4.6).
- Endpoints (API.md §7.2-§7.3): `/news*`, `/links*` (`PUT /links/order` before `/:id`).
- Providers: search (published posts), my-day (`news`, `links`), attachment policy (covers).
- Seed: `seed/news.story.ts` (S-N1..S-N8, 10 links) + `news.seed.ts` (generated gradient cover).

## Owned files

- `src/modules/news/**` - controllers, services, DTOs, machines, abilities, jobs, mail templates, seeders, tests
- `prisma/schema/news.prisma` - this module's Prisma models

Anything outside these paths is shared (see CONVENTIONS §1.9). Back-relations to core models go
only inside your `// >>> A<n> relations` block in `prisma/schema/core.prisma`.

## Layout

```
src/modules/news/
  news.module.ts
  controllers/   services/   dto/   machines/   abilities/
  jobs/          mail/       seed/
```

Follow the slice recipe in `CONVENTIONS.md` §1 (files, Prisma block, registrations, seed hook, tests).
`_spec/atrium/SPEC_RESOLUTIONS.md` overrides SPEC/API/SCREENS where they conflict.
