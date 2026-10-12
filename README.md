# Atrium API (backend demo)

NestJS API of **Atrium**, an employee self-service portal (training and travel requests,
IT assets, onboarding/offboarding, news) built as a portfolio demo for the fictional
company Acme IT Services. All names, people and data are fictional.

**Stack:** NestJS 11 · TypeScript (strict) · Prisma 7 + PostgreSQL 17 · zod (nestjs-zod) +
OpenAPI · XState v5 workflows · CASL authorization · pg-boss jobs · Nodemailer + MJML ·
pino logging · Vitest + Supertest.

## Quick start (Docker)

```bash
docker compose up --build
```

- API: http://localhost:3100/api/v1/health - Swagger UI: http://localhost:3100/docs
- Mailpit (captured emails): http://localhost:8025

The first start applies migrations and seeds demo data.

## Local development

Requirements: Node 22+, pnpm 10, PostgreSQL 17, an SMTP catcher (Mailpit).

```bash
pnpm install              # also runs `prisma generate`
cp .env.example .env      # local-dev placeholders
pnpm db:push              # sync prisma/schema to the database
pnpm db:seed              # demo data
pnpm start:dev            # http://localhost:3100
```

| Script                                                 | Purpose                                                  |
| ------------------------------------------------------ | -------------------------------------------------------- |
| `pnpm lint` / `pnpm typecheck`                         | ESLint + Prettier check / `tsc --noEmit`                 |
| `pnpm test` (`test:unit`, `test:e2e`)                  | Vitest; e2e boots the app against `atrium_test`          |
| `pnpm build` / `pnpm start`                            | Compile to `dist/` / run it                              |
| `pnpm db:push` / `db:migrate` / `db:seed` / `db:reset` | Prisma schema sync, migrations, demo data, wipe + reseed |
| `pnpm openapi:export`                                  | Write `openapi.json` (CI fails if it is stale)           |

Mail templates can be previewed at `GET /api/v1/dev/mail-preview` (not in production).

## Documentation

- [`CONVENTIONS.md`](./CONVENTIONS.md) - project layout and how to build a module
- [`openapi.json`](./openapi.json) - the API contract (also served at `/docs/openapi.json`)

## License

[MIT](./LICENSE) © 2026 Marten Ackermann
