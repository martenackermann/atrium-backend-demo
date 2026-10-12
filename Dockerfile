# syntax=docker/dockerfile:1

# ---- base: node + pnpm (via corepack, version from package.json "packageManager") ----
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    PRISMA_HIDE_UPDATE_MESSAGE=1
# openssl: required by Prisma's schema engine (migrate deploy) on musl
RUN apk add --no-cache openssl && corepack enable
WORKDIR /app

# ---- deps: full install (postinstall runs `prisma generate`) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma ./prisma
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ---- build: compile TypeScript ----
FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN pnpm prisma generate && pnpm build

# ---- prod-deps: drop dev dependencies ----
FROM deps AS prod-deps
RUN pnpm prune --prod

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3100 \
    STORAGE_DIR=/app/storage
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json prisma.config.ts ./
COPY prisma ./prisma
COPY docker/entrypoint.sh ./docker/entrypoint.sh
RUN mkdir -p /app/storage && chown -R node:node /app/storage
USER node
EXPOSE 3100
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3100/api/v1/health > /dev/null || exit 1
# Applies migrations, optionally seeds on first run (SEED_ON_FIRST_RUN=true), then starts the API.
ENTRYPOINT ["sh", "./docker/entrypoint.sh"]
