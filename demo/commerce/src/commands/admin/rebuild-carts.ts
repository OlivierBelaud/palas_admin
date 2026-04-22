// Command: rebuild the carts snapshot table from PostHog events.
// Wipes carts + cart_events, replays all cart/checkout events we've ever
// seen through the same upsert logic as ingestCartEvent.
//
// Decomposed into 3 steps per WORKFLOW_PROGRESS.md §11:
//   1. fetch-events   — incremental HogQL reads (only events we don't have
//                       yet) + UPSERT into the durable event log.
//   2. replay-events  — SELECT the full event log in batches and apply to
//                       carts.
//   3. persist-stats  — final summary counts.
//
// Why `posthog_event_log` (durable accumulating copy of PostHog cart/checkout
// events, deduped on PostHog's own UUID):
//   * Neon's TCP pooler caps query payloads at 64 MB — holding the full event
//     set in a checkpoint between steps 1 and 2 blew that limit as soon as
//     raw `properties` got verbose.
//   * Idempotent by design: each rebuild only fetches events we haven't seen
//     yet (WHERE timestamp > max(event_timestamp), then INSERT ... ON
//     CONFLICT DO NOTHING on PostHog's uuid).
//   * A subsequent "rebuild a single cart" action becomes a filter on
//     cart_token in the log — no PostHog roundtrip needed.
//   * When we're confident the live ingestion never drifts, this whole log
//     can be dropped; for now it's a cheap safety net + debug buffer.
//
// Compensation is documented as no-op: the rebuild is destructive by design
// (step 2 wipes both tables at the start). The user accepts this trade-off;
// compensation logs a warning only.
//
// Event extraction goes through `normalizeCartEvent` so this command and the
// live subscriber share the exact same read semantics (v2 unified schema +
// v1 legacy fallback). Never inspect `evt.properties` directly here.

import { type PosthogEvent, type RawDb, SPAM_EMAIL_RE, STAGES } from '../../modules/cart-tracking/apply-event'
import { enrichEventWithEmail, resolveEmailsBatch } from '../../modules/cart-tracking/identity-resolver'
import { normalizeCartEvent } from '../../modules/cart-tracking/posthog-adapter'

const POSTHOG_PAGE_SIZE = 1000
const LOG_INSERT_BATCH = 200 // rows per multi-values INSERT — keeps payload well under Neon's 64 MB cap
const LOG_READ_BATCH = 500

// Cleanup: early iterations used a table called `posthog_event_staging` with
// a batch_id column. The durable, idempotent design replaces it with
// `posthog_event_log` keyed on PostHog's own uuid. DROP the obsolete table
// if it lingers from an older deploy.
const LOG_DROP_LEGACY_DDL = `DROP TABLE IF EXISTS posthog_event_staging`

const LOG_DDL = `
  CREATE TABLE IF NOT EXISTS posthog_event_log (
    posthog_uuid TEXT PRIMARY KEY,
    event_name TEXT NOT NULL,
    distinct_id TEXT,
    event_timestamp TIMESTAMPTZ NOT NULL,
    properties JSONB NOT NULL,
    inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`
const LOG_IDX_DDL = `
  CREATE INDEX IF NOT EXISTS idx_posthog_event_log_ts
    ON posthog_event_log(event_timestamp)
`

export default defineCommand({
  name: 'rebuildCarts',
  description: 'Wipe carts table and rebuild from PostHog event history',
  input: z.object({}),
  workflow: async (_input, { step, log }) => {
    // ── Step 1: fetch-events — incremental sync from PostHog ───────
    const fetchEvents = step.action('fetch-events', {
      invoke: async (_i: unknown, ctx): Promise<{ total: number; newlyInserted: number }> => {
        const host = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
        const key = process.env.POSTHOG_API_KEY
        if (!key) throw new MantaError('INVALID_STATE', 'POSTHOG_API_KEY is required')

        const db = ctx.app.resolve('IDatabasePort') as RawDb | undefined
        if (!db) throw new MantaError('UNEXPECTED_STATE', 'No database')

        // Bootstrap the log table (drops the legacy batch_id-scoped variant
        // from earlier iterations if it lingers). CREATE IF NOT EXISTS is
        // idempotent and atomic.
        await db.raw(LOG_DROP_LEGACY_DDL)
        await db.raw(LOG_DDL)
        await db.raw(LOG_IDX_DDL)

        // Incremental: fetch only events newer than whatever we've already
        // logged. On first run or after a migration, the max is null and we
        // fetch everything.
        const maxRows = await db.raw<{ max_ts: Date | null }>(
          'SELECT MAX(event_timestamp) AS max_ts FROM posthog_event_log',
        )
        const sinceTs = maxRows[0]?.max_ts
        const sinceIso = sinceTs ? (sinceTs instanceof Date ? sinceTs.toISOString() : String(sinceTs)) : null
        const sinceFilter = sinceIso ? ` AND timestamp > toDateTime('${sinceIso}')` : ''

        log.info(`[rebuildCarts] Syncing PostHog events (incremental from ${sinceIso ?? 'genesis'})...`)

        // Count ALL events in PostHog (for determinate progress bar) and
        // the subset we still need to fetch.
        const countRes = await fetch(`${host}/api/projects/@current/query/`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: {
              kind: 'HogQLQuery',
              query: `SELECT count() FROM events WHERE (event LIKE 'cart:%' OR event LIKE 'checkout:%')${sinceFilter}`,
            },
          }),
          signal: ctx.signal,
        })
        if (!countRes.ok) throw new MantaError('UNEXPECTED_STATE', `PostHog count ${countRes.status}`)
        const countData = (await countRes.json()) as { results?: unknown[][] }
        const newEventsInPosthog = Number(countData.results?.[0]?.[0] ?? 0) || 0
        log.info(`[rebuildCarts] PostHog has ${newEventsInPosthog} events to sync`)

        ctx.progress?.(0, newEventsInPosthog || null, `Syncing ${newEventsInPosthog} new events`)

        let newlyInserted = 0
        let offset = 0
        let page = 0
        while (newEventsInPosthog > 0) {
          if (ctx.signal?.aborted) {
            throw new MantaError('CONFLICT', 'Cancelled during fetch', { code: 'WORKFLOW_CANCELLED' })
          }

          const res = await fetch(`${host}/api/projects/@current/query/`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: {
                kind: 'HogQLQuery',
                query: `SELECT uuid, event, distinct_id, timestamp, properties FROM events WHERE (event LIKE 'cart:%' OR event LIKE 'checkout:%')${sinceFilter} ORDER BY timestamp ASC LIMIT ${POSTHOG_PAGE_SIZE} OFFSET ${offset}`,
              },
            }),
            signal: ctx.signal,
          })
          if (!res.ok) throw new MantaError('UNEXPECTED_STATE', `PostHog ${res.status}`)
          const data = (await res.json()) as { results?: unknown[][] }
          if (!data.results) throw new MantaError('UNEXPECTED_STATE', 'No results from PostHog')

          const batch = data.results.map(
            // biome-ignore lint/suspicious/noExplicitAny: PostHog row shape
            (row: any): PosthogEvent => ({
              uuid: String(row[0]),
              event: row[1] as string,
              distinct_id: (row[2] ?? null) as string | null,
              timestamp: row[3] as string,
              properties: typeof row[4] === 'string' ? JSON.parse(row[4]) : (row[4] ?? {}),
            }),
          )

          // Upsert each page into the log in sub-batches. Unique key on
          // `posthog_uuid` means redelivered events are silently skipped.
          for (let i = 0; i < batch.length; i += LOG_INSERT_BATCH) {
            const chunk = batch.slice(i, i + LOG_INSERT_BATCH)
            const placeholders: string[] = []
            const params: unknown[] = []
            for (let j = 0; j < chunk.length; j += 1) {
              const p = j * 5
              placeholders.push(`($${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}::jsonb)`)
              const evt = chunk[j]
              params.push(evt.uuid, evt.event, evt.distinct_id, evt.timestamp, JSON.stringify(evt.properties))
            }
            const rows = await db.raw<{ inserted: number }>(
              `INSERT INTO posthog_event_log (posthog_uuid, event_name, distinct_id, event_timestamp, properties)
               VALUES ${placeholders.join(', ')}
               ON CONFLICT (posthog_uuid) DO NOTHING
               RETURNING posthog_uuid`,
              params,
            )
            newlyInserted += rows.length
          }

          page += 1
          offset += batch.length

          ctx.progress?.(newlyInserted, newEventsInPosthog, `Synced ${newlyInserted}/${newEventsInPosthog} new events`)

          if (batch.length < POSTHOG_PAGE_SIZE) break
        }

        // Final total = rows currently in the log (what step 2 will replay).
        const totalRows = await db.raw<{ total: string }>('SELECT COUNT(*)::text AS total FROM posthog_event_log')
        const total = Number(totalRows[0]?.total ?? 0)

        log.info(`[rebuildCarts] Sync done — ${newlyInserted} new event(s) across ${page} page(s), log total=${total}`)

        return { total, newlyInserted }
      },
      compensate: async () => {
        // Log writes are idempotent — leaving a partially-synced log on
        // cancel is safe; the next run resumes from the new max timestamp.
      },
    })

    // ── Step 2: replay-events — in-memory fold + bulk UPSERT ───────
    //
    // Why bulk: on serverless (Vercel ↔ Neon) per-event SQL is dominated by
    // ~80ms network roundtrips. 3–4k events × 3 queries/event = 1000s, busts
    // every timeout. Folding all events in memory first, then emitting ONE
    // INSERT per ~100 carts, cuts the real work to a handful of seconds and
    // keeps us well inside a single lambda invocation.
    //
    // Correctness: we replicate the exact merge semantics of
    // `src/modules/cart-tracking/apply-event.ts` (wipe + fold in timestamp
    // order, skip signal-free carts on first event, keep earliest non-null
    // identity fields, take latest `cart_has_payload` snapshot, highest
    // stage never decreases, status=completed only on checkout:completed).
    // Kept inline so the subscriber's per-event path stays untouched.
    const replayEvents = step.action('replay-events', {
      invoke: async (
        input: { total: number; newlyInserted: number },
        ctx,
      ): Promise<{
        rebuilt: number
        skipped: number
        errors: number
        identities_recovered: number
      }> => {
        const db = ctx.app.resolve('IDatabasePort') as RawDb | undefined
        if (!db) throw new MantaError('UNEXPECTED_STATE', 'No database')

        ctx.progress?.(0, input.total, 'Resolving PostHog person identities...')
        const emailMap = await resolveEmailsBatch()
        log.info(`[rebuildCarts] Identity map: ${emailMap.size} distinct_id → email pairs from PostHog`)

        // Stream the log in keyset-paged chunks rather than one big SELECT.
        // A single 33 MB result over Neon's TCP pooler from a Vercel lambda
        // reliably hangs (observed 4+ minutes, lambda dies before completion)
        // whereas chunked SELECTs of 500 rows return in ~200 ms each and
        // transfer the same total volume without choking the pooler. Fold
        // happens incrementally so memory stays bounded to O(unique carts).
        ctx.progress?.(0, input.total, `Loading events from log...`)
        const carts = new Map<string, CartAccumulator>()
        const tokenByDistinctId = new Map<string, string>()
        let skipped = 0
        let errors = 0
        let identitiesRecovered = 0
        let done = 0
        let lastTs: string | null = null
        let lastUuid: string | null = null

        while (true) {
          const params: unknown[] = [LOG_READ_BATCH]
          let where = ''
          if (lastTs !== null && lastUuid !== null) {
            where = ' WHERE (event_timestamp, posthog_uuid) > ($2::timestamptz, $3)'
            params.push(lastTs, lastUuid)
          }
          const page = await db.raw<{
            posthog_uuid: string
            event_name: string
            distinct_id: string | null
            event_timestamp: Date
            properties: Record<string, unknown> | string
          }>(
            `SELECT posthog_uuid, event_name, distinct_id, event_timestamp, properties
               FROM posthog_event_log${where}
              ORDER BY event_timestamp ASC, posthog_uuid ASC
              LIMIT $1`,
            params,
          )
          if (page.length === 0) break

          for (const row of page) {
            // Track cursor for the next page.
            lastTs =
              row.event_timestamp instanceof Date ? row.event_timestamp.toISOString() : String(row.event_timestamp)
            lastUuid = row.posthog_uuid
            // postgres.js with `prepare: false` returns JSONB as raw string.
            const parsedProps =
              typeof row.properties === 'string'
                ? (JSON.parse(row.properties) as Record<string, unknown>)
                : ((row.properties ?? {}) as Record<string, unknown>)
            const evt: PosthogEvent = {
              uuid: row.posthog_uuid,
              event: row.event_name,
              distinct_id: row.distinct_id,
              timestamp:
                row.event_timestamp instanceof Date ? row.event_timestamp.toISOString() : String(row.event_timestamp),
              properties: parsedProps,
            }
            if (enrichEventWithEmail(evt, emailMap)) identitiesRecovered += 1
            try {
              const outcome = foldCartEvent(evt, carts, tokenByDistinctId)
              if (outcome === 'skipped') skipped += 1
            } catch (err) {
              if (errors < 10) log.warn(`[rebuildCarts] fold error on ${evt.event}: ${(err as Error).message}`)
              errors += 1
            }
            done += 1
            if (done % 500 === 0) ctx.progress?.(done, input.total, `Folded ${done}/${input.total}`)
          }
        }
        log.info(
          `[rebuildCarts] Fold done — carts=${carts.size} skipped=${skipped} errors=${errors} identities_recovered=${identitiesRecovered}`,
        )

        // Wipe + bulk insert. Order: wipe FIRST so a partial crash leaves an
        // empty snapshot (admin shows zero carts, clear signal) rather than a
        // stale half-populated one.
        await db.raw('DELETE FROM cart_events')
        await db.raw('DELETE FROM carts')
        log.info('[rebuildCarts] Snapshot tables wiped')

        const cartArray = Array.from(carts.values())
        const BULK_CHUNK = 100
        let inserted = 0
        for (let i = 0; i < cartArray.length; i += BULK_CHUNK) {
          const chunk = cartArray.slice(i, i + BULK_CHUNK)
          await bulkInsertCarts(db, chunk)
          inserted += chunk.length
          ctx.progress?.(inserted, cartArray.length, `Wrote ${inserted}/${cartArray.length} carts`)
        }
        log.info(`[rebuildCarts] Inserted ${inserted} carts in ${Math.ceil(cartArray.length / BULK_CHUNK)} batches`)

        return { rebuilt: cartArray.length, skipped, errors, identities_recovered: identitiesRecovered }
      },
      compensate: async (output) => {
        // Destructive by design — cannot roll back wiped + rebuilt carts (WP-F13).
        // We surface a structured warn so operators see the cart tables are in an
        // intermediate state after a cancelled/failed rebuild. No automatic repair
        // is possible — the only remedy is to re-run the workflow.
        log.warn(
          'Workflow cancelled after destructive operation — cart tables are in an intermediate state and require manual inspection or a full re-run',
          {
            step: 'replay-events',
            command: 'rebuildCarts',
            nonReversible: true,
            rebuilt: output.rebuilt,
            skipped: output.skipped,
            errors: output.errors,
          },
        )
      },
    })

    // ── Step 3: persist-stats — single summary SELECT ──────────────
    const persistStats = step.action('persist-stats', {
      invoke: async (
        input: { rebuilt: number; skipped: number; errors: number; identities_recovered: number },
        _ctx,
      ): Promise<{ rebuilt: number; skipped: number; errors: number; identities_recovered: number }> => {
        // Summary is derived from step 2's output — we simply forward it.
        // A separate step exists to match the plan's structure (fetch/replay/persist)
        // and give the UI a clear "finalisation" checkpoint.
        log.info(
          `[rebuildCarts] Done — rebuilt: ${input.rebuilt}, skipped: ${input.skipped}, errors: ${input.errors}, identities_recovered: ${input.identities_recovered}`,
        )
        return input
      },
      compensate: async () => {
        // No side-effects.
      },
    })

    // Orchestrate the 3 steps.
    const { total, newlyInserted } = await fetchEvents({})
    const replayResult = await replayEvents({ total, newlyInserted })
    const result = await persistStats(replayResult)
    return result
  },
})

// ─── Bulk replay helpers ────────────────────────────────────────────────
//
// In-memory fold + bulk UPSERT for the rebuildCarts replay step. Mirrors
// apply-event.ts semantics but avoids per-event SQL roundtrips.

interface CartAccumulator {
  cart_token: string
  distinct_id: string | null
  email: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  city: string | null
  country_code: string | null
  shopify_customer_id: string | null
  items: unknown[]
  total_price: number
  item_count: number
  currency: string
  last_action: string
  last_action_at: string
  highest_stage: (typeof STAGES)[number]
  status: string
  checkout_token: string | null
  shopify_order_id: string | null
  is_first_order: boolean | null
  shipping_method: string | null
  shipping_price: number | null
  discounts_amount: number | null
  subtotal_price: number | null
  total_tax: number | null
}

function actionToStage(action: string): (typeof STAGES)[number] {
  if (action.startsWith('cart:')) return 'cart'
  if (action === 'checkout:started') return 'checkout_started'
  if (action === 'checkout:payment_info_submitted') return 'payment_attempted'
  if (action === 'checkout:completed') return 'completed'
  return 'checkout_engaged'
}

function firstNonNull<T>(existing: T | null | undefined, incoming: T | null | undefined): T | null {
  if (existing !== null && existing !== undefined) return existing
  if (incoming !== null && incoming !== undefined) return incoming
  return null
}

/**
 * Fold one event into the cart accumulator Map. Returns 'skipped' when the
 * event carries no cart token / is spam / would have created a fresh
 * signal-free cart. Throws on unexpected shapes so the caller can count
 * errors and keep going.
 *
 * Correctness mirrors apply-event.ts:
 *  - cart_token match first; distinct_id fallback used only to REDIRECT a
 *    new cart_token to an existing accumulator (Shopify v1 quirk where
 *    checkout:* uses checkout_token as cart_token).
 *  - highest_stage is monotonic.
 *  - status becomes 'completed' only on checkout:completed.
 *  - items/total_price/currency/item_count from events with cart_has_payload
 *    overwrite; other events preserve the previous snapshot.
 *  - Identity fields (email, first_name, etc.) use first-seen non-null.
 */
function foldCartEvent(
  evt: PosthogEvent,
  carts: Map<string, CartAccumulator>,
  tokenByDistinctId: Map<string, string>,
): 'folded' | 'skipped' {
  const n = normalizeCartEvent(evt)
  if (!n) return 'skipped'
  if (n.email && SPAM_EMAIL_RE.test(n.email)) return 'skipped'

  // Canonical token resolution — redirect to the existing accumulator via
  // distinct_id if the incoming cart_token doesn't match any known cart yet.
  let token = n.cart_token
  if (!carts.has(token) && n.distinct_id) {
    const canonical = tokenByDistinctId.get(n.distinct_id)
    if (canonical && carts.has(canonical)) token = canonical
  }

  const existing = carts.get(token)
  const newStage = actionToStage(n.event)

  if (!existing) {
    // First event for this token — require a purchase signal to avoid
    // polluting the carts table with cart:viewed on empty pages.
    const hasSignal = n.cart_has_payload && (n.items.length > 0 || n.total_price > 0)
    if (!hasSignal) return 'skipped'
    const acc: CartAccumulator = {
      cart_token: token,
      distinct_id: n.distinct_id ?? null,
      email: n.email ?? null,
      first_name: n.first_name ?? null,
      last_name: n.last_name ?? null,
      phone: n.phone ?? null,
      city: n.city ?? null,
      country_code: n.country_code ?? null,
      shopify_customer_id: n.shopify_customer_id ?? null,
      items: n.cart_has_payload ? n.items : [],
      total_price: n.cart_has_payload ? n.total_price : 0,
      item_count: n.cart_has_payload ? n.item_count : 0,
      currency: n.cart_has_payload ? n.currency : 'EUR',
      last_action: n.event,
      last_action_at: n.occurred_at,
      highest_stage: newStage,
      status: n.event === 'checkout:completed' ? 'completed' : 'active',
      checkout_token: n.checkout_token ?? null,
      shopify_order_id: n.shopify_order_id ?? null,
      is_first_order: n.is_first_order ?? null,
      shipping_method: n.shipping_method ?? null,
      shipping_price: n.shipping_price ?? null,
      discounts_amount: n.discounts_amount ?? null,
      subtotal_price: n.subtotal_price ?? null,
      total_tax: n.total_tax ?? null,
    }
    carts.set(token, acc)
    if (n.distinct_id) tokenByDistinctId.set(n.distinct_id, token)
    return 'folded'
  }

  // Monotonic stage
  const curIdx = STAGES.indexOf(existing.highest_stage)
  const newIdx = STAGES.indexOf(newStage)
  if (newIdx > curIdx) existing.highest_stage = newStage

  // Completed sticks; otherwise keep whatever status we already had
  if (n.event === 'checkout:completed') existing.status = 'completed'

  // Identity — first-seen wins so later "anonymous" events don't clobber
  // values we already collected.
  existing.distinct_id = firstNonNull(existing.distinct_id, n.distinct_id)
  existing.email = firstNonNull(existing.email, n.email)
  existing.first_name = firstNonNull(existing.first_name, n.first_name)
  existing.last_name = firstNonNull(existing.last_name, n.last_name)
  existing.phone = firstNonNull(existing.phone, n.phone)
  existing.city = firstNonNull(existing.city, n.city)
  existing.country_code = firstNonNull(existing.country_code, n.country_code)
  existing.shopify_customer_id = firstNonNull(existing.shopify_customer_id, n.shopify_customer_id)

  // Cart state — only events that carry a payload overwrite totals/items.
  if (n.cart_has_payload) {
    existing.items = n.items
    existing.total_price = n.total_price
    existing.item_count = n.item_count
    existing.currency = n.currency
  }

  // Checkout details — first-seen non-null wins (same reasoning as identity)
  existing.checkout_token = firstNonNull(existing.checkout_token, n.checkout_token)
  existing.shopify_order_id = firstNonNull(existing.shopify_order_id, n.shopify_order_id)
  existing.is_first_order = firstNonNull(existing.is_first_order, n.is_first_order)
  existing.shipping_method = firstNonNull(existing.shipping_method, n.shipping_method)
  existing.shipping_price = firstNonNull(existing.shipping_price, n.shipping_price)
  existing.discounts_amount = firstNonNull(existing.discounts_amount, n.discounts_amount)
  existing.subtotal_price = firstNonNull(existing.subtotal_price, n.subtotal_price)
  existing.total_tax = firstNonNull(existing.total_tax, n.total_tax)

  // Last action always the most recent event seen (events arrive in ts order)
  existing.last_action = n.event
  existing.last_action_at = n.occurred_at

  // Register distinct_id → token mapping so future events with a new token
  // but same distinct_id (v1 legacy) route back here.
  if (n.distinct_id && !tokenByDistinctId.has(n.distinct_id)) {
    tokenByDistinctId.set(n.distinct_id, token)
  }

  return 'folded'
}

const CART_COLUMNS = [
  'cart_token',
  'distinct_id',
  'email',
  'first_name',
  'last_name',
  'phone',
  'city',
  'country_code',
  'shopify_customer_id',
  'items',
  'total_price',
  'item_count',
  'currency',
  'last_action',
  'last_action_at',
  'highest_stage',
  'status',
  'checkout_token',
  'shopify_order_id',
  'is_first_order',
  'shipping_method',
  'shipping_price',
  'discounts_amount',
  'subtotal_price',
  'total_tax',
] as const

/**
 * Single multi-row INSERT: `INSERT INTO carts (id, ...) VALUES
 * (gen_random_uuid(), $1, $2, ..., $N::jsonb, ...), (..., ...), ...`.
 * `items` is jsonb, everything else is plain scalar. `created_at` and
 * `updated_at` default to NOW() via the table schema.
 */
async function bulkInsertCarts(db: RawDb, carts: CartAccumulator[]): Promise<void> {
  if (carts.length === 0) return
  const valuesPerRow = CART_COLUMNS.length // 25 scalars per row
  const placeholders: string[] = []
  const params: unknown[] = []
  for (let row = 0; row < carts.length; row += 1) {
    const base = row * valuesPerRow
    const slots: string[] = []
    for (let col = 0; col < valuesPerRow; col += 1) {
      const idx = base + col + 1
      // items column → jsonb; everything else plain
      slots.push(CART_COLUMNS[col] === 'items' ? `$${idx}::jsonb` : `$${idx}`)
    }
    placeholders.push(`(gen_random_uuid(), ${slots.join(', ')}, NOW(), NOW())`)
    const c = carts[row]
    params.push(
      c.cart_token,
      c.distinct_id,
      c.email,
      c.first_name,
      c.last_name,
      c.phone,
      c.city,
      c.country_code,
      c.shopify_customer_id,
      JSON.stringify(c.items ?? []),
      c.total_price ?? 0,
      c.item_count ?? 0,
      c.currency ?? 'EUR',
      c.last_action,
      c.last_action_at,
      c.highest_stage,
      c.status,
      c.checkout_token,
      c.shopify_order_id,
      c.is_first_order,
      c.shipping_method,
      c.shipping_price,
      c.discounts_amount,
      c.subtotal_price,
      c.total_tax,
    )
  }
  // ON CONFLICT: between the WIPE and the bulk INSERT the live
  // posthog-cart-tracker subscriber may have written a fresh cart row for a
  // cart_token that's also in our fold. Our fold reflects the full event
  // history up to the log sync point and is authoritative for the rebuild —
  // overwrite. The `carts_cart_token_key` unique index on cart_token is the
  // conflict target.
  const updateSet = CART_COLUMNS.filter((c) => c !== 'cart_token')
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(', ')
  const sql = `INSERT INTO carts (id, ${CART_COLUMNS.join(', ')}, created_at, updated_at) VALUES ${placeholders.join(', ')} ON CONFLICT (cart_token) DO UPDATE SET ${updateSet}, updated_at = NOW()`
  await db.raw(sql, params)
}
