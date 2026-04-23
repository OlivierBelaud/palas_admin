// One-shot bootstrap — create the `email_captures` table + its indexes.
//
// Standalone tsx script (same pattern as rebuild-production.ts) — talks to
// Postgres directly via the `postgres` library. Loads .env (ambient) then
// optionally overrides with .env.production when --prod is passed.
//
// Usage (local DB):
//   cd demo/commerce
//   pnpm exec tsx scripts/bootstrap-email-captures.ts
//
// Usage (prod Neon):
//   cd demo/commerce
//   pnpm exec tsx scripts/bootstrap-email-captures.ts --prod
//
// Idempotent — safe to re-run. Registers itself in `_manta_migrations` so a
// future `manta db:migrate` doesn't try to re-apply anything.

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

const MIGRATION_NAME = 'email_captures_bootstrap_2026_04_23'

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS email_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  cart_token text,
  source text NOT NULL DEFAULT 'cart_drawer_surprise',
  market text,
  posthog_distinct_id text,
  is_test boolean NOT NULL DEFAULT false,
  klaviyo_synced_at timestamp,
  posthog_synced_at timestamp,
  user_agent text,
  remote_ip text,
  created_at timestamp NOT NULL DEFAULT NOW(),
  updated_at timestamp NOT NULL DEFAULT NOW()
)
`

const INDEXES = [
  'CREATE INDEX IF NOT EXISTS email_captures_email_idx ON email_captures (email)',
  'CREATE INDEX IF NOT EXISTS email_captures_cart_token_idx ON email_captures (cart_token)',
  'CREATE INDEX IF NOT EXISTS email_captures_created_at_idx ON email_captures (created_at DESC)',
]

const sql = postgres(DATABASE_URL, {
  ssl: useProd ? 'require' : undefined,
  max: 2,
  prepare: false,
})

try {
  console.log(`[bootstrap] target: ${useProd ? 'PROD (Neon)' : 'LOCAL'}`)
  console.log('[bootstrap] creating table …')
  await sql.unsafe(CREATE_TABLE)

  for (const stmt of INDEXES) {
    await sql.unsafe(stmt)
  }
  console.log('[bootstrap] table + indexes OK')

  await sql.unsafe(`INSERT INTO _manta_migrations (name, applied_sql) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [
    MIGRATION_NAME,
    CREATE_TABLE.trim(),
  ])

  const [{ count }] = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM email_captures`
  console.log(`[bootstrap] done — row count: ${count}`)
} catch (err) {
  console.error('[bootstrap] FAILED:', err)
  process.exitCode = 1
} finally {
  await sql.end()
}
