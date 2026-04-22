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

import { enrichEventWithEmail, resolveEmailsBatch } from '../../modules/cart-tracking/identity-resolver'
import { type NormalizedCartEvent, normalizeCartEvent } from '../../modules/cart-tracking/posthog-adapter'

const STAGES = ['cart', 'checkout_started', 'checkout_engaged', 'payment_attempted', 'completed'] as const

const SPAM_EMAIL_RE = /storebotmail|joonix\.net|mailinator|guerrillamail/i

function actionToStage(action: string): (typeof STAGES)[number] {
  if (action.startsWith('cart:')) return 'cart'
  if (action === 'checkout:started') return 'checkout_started'
  if (action === 'checkout:payment_info_submitted') return 'payment_attempted'
  if (action === 'checkout:completed') return 'completed'
  return 'checkout_engaged'
}

interface PosthogEvent {
  uuid: string
  event: string
  distinct_id: string | null
  timestamp: string
  // biome-ignore lint/suspicious/noExplicitAny: PostHog event properties are free-form JSON
  properties: Record<string, any>
}

type RawDb = { raw: <T>(sql: string, params?: unknown[]) => Promise<T[]> }

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

    // ── Step 2: replay-events — apply events to carts table ────────
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

        // Identity recovery — single HogQL query returning every known
        // distinct_id → person.properties.email pair for cart/checkout events.
        // PostHog's person_id_override_properties_on_events is best-effort; a
        // substantial fraction of cart events land with an empty $set but a
        // resolvable Person. We backfill here so the snapshot has the owner.
        ctx.progress?.(0, input.total, 'Resolving PostHog person identities...')
        const emailMap = await resolveEmailsBatch()
        log.info(`[rebuildCarts] Identity map: ${emailMap.size} distinct_id → email pairs from PostHog`)

        // Wipe cart snapshot tables. The durable event log is the source of
        // truth — this just tears down the derived view so we can rebuild it.
        await db.raw('DELETE FROM cart_events')
        await db.raw('DELETE FROM carts')
        log.info('[rebuildCarts] Snapshot tables wiped')

        let rebuilt = 0
        let skipped = 0
        let errors = 0
        let identitiesRecovered = 0
        let done = 0

        // Keyset-paginate through the entire event log in timestamp order.
        // `event_timestamp` is indexed; posthog_uuid is the tiebreaker.
        let lastTs: string | null = null
        let lastUuid: string | null = null
        while (true) {
          if (ctx.signal?.aborted) {
            throw new MantaError('CONFLICT', 'Cancelled during replay', { code: 'WORKFLOW_CANCELLED' })
          }
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
            properties: Record<string, unknown>
          }>(
            `SELECT posthog_uuid, event_name, distinct_id, event_timestamp, properties
               FROM posthog_event_log${where}
              ORDER BY event_timestamp ASC, posthog_uuid ASC
              LIMIT $1`,
            params,
          )
          if (page.length === 0) break

          for (const row of page) {
            const evt: PosthogEvent = {
              uuid: row.posthog_uuid,
              event: row.event_name,
              distinct_id: row.distinct_id,
              timestamp:
                row.event_timestamp instanceof Date ? row.event_timestamp.toISOString() : String(row.event_timestamp),
              properties: row.properties ?? {},
            }
            if (enrichEventWithEmail(evt, emailMap)) identitiesRecovered += 1
            const outcome = await applyEvent(db, evt, log, errors)
            if (outcome === 'rebuilt') rebuilt += 1
            else if (outcome === 'skipped') skipped += 1
            else errors += 1
            lastTs = evt.timestamp
            lastUuid = evt.uuid
            done += 1
          }

          ctx.progress?.(done, input.total, `Replayed ${done}/${input.total} events`)
        }

        log.info(`[rebuildCarts] Enriched ${identitiesRecovered} events with recovered email`)
        return { rebuilt, skipped, errors, identities_recovered: identitiesRecovered }
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

// ─── Helpers ───────────────────────────────────────────────────────────

type ApplyOutcome = 'rebuilt' | 'skipped' | 'error'

async function applyEvent(
  db: RawDb,
  evt: PosthogEvent,
  log: { warn: (msg: string) => void },
  priorErrors: number,
): Promise<ApplyOutcome> {
  const n: NormalizedCartEvent | null = normalizeCartEvent(evt)
  if (!n) return 'skipped'
  if (n.email && SPAM_EMAIL_RE.test(n.email)) return 'skipped'

  // Only events that carry cart state should overwrite snapshot totals.
  // `checkout:*` + `cart:closed` can fire without re-embedding the cart —
  // we preserve the existing snapshot instead of zeroing it out.
  const items = n.cart_has_payload ? JSON.stringify(n.items) : null
  const totalPrice = n.cart_has_payload ? n.total_price : null
  const currency = n.cart_has_payload ? n.currency : null
  const itemCount = n.cart_has_payload ? n.item_count : null
  const newStage = actionToStage(n.event)

  try {
    // Find by cart_token first, then fall back to distinct_id.
    // (In v1 Shopify sent checkout_token as cart_token for checkout:* events;
    // v2 preserves the original cart_token via a cart attribute, so this
    // fallback is mostly defensive now.)
    let existing = await db.raw<{ id: string; highest_stage: string; status: string; [k: string]: unknown }>(
      'SELECT * FROM carts WHERE cart_token = $1 LIMIT 1',
      [n.cart_token],
    )
    if (existing.length === 0 && n.distinct_id) {
      existing = await db.raw<{ id: string; highest_stage: string; status: string; [k: string]: unknown }>(
        'SELECT * FROM carts WHERE distinct_id = $1 LIMIT 1',
        [n.distinct_id],
      )
    }

    const currentStage = (existing[0]?.highest_stage as string) ?? 'cart'
    const stageIdx = Math.max(STAGES.indexOf(currentStage as never), STAGES.indexOf(newStage))
    const highestStage = STAGES[stageIdx] ?? newStage
    const status = n.event === 'checkout:completed' ? 'completed' : ((existing[0]?.status as string) ?? 'active')
    const merge = (next: unknown, prev: unknown) => next ?? prev ?? null

    // Skip inserting a fresh cart row when the FIRST event for this cart_token
    // carries no purchase signal (empty items AND zero/absent total).
    // These are legitimate noise (cart:viewed on an empty cart page).
    const hasPurchaseSignal = n.items.length > 0 || n.total_price > 0
    if (existing.length === 0 && !hasPurchaseSignal) {
      return 'skipped'
    }

    if (existing.length > 0) {
      const ex = existing[0]
      const nextItems = items ?? (ex.items ? JSON.stringify(ex.items) : JSON.stringify([]))
      const nextTotalPrice = totalPrice ?? (ex.total_price as number | null) ?? 0
      const nextItemCount = itemCount ?? (ex.item_count as number | null) ?? 0
      const nextCurrency = currency ?? (ex.currency as string | null) ?? 'EUR'
      await db.raw(
        `UPDATE carts SET distinct_id=$1, email=$2, first_name=$3, last_name=$4, phone=$5, city=$6, country_code=$7, items=$8::jsonb, total_price=$9, item_count=$10, currency=$11, last_action=$12, last_action_at=$13, highest_stage=$14, status=$15, checkout_token=$16, shopify_order_id=$17, shipping_price=$18, discounts_amount=$19, subtotal_price=$20, total_tax=$21, updated_at=$13 WHERE id=$22`,
        [
          merge(n.distinct_id, ex.distinct_id),
          merge(n.email, ex.email),
          merge(n.first_name, ex.first_name),
          merge(n.last_name, ex.last_name),
          merge(n.phone, ex.phone),
          merge(n.city, ex.city),
          merge(n.country_code, ex.country_code),
          nextItems,
          nextTotalPrice,
          nextItemCount,
          nextCurrency,
          n.event,
          n.occurred_at,
          highestStage,
          status,
          merge(n.checkout_token, ex.checkout_token),
          merge(n.shopify_order_id, ex.shopify_order_id),
          n.shipping_price ?? (ex.shipping_price as number | null),
          n.discounts_amount ?? (ex.discounts_amount as number | null),
          n.subtotal_price ?? (ex.subtotal_price as number | null),
          n.total_tax ?? (ex.total_tax as number | null),
          ex.id,
        ],
      )
    } else {
      await db.raw(
        `INSERT INTO carts (id, cart_token, distinct_id, email, first_name, last_name, phone, city, country_code, items, total_price, item_count, currency, last_action, last_action_at, highest_stage, status, checkout_token, shopify_order_id, shipping_price, discounts_amount, subtotal_price, total_tax, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $14, $14)`,
        [
          n.cart_token,
          n.distinct_id,
          n.email,
          n.first_name,
          n.last_name,
          n.phone,
          n.city,
          n.country_code,
          items ?? '[]',
          totalPrice ?? 0,
          itemCount ?? 0,
          currency ?? 'EUR',
          n.event,
          n.occurred_at,
          highestStage,
          status,
          n.checkout_token,
          n.shopify_order_id,
          n.shipping_price,
          n.discounts_amount,
          n.subtotal_price,
          n.total_tax,
        ],
      )
    }
    return 'rebuilt'
  } catch (err) {
    if (priorErrors < 10) log.warn(`[rebuildCarts] ${evt.event}: ${(err as Error).message.substring(0, 100)}`)
    return 'error'
  }
}
