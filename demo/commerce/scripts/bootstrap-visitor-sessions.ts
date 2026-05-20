// One-shot bootstrap — create the `visitor_sessions` table + its indexes.
//
// `visitor_sessions` is the folded snapshot of PostHog browsing sessions,
// keyed by (distinct_id, $session_id). See
// `src/modules/visitor-session/README.md` for full context.
//
// Standalone tsx script — same pattern as `bootstrap-cart-stats-fields.ts`.
// Loads .env (ambient) then optionally overrides with .env.production
// when `--prod` is passed.
//
// Usage (local DB):
//   cd demo/commerce
//   pnpm exec tsx scripts/bootstrap-visitor-sessions.ts
//
// Usage (prod Neon):
//   cd demo/commerce
//   pnpm exec tsx scripts/bootstrap-visitor-sessions.ts --prod
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

const MIGRATION_NAME = 'visitor_sessions_bootstrap_2026_05_12'

// One statement per item — easier to read in logs and easier to debug.
// All idempotent (IF NOT EXISTS).
const STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS visitor_sessions (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     distinct_id text NOT NULL,
     session_id text NOT NULL,
     started_at timestamp NOT NULL,
     last_event_at timestamp NOT NULL,
     pageviews_count integer NOT NULL DEFAULT 0,
     email_at_session_start text,
     email_at_session_end text,
     contact_id text,
     segment_at_session_start text NOT NULL,
     first_url text,
     utm_source text,
     utm_medium text,
     utm_campaign text,
     referring_domain text,
     is_paid_session boolean NOT NULL DEFAULT false,
     carts_viewed_in_session integer NOT NULL DEFAULT 0,
     carts_created_in_session integer NOT NULL DEFAULT 0,
     carts_updated_in_session integer NOT NULL DEFAULT 0,
     cart_converted boolean NOT NULL DEFAULT false,
     order_id text,
     became_customer_in_session boolean NOT NULL DEFAULT false,
     became_customer_at timestamp,
     email_acquired_in_session boolean NOT NULL DEFAULT false,
     email_acquired_via text,
     email_acquired_at timestamp,
     seen_event_uuids jsonb,
     created_at timestamp NOT NULL DEFAULT now(),
     updated_at timestamp NOT NULL DEFAULT now(),
     deleted_at timestamp
   )`,
  `ALTER TABLE visitor_sessions
     ADD COLUMN IF NOT EXISTS carts_viewed_in_session integer NOT NULL DEFAULT 0`,
  `ALTER TABLE visitor_sessions
     ADD COLUMN IF NOT EXISTS became_customer_in_session boolean NOT NULL DEFAULT false`,
  `ALTER TABLE visitor_sessions
     ADD COLUMN IF NOT EXISTS became_customer_at timestamp`,
  `ALTER TABLE visitor_sessions
     ADD COLUMN IF NOT EXISTS email_acquired_at timestamp`,
  // Conflict target for upsertWithReplace on (distinct_id, session_id)
  `CREATE UNIQUE INDEX IF NOT EXISTS visitor_sessions_distinct_session_uq
     ON visitor_sessions(distinct_id, session_id)`,
  `CREATE INDEX IF NOT EXISTS visitor_sessions_started_at_idx
     ON visitor_sessions(started_at)`,
  // had_paid_7d self-join — Phase H dashboard query.
  `CREATE INDEX IF NOT EXISTS visitor_sessions_distinct_started_paid_idx
     ON visitor_sessions(distinct_id, started_at, is_paid_session)`,
  // Partial index — only converted sessions, kept tiny for funnel queries.
  `CREATE INDEX IF NOT EXISTS visitor_sessions_cart_converted_idx
     ON visitor_sessions(cart_converted) WHERE cart_converted = true`,
  `CREATE INDEX IF NOT EXISTS visitor_sessions_became_customer_idx
     ON visitor_sessions(became_customer_in_session) WHERE became_customer_in_session = true`,
  `CREATE INDEX IF NOT EXISTS visitor_sessions_distinct_id_idx
     ON visitor_sessions(distinct_id)`,
  `CREATE INDEX IF NOT EXISTS visitor_sessions_segment_idx
     ON visitor_sessions(segment_at_session_start)`,
]

const sql = postgres(DATABASE_URL, {
  ssl: useProd ? 'require' : undefined,
  max: 2,
  prepare: false,
})

try {
  console.log(`[bootstrap] target: ${useProd ? 'PROD (Neon)' : 'LOCAL'}`)
  for (const stmt of STATEMENTS) {
    const preview = stmt.replace(/\s+/g, ' ').slice(0, 100)
    console.log(`[bootstrap] ${preview}${preview.length < stmt.length ? '…' : ''}`)
    await sql.unsafe(stmt)
  }
  console.log('[bootstrap] table + indexes OK')

  await sql.unsafe(`INSERT INTO _manta_migrations (name, applied_sql) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [
    MIGRATION_NAME,
    STATEMENTS.join(';\n'),
  ])

  const [{ count }] = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM visitor_sessions`
  console.log(`[bootstrap] done — visitor_sessions row count: ${count}`)
} catch (err) {
  console.error('[bootstrap] FAILED:', err)
  process.exitCode = 1
} finally {
  await sql.end()
}
