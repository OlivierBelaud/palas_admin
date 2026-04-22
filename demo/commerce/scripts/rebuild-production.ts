// Local rebuild-production — run the full rebuildCarts flow from the laptop,
// not from a Vercel serverless function. Vercel Hobby caps Node functions at
// 10s, which is not enough to sync + replay a few thousand PostHog events.
//
// Usage:
//   cd demo/commerce
//   pnpm rebuild:production
//
// Runs via `tsx` so TypeScript imports of `apply-event.ts` and
// `identity-resolver.ts` work without a compile step.
//
// It loads credentials from .env.production (DATABASE_URL + POSTHOG_API_KEY)
// and performs the same idempotent flow as rebuildCarts (packages it into the
// durable posthog_event_log, then replays to carts). Safe to re-run — the log
// dedupes on PostHog's uuid, and the replay wipes + rebuilds the snapshot.
//
// This is a temporary crutch for the Hobby plan. Once on Pro (or on an
// Upstash QStash queue), the admin UI button is sufficient.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { applyEvent, type PosthogEvent, type RawDb } from '../src/modules/cart-tracking/apply-event'
import { enrichEventWithEmail, resolveEmailsBatch } from '../src/modules/cart-tracking/identity-resolver'

// ── 1. Env ────────────────────────────────────────────────────────────
// Load .env first (ambient tokens — POSTHOG_API_KEY, KLAVIYO_API_KEY, ...),
// then .env.production on top so DATABASE_URL points at Neon prod instead of
// localhost. The production file is expected to be gitignored and to only
// override the handful of vars that differ from local dev.
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
    console.log(`[rebuild-production] Loaded ${full}`)
    return true
  } catch (err) {
    console.warn(`[rebuild-production] Skipped ${full}: ${(err as Error).message}`)
    return false
  }
}
loadEnv('.env', { override: false })
loadEnv('.env.production', { override: true })

const DATABASE_URL = process.env.DATABASE_URL
const POSTHOG_HOST = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY
if (!DATABASE_URL) {
  console.error('DATABASE_URL missing')
  process.exit(1)
}
if (!POSTHOG_API_KEY) {
  console.error('POSTHOG_API_KEY missing')
  process.exit(1)
}

// ── 2. DB ────────────────────────────────────────────────────────────
const sql = postgres(DATABASE_URL, { ssl: 'require', max: 4, prepare: false })
const db: RawDb = {
  raw: async <T>(query: string, params: unknown[] = []): Promise<T[]> => {
    return (await sql.unsafe(query, params as never[])) as unknown as T[]
  },
}

const log = {
  warn: (msg: string) => console.warn(msg),
}

// ── 3. Staging log DDL (idempotent) ─────────────────────────────────
await db.raw(`DROP TABLE IF EXISTS posthog_event_staging`)
await db.raw(`
  CREATE TABLE IF NOT EXISTS posthog_event_log (
    posthog_uuid TEXT PRIMARY KEY,
    event_name TEXT NOT NULL,
    distinct_id TEXT,
    event_timestamp TIMESTAMPTZ NOT NULL,
    properties JSONB NOT NULL,
    inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`)
await db.raw(`CREATE INDEX IF NOT EXISTS idx_posthog_event_log_ts ON posthog_event_log(event_timestamp)`)

// ── 4. Step 1: incremental sync from PostHog ─────────────────────────
const maxRows = await db.raw<{ max_ts: Date | null }>(`SELECT MAX(event_timestamp) AS max_ts FROM posthog_event_log`)
const sinceTs = maxRows[0]?.max_ts
const sinceIso = sinceTs ? (sinceTs instanceof Date ? sinceTs.toISOString() : String(sinceTs)) : null
const sinceFilter = sinceIso ? ` AND timestamp > toDateTime('${sinceIso}')` : ''

console.log(`[rebuild-production] Syncing PostHog events from ${sinceIso ?? 'genesis'}...`)

async function hogql(query: string): Promise<unknown[][]> {
  const res = await fetch(`${POSTHOG_HOST}/api/projects/@current/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${POSTHOG_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  })
  if (!res.ok) throw new Error(`PostHog ${res.status}: ${await res.text().catch(() => '')}`)
  const body = (await res.json()) as { results?: unknown[][] }
  return body.results ?? []
}

const countRows = (await hogql(
  `SELECT count() FROM events WHERE (event LIKE 'cart:%' OR event LIKE 'checkout:%')${sinceFilter}`,
)) as unknown[][]
const newEventsInPosthog = Number(countRows[0]?.[0] ?? 0) || 0
console.log(`[rebuild-production] PostHog has ${newEventsInPosthog} new event(s) to sync`)

const POSTHOG_PAGE_SIZE = 1000
const LOG_INSERT_BATCH = 200
let newlyInserted = 0
let offset = 0
let page = 0

while (newEventsInPosthog > 0) {
  const batch = await hogql(
    `SELECT uuid, event, distinct_id, timestamp, properties FROM events WHERE (event LIKE 'cart:%' OR event LIKE 'checkout:%')${sinceFilter} ORDER BY timestamp ASC LIMIT ${POSTHOG_PAGE_SIZE} OFFSET ${offset}`,
  )
  if (batch.length === 0) break

  const events: PosthogEvent[] = batch.map((row) => ({
    uuid: String(row[0]),
    event: String(row[1]),
    distinct_id: (row[2] ?? null) as string | null,
    timestamp: String(row[3]),
    properties: (typeof row[4] === 'string' ? JSON.parse(row[4] as string) : (row[4] ?? {})) as Record<string, unknown>,
  }))

  for (let i = 0; i < events.length; i += LOG_INSERT_BATCH) {
    const chunk = events.slice(i, i + LOG_INSERT_BATCH)
    const placeholders = []
    const params = []
    for (let j = 0; j < chunk.length; j += 1) {
      const p = j * 5
      placeholders.push(`($${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}::jsonb)`)
      const evt = chunk[j]
      params.push(evt.uuid, evt.event, evt.distinct_id, evt.timestamp, JSON.stringify(evt.properties))
    }
    const inserted = await db.raw(
      `INSERT INTO posthog_event_log (posthog_uuid, event_name, distinct_id, event_timestamp, properties)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (posthog_uuid) DO NOTHING
       RETURNING posthog_uuid`,
      params,
    )
    newlyInserted += inserted.length
  }

  page += 1
  offset += batch.length
  process.stdout.write(
    `\r[rebuild-production] Synced ${newlyInserted}/${newEventsInPosthog} new events (page ${page})  `,
  )
  if (batch.length < POSTHOG_PAGE_SIZE) break
}
if (page > 0) process.stdout.write('\n')

const totalRows = await db.raw<{ total: string }>(`SELECT COUNT(*)::text AS total FROM posthog_event_log`)
const total = Number(totalRows[0]?.total ?? 0)
console.log(`[rebuild-production] Sync done — ${newlyInserted} new inserts, log total=${total}`)

// ── 5. Step 2: wipe + replay ─────────────────────────────────────────
console.log('[rebuild-production] Resolving PostHog person identities...')
const emailMap = await resolveEmailsBatch()
console.log(`[rebuild-production] Identity map: ${emailMap.size} pairs`)

await db.raw(`DELETE FROM cart_events`)
await db.raw(`DELETE FROM carts`)
console.log('[rebuild-production] Snapshot tables wiped')

let rebuilt = 0
let skipped = 0
let errors = 0
let identitiesRecovered = 0
let done = 0

const LOG_READ_BATCH = 500
let lastTs: string | null = null
let lastUuid: string | null = null
while (true) {
  const params: unknown[] = [LOG_READ_BATCH]
  let where = ''
  if (lastTs !== null && lastUuid !== null) {
    where = ' WHERE (event_timestamp, posthog_uuid) > ($2::timestamptz, $3)'
    params.push(lastTs, lastUuid)
  }
  const rows = await db.raw<{
    posthog_uuid: string
    event_name: string
    distinct_id: string | null
    event_timestamp: Date
    properties: Record<string, unknown>
  }>(
    `SELECT posthog_uuid, event_name, distinct_id, event_timestamp, properties
       FROM posthog_event_log${where}
      ORDER BY event_timestamp ASC, posthog_uuid ASC
      LIMIT $1`,
    params,
  )
  if (rows.length === 0) break

  for (const row of rows) {
    // postgres.js with `prepare: false` returns JSONB as a raw string — parse
    // back to an object so normalizeCartEvent + enrichEventWithEmail can read
    // properties.$set, properties.items, etc. Re-parse is cheap vs the HTTP
    // roundtrips we just saved on the fetch side.
    const parsedProps =
      typeof row.properties === 'string'
        ? (JSON.parse(row.properties) as Record<string, unknown>)
        : ((row.properties ?? {}) as Record<string, unknown>)
    const evt: PosthogEvent = {
      uuid: row.posthog_uuid,
      event: row.event_name,
      distinct_id: row.distinct_id,
      timestamp: row.event_timestamp instanceof Date ? row.event_timestamp.toISOString() : String(row.event_timestamp),
      properties: parsedProps,
    }
    if (enrichEventWithEmail(evt, emailMap)) identitiesRecovered += 1
    const outcome = await applyEvent(db, evt, log, errors)
    if (outcome === 'rebuilt') rebuilt += 1
    else if (outcome === 'skipped') skipped += 1
    else errors += 1
    lastTs = evt.timestamp
    lastUuid = row.posthog_uuid
    done += 1
  }
  process.stdout.write(`\r[rebuild-production] Replayed ${done}/${total}  `)
}
process.stdout.write('\n')

console.log(
  `[rebuild-production] Done — rebuilt=${rebuilt} skipped=${skipped} errors=${errors} identities_recovered=${identitiesRecovered}`,
)

await sql.end()
