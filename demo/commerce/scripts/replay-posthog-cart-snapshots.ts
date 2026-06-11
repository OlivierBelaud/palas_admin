// Replay PostHog cart/checkout events into local snapshots without storing
// an event mirror in Postgres. PostHog remains the event source of truth;
// this script only folds events into `carts` / `contacts` snapshots.
//
// Dry-run by default:
//   pnpm exec tsx scripts/replay-posthog-cart-snapshots.ts --prod --days 30
//   pnpm exec tsx scripts/replay-posthog-cart-snapshots.ts --prod --days 30 --apply

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { applyEvent, type PosthogEvent, type RawDb } from '../src/modules/cart-tracking/apply-event'
import { parsePosthogProperties } from '../src/modules/cart-tracking/posthog-sync'
import { runPosthogHogQL } from '../src/utils/posthog-query'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const useProd = args.includes('--prod')
const apply = args.includes('--apply')

function loadEnv(rel: string, override: boolean): void {
  const full = resolve(here, '..', rel)
  try {
    const raw = readFileSync(full, 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      if (override || !process.env[m[1]]) {
        let value = m[2].trim()
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }
        process.env[m[1]] = value
      }
    }
  } catch {
    // ignore
  }
}

function readNumberFlag(name: string, fallback: number): number {
  const idx = args.indexOf(name)
  if (idx === -1) return fallback
  const raw = args[idx + 1]
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : fallback
}

loadEnv('.env', false)
const localPosthogPersonalKey = process.env.POSTHOG_PERSONAL_API_KEY
const localPosthogKey = process.env.POSTHOG_API_KEY
if (useProd) {
  loadEnv('.env.production', true)
  if (localPosthogPersonalKey) process.env.POSTHOG_PERSONAL_API_KEY = localPosthogPersonalKey
  if (localPosthogKey) process.env.POSTHOG_API_KEY = localPosthogKey
}

const DAYS = readNumberFlag('--days', 45)
const PAGE = readNumberFlag('--page-size', 1000)
const SINCE_ISO = new Date(Date.now() - DAYS * 86400 * 1000).toISOString()
const DATABASE_URL = process.env.DATABASE_URL
const PH_KEY = process.env.POSTHOG_PERSONAL_API_KEY ?? process.env.POSTHOG_API_KEY

if (!DATABASE_URL) throw new Error('DATABASE_URL missing')
if (!PH_KEY) throw new Error('POSTHOG_API_KEY missing')

const sql = postgres(DATABASE_URL, {
  ssl: useProd || /neon\.tech/.test(DATABASE_URL) ? 'require' : undefined,
  max: 4,
  prepare: false,
})

const db: RawDb = {
  raw: async <T>(query: string, params?: unknown[]): Promise<T[]> => sql.unsafe(query, params) as Promise<T[]>,
}

function rowToEvent(row: unknown[]): PosthogEvent | null {
  const [uuid, event, distinctId, timestamp, properties] = row
  if (typeof event !== 'string' || typeof timestamp !== 'string') return null
  return {
    uuid: String(uuid ?? ''),
    event,
    distinct_id: distinctId == null ? null : String(distinctId),
    timestamp,
    properties: parsePosthogProperties(properties),
  }
}

async function hogql(query: string, retries = 6): Promise<unknown[][]> {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await runPosthogHogQL(query, { privateKey: PH_KEY })
    } catch (err) {
      const message = (err as Error).message
      if (
        message.includes('HogQL 429') ||
        message.includes('HogQL 5') ||
        message.includes('ECONNRESET') ||
        message.includes('ETIMEDOUT') ||
        message.includes('UND_ERR_SOCKET')
      ) {
        const wait = 5000 * (attempt + 1)
        console.log(`  retry ${attempt + 1}/${retries} in ${wait}ms: ${message.slice(0, 120)}`)
        await new Promise((resolveWait) => setTimeout(resolveWait, wait))
        continue
      }
      throw err
    }
  }
  throw new Error('HogQL retries exhausted')
}

let read = 0
let applied = 0
let skipped = 0
let errors = 0
let decodedDropped = 0

try {
  console.log(
    `[replay-posthog-cart-snapshots] target=${useProd ? 'PROD' : 'LOCAL'} apply=${apply} days=${DAYS} since=${SINCE_ISO}`,
  )

  let offset = 0
  while (true) {
    const rows = await hogql(`
      SELECT uuid, event, distinct_id, timestamp, properties
      FROM events
      WHERE timestamp >= toDateTime('${SINCE_ISO}')
        AND (event LIKE 'cart:%' OR event LIKE 'checkout:%')
      ORDER BY timestamp ASC, uuid ASC
      LIMIT ${PAGE} OFFSET ${offset}
    `)
    if (rows.length === 0) break
    read += rows.length

    for (const row of rows) {
      const evt = rowToEvent(row)
      if (!evt) {
        decodedDropped += 1
        continue
      }
      if (!apply) {
        skipped += 1
        continue
      }
      const outcome = await applyEvent(db, evt, { warn: (msg) => console.warn(msg) }, errors)
      if (outcome === 'rebuilt') applied += 1
      else if (outcome === 'skipped') skipped += 1
      else errors += 1
    }

    console.log(`  offset=${offset} read=${read} applied=${applied} skipped=${skipped} errors=${errors}`)
    offset += rows.length
    if (rows.length < PAGE) break
  }

  const [summary] = await sql`
    SELECT COUNT(*)::int AS carts,
           MAX(last_action_at) AS max_last_action_at,
           MAX(updated_at) AS max_updated_at,
           COUNT(*) FILTER (WHERE last_action_at >= NOW() - INTERVAL '24 hours')::int AS carts_24h
      FROM carts
  `
  console.log(
    JSON.stringify(
      {
        read,
        applied,
        skipped,
        errors,
        decodedDropped,
        summary,
      },
      null,
      2,
    ),
  )
} finally {
  await sql.end({ timeout: 5 })
}
