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

- API: http://localhost:3100/api/v1/health - Swagger UI: http://localhost:3100/api/docs
- Log in as any demo persona (e.g. `emma.employee@example.com`) with the demo-only password `demo1234`,
  or list them at `GET /api/v1/auth/personas`.
- Mailpit (captured emails): http://localhost:8025

The first start applies migrations and seeds demo data.

## Local development

Requirements: Node 22+, pnpm 10, PostgreSQL 17, an SMTP catcher (Mailpit).

```bash
pnpm install              # also runs `prisma generate`
cp .env.example .env      # local-dev placeholders
pnpm db:migrate:deploy    # create the schema (or pnpm db:push while developing)
pnpm db:seed              # demo data: 52 users, 9 personas (password demo1234)
pnpm start:dev            # http://localhost:3100
```

| Script                                                           | Purpose                                             |
| ---------------------------------------------------------------- | --------------------------------------------------- |
| `pnpm lint` / `pnpm typecheck`                                   | ESLint + Prettier check / `tsc --noEmit`            |
| `pnpm test` (`test:unit`, `test:e2e`)                            | Vitest; e2e boots the app against `atrium_test`     |
| `pnpm build` / `pnpm start`                                      | Compile to `dist/` / run it                         |
| `pnpm db:push` / `db:migrate:deploy` / `db:migration:new <name>` | Schema sync, apply migrations, generate a migration |
| `pnpm db:seed` / `db:reset` / `demo:reset`                       | Demo data; truncate + push + seed; truncate + seed  |
| `pnpm seed:export-users <path>`                                  | Write the seeded org as JSON (frontend mocks)       |
| `pnpm openapi:export`                                            | Write `openapi.json` (CI fails if it is stale)      |

Mail templates can be previewed at `GET /api/v1/dev/mail-preview` (not in production).

## Documentation

- [`CONVENTIONS.md`](./CONVENTIONS.md) - project layout and how to build a module
- [`openapi.json`](./openapi.json) - the API contract (also served at `/api/openapi.json`)

## License

[MIT](./LICENSE) © 2026 Marten Ackermann
