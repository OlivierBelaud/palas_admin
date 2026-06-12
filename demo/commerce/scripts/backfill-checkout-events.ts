// One-shot backfill — pull 60 days of PostHog `checkout:*` events and
// hydrate the local snapshot DB (carts + cart_events). Needed because the
// 5-min sync cron historically used a single global high-water mark that
// the high-volume `cart:viewed` stream raced past, leaving most
// `checkout:completed` events stranded in PostHog.
//
// Direct postgres + adapter helpers on purpose — Manta `defineCommand`
// short-circuits at 300ms via Promise.race; from a one-shot CLI script we
// want the full pipeline awaited inline. See `detect-abandoned-carts.ts`
// header for the long version of the rationale.
//
// Idempotence:
//   - `carts` upsert: `applyEvent` finds the existing row by cart_token or
//     checkout_token and merges progressively. Safe to re-run.
//   - `cart_events`: no natural unique key in the schema, so we dedupe at
//     insert time using (cart_id, action, occurred_at) — a tuple that is
//     unique in practice for the Shopify pixel cadence.
//
// Run with:
//   pnpm exec tsx scripts/backfill-checkout-events.ts          # local DB
//   pnpm exec tsx scripts/backfill-checkout-events.ts --prod   # Neon prod
//   pnpm exec tsx scripts/backfill-checkout-events.ts --prod --dry-run

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { applyEvent, type PosthogEvent, type RawDb } from '../src/modules/cart-tracking/apply-event'
import { normalizeCartEvent } from '../src/modules/cart-tracking/posthog-adapter'

const here = dirname(fileURLToPath(import.meta.url))

function loadEnv(rel: string, override: boolean): void {
  const full = resolve(here, '..', rel)
  try {
    const raw = readFileSync(full, 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      if (override || !process.env[m[1]]) process.env[m[1]] = m[2]
    }
  } catch {
    // ignore
  }
}

const useProd = process.argv.includes('--prod')
const dryRun = process.argv.includes('--dry-run')
loadEnv('.env', false)
if (useProd) loadEnv('.env.production', true)

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL missing')
  process.exit(1)
}
const PH_HOST = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
const PH_KEY = process.env.POSTHOG_PERSONAL_API_KEY ?? process.env.POSTHOG_API_KEY
if (!PH_KEY) {
  console.error('[backfill-checkout-events] missing POSTHOG_PERSONAL_API_KEY / POSTHOG_API_KEY env')
  process.exit(1)
}

const needsSsl = useProd || /neon\.tech/.test(DATABASE_URL)
const sql = postgres(DATABASE_URL, { ssl: needsSsl ? 'require' : undefined, max: 4, prepare: false })

const db: RawDb = {
  raw: async <T>(query: string, params: unknown[] = []): Promise<T[]> => {
    return (await sql.unsafe(query, params as never[])) as unknown as T[]
  },
}

const log = {
  warn: (msg: string) => console.warn(msg),
}

async function hogql(query: string): Promise<unknown[][]> {
  const res = await fetch(`${PH_HOST}/api/projects/@current/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PH_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  })
  if (!res.ok) throw new Error(`HogQL ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { results?: unknown[][] }
  return data.results ?? []
}

const PAGE = 5000
const WINDOW_DAYS = 60

interface HogQLRow {
  uuid: string
  event: string
  distinct_id: string | null
  timestamp: string
  properties: Record<string, unknown>
}

function decodeRow(row: unknown[]): HogQLRow | null {
  const [uuid, event, distinctId, timestamp, props] = row
  if (typeof event !== 'string' || typeof timestamp !== 'string') return null
  let properties: Record<string, unknown>
  if (typeof props === 'string') {
    try {
      properties = JSON.parse(props) as Record<string, unknown>
    } catch {
      return null
    }
  } else {
    properties = (props ?? {}) as Record<string, unknown>
  }
  return {
    uuid: String(uuid ?? ''),
    event,
    distinct_id: distinctId == null ? null : String(distinctId),
    timestamp,
    properties,
  }
}

async function insertCartEventIfMissing(cartId: string, n: ReturnType<typeof normalizeCartEvent>): Promise<boolean> {
  if (!n) return false
  // Dedupe on (cart_id, action, occurred_at): in practice the Shopify Web
  // Pixel never emits the same action twice at the same millisecond for the
  // same cart, so this is a safe natural key for a one-shot backfill.
  const existing = await db.raw<{ id: string }>(
    'SELECT id FROM cart_events WHERE cart_id = $1 AND action = $2 AND occurred_at = $3 LIMIT 1',
    [cartId, n.event, n.occurred_at],
  )
  if (existing.length > 0) return false

  await db.raw(
    `INSERT INTO cart_events
       (id, cart_id, action, items_snapshot, total_price, item_count, currency,
        changed_items, occurred_at, distinct_id, email, checkout_token,
        shipping_method, shipping_price, discounts_amount, discounts,
        raw_properties, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3::jsonb, $4, $5, $6, $7::jsonb, $8, $9, $10,
             $11, $12, $13, $14, $15::jsonb, $16::jsonb, NOW(), NOW())`,
    [
      cartId,
      n.event,
      JSON.stringify(n.items),
      n.total_price,
      n.item_count,
      n.currency,
      n.changed_items != null ? JSON.stringify(n.changed_items) : null,
      n.occurred_at,
      n.distinct_id,
      n.email,
      n.checkout_token,
      n.shipping_method,
      n.shipping_price,
      n.discounts_amount,
      n.discounts != null ? JSON.stringify(n.discounts) : null,
      JSON.stringify(n.raw_properties),
    ],
  )
  return true
}

async function findCartId(cartToken: string): Promise<string | null> {
  const rows = await db.raw<{ id: string }>('SELECT id FROM carts WHERE cart_token = $1 LIMIT 1', [cartToken])
  return rows[0]?.id ?? null
}

try {
  console.log(`[backfill-checkout-events] target: ${useProd ? 'PROD' : 'LOCAL'}  dryRun: ${dryRun}`)
  const t0 = Date.now()

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  let offset = 0
  let totalRead = 0
  let totalNormalized = 0
  let totalIngestedCarts = 0
  let totalSkippedCarts = 0
  let totalCartEventsInserted = 0
  let totalCartEventsDuplicate = 0
  let totalErrors = 0
  let totalDropped = 0

  while (true) {
    const rows = await hogql(`
      SELECT uuid, event, distinct_id, timestamp, properties
        FROM events
       WHERE event LIKE 'checkout:%'
         AND timestamp > toDateTime('${since}')
       ORDER BY timestamp ASC
       LIMIT ${PAGE} OFFSET ${offset}
    `)
    if (rows.length === 0) break
    totalRead += rows.length

    for (const raw of rows) {
      const decoded = decodeRow(raw)
      if (!decoded) {
        totalDropped += 1
        continue
      }

      const evt: PosthogEvent = {
        uuid: decoded.uuid,
        event: decoded.event,
        distinct_id: decoded.distinct_id,
        timestamp: decoded.timestamp,
        properties: decoded.properties,
      }

      const n = normalizeCartEvent(evt)
      if (!n) {
        totalDropped += 1
        continue
      }
      totalNormalized += 1

      if (dryRun) {
        continue
      }

      try {
        const outcome = await applyEvent(db, evt, log, totalErrors)
        if (outcome === 'rebuilt') totalIngestedCarts += 1
        else if (outcome === 'skipped') totalSkippedCarts += 1
        else if (outcome === 'error') {
          totalErrors += 1
          continue
        }

        const cartId = await findCartId(n.cart_token)
        if (!cartId) {
          totalSkippedCarts += 1
          continue
        }
        const inserted = await insertCartEventIfMissing(cartId, n)
        if (inserted) totalCartEventsInserted += 1
        else totalCartEventsDuplicate += 1
      } catch (err) {
        totalErrors += 1
        if (totalErrors <= 10) {
          console.warn(`  error on ${decoded.event} (${decoded.uuid}): ${(err as Error).message}`)
        }
      }
    }

    console.log(
      `  scanned=${totalRead} normalized=${totalNormalized} cartsRebuilt=${totalIngestedCarts} cartEventsInserted=${totalCartEventsInserted} dup=${totalCartEventsDuplicate} skipped=${totalSkippedCarts} dropped=${totalDropped} errors=${totalErrors} (offset ${offset})`,
    )

    offset += rows.length
    if (rows.length < PAGE) break
  }

  console.log(`\n=== DONE in ${Math.round((Date.now() - t0) / 1000)}s ===`)
  console.log(`read:                  ${totalRead}`)
  console.log(`normalized:            ${totalNormalized}`)
  console.log(`carts rebuilt:         ${totalIngestedCarts}`)
  console.log(`carts skipped:         ${totalSkippedCarts}`)
  console.log(`cart_events inserted:  ${totalCartEventsInserted}`)
  console.log(`cart_events duplicate: ${totalCartEventsDuplicate}`)
  console.log(`dropped (un-normaliz): ${totalDropped}`)
  console.log(`errors:                ${totalErrors}`)
  if (dryRun) {
    console.log(`\n(dry-run — no rows written)`)
  }
} catch (err) {
  console.error('FAILED:', err)
  process.exitCode = 1
} finally {
  await sql.end()
}
