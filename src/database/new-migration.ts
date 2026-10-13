import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `pnpm db:migration:new <slice>_<topic>` (e.g. `a1_training_init`) - writes
 * `prisma/migrations/<yyyyMMddHHmmss>_<name>/migration.sql` with the SQL that brings the
 * database in DATABASE_URL to prisma/schema. Read-only: it never changes the database.
 * The database must be at the latest committed migration first (`pnpm db:migrate:deploy`
 * on a fresh database), so the diff contains only your changes.
 */
const name = process.argv[2];
if (!name || !/^[a-z0-9]+(_[a-z0-9]+)+$/.test(name)) {
  console.error('Usage: pnpm db:migration:new <slice>_<topic>   e.g. a1_training_init');
  process.exit(1);
}
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const dir = join(process.cwd(), 'prisma', 'migrations', `${stamp}_${name}`);
mkdirSync(dir, { recursive: true });
execFileSync(
  process.execPath,
  [
    join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js'),
    'migrate',
    'diff',
    '--from-config-datasource',
    '--to-schema',
    'prisma/schema',
    '--script',
    '-o',
    join(dir, 'migration.sql'),
  ],
  { stdio: 'inherit', env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1' } },
);
console.log(`[db:migration:new] wrote ${join(dir, 'migration.sql')} - review it, then commit`);
