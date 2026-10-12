#!/bin/sh
set -e

echo "[entrypoint] applying database migrations"
node node_modules/prisma/build/index.js migrate deploy

if [ "${SEED_ON_FIRST_RUN:-false}" = "true" ]; then
  echo "[entrypoint] seeding demo data (skipped when already seeded)"
  node dist/database/seed/run.js --if-empty
fi

echo "[entrypoint] starting Atrium API"
exec node dist/main.js
