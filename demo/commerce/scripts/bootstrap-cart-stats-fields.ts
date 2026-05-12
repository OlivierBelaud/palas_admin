// One-shot bootstrap — add the `cart_birth_at` and `completed_at` columns
// (plus the `cart_birth_at` index) to the `carts` table.
//
// Why this script exists:
//   - `cart_birth_at` is a new column introduced for visitor-session
//     attribution (Phase A of the visitor-session epic). It is the
//     immutable first-event timestamp for a cart, distinct from
//     `created_at` (which gets re-stamped by `rebuild-carts`).
//   - `completed_at` already exists in some environments — earlier work
//     added it — but the `ADD COLUMN IF NOT EXISTS` is included so this
//     script is the single source of truth and bootstraps a fresh DB in
//     one go.
//
// Standalone tsx script — same pattern as `bootstrap-email-captures.ts`.
// Loads .env (ambient) then optionally overrides with .env.production
// when `--prod` is passed.
//
// Usage (local DB):
//   cd demo/commerce
//   pnpm exec tsx scripts/bootstrap-cart-stats-fields.ts
//
// Usage (prod Neon):
//   cd demo/commerce
//   pnpm exec tsx scripts/bootstrap-cart-stats-fields.ts --prod
//
// Idempotent — safe to re-run. Registers itself in `_manta_migrations`
// so a future `manta db:migrate` doesn't try to re-apply anything.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const here = dirname(fileURLToPath(import.meta.url))

function loadEnv(relPath: string, { override }: { override: boolean }): boolean {
  const full = resolve(here, '..', relPath)
  try {
    const raw = readFileSync(full, 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      if (override || !process.env[m[1]]) process.env[m[1]] = m[2]
    }
    console.log(`[bootstrap] loaded ${full}`)
    return true
  } catch {
    return false
  }
}

const useProd = process.argv.includes('--prod')
loadEnv('.env', { override: false })
if (useProd) loadEnv('.env.production', { override: true })

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL missing — add to .env or .env.production')
  process.exit(1)
}

const MIGRATION_NAME = 'cart_stats_fields_bootstrap_2026_05_12'

// One statement per item — easier to read in logs and easier to debug
// if any single ALTER raises on a quirky DB state. All idempotent.
const STATEMENTS: string[] = [
  `ALTER TABLE carts ADD COLUMN IF NOT EXISTS cart_birth_at timestamp`,
  `ALTER TABLE carts ADD COLUMN IF NOT EXISTS completed_at timestamp`,
  `CREATE INDEX IF NOT EXISTS idx_carts_cart_birth_at ON carts(cart_birth_at)`,
]

const sql = postgres(DATABASE_URL, {
  ssl: useProd ? 'require' : undefined,
  max: 2,
  prepare: false,
})

try {
  console.log(`[bootstrap] target: ${useProd ? 'PROD (Neon)' : 'LOCAL'}`)
  for (const stmt of STATEMENTS) {
    console.log(`[bootstrap] ${stmt}`)
    await sql.unsafe(stmt)
  }
  console.log('[bootstrap] columns + index OK')

  await sql.unsafe(`INSERT INTO _manta_migrations (name, applied_sql) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [
    MIGRATION_NAME,
    STATEMENTS.join(';\n'),
  ])

  const [{ count }] = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM carts`
  console.log(`[bootstrap] done — carts row count: ${count}`)
} catch (err) {
  console.error('[bootstrap] FAILED:', err)
  process.exitCode = 1
} finally {
  await sql.end()
}
