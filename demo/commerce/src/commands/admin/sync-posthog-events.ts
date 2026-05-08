// Command: continuous PostHog -> carts sync (5-min cron).
//
// The store-front emits `cart:*` and `checkout:*` events to PostHog. The
// posthog-cart-tracker subscriber catches what flows through our proxy
// in real time, but anything that goes directly from the storefront to
// PostHog (or any event we lose to a redeploy / Klaviyo throttle / etc.)
// is rescued by this loop.
//
// Strategy:
//   1. Read MAX(occurred_at) from `cart_events` — that's the high-water
//      mark of what we've already ingested.
//   2. HogQL: pull every `cart:*` / `checkout:*` event with timestamp
//      strictly greater than that mark, ordered ASC, capped at 5 000
//      events / run.
//   3. Normalise each event via the shared `posthog-sync` helper and
//      dispatch through `step.command.ingestCartEvent`. Errors are
//      counted, not thrown, so one bad event doesn't block the rest.
//
// Idempotence: ingestCartEvent is itself idempotent on the cart row
// (upsert by token + distinct_id fallback), and `cart_events` is
// append-only. If two cron ticks overlap on the same boundary timestamp
// we may write a duplicate cart_event — accepted trade-off for v1; the
// cart-row state remains correct because ingestCartEvent merges
// monotonically.

import type { RawDb } from '../../modules/cart-tracking/apply-event'
import { type HogQLEventRow, ingestHogQLRows } from '../../modules/cart-tracking/posthog-sync'

const MAX_EVENTS_PER_RUN = 5000

export default defineCommand({
  name: 'syncPosthogEvents',
  description: 'Pull recent cart/checkout events from PostHog and dispatch ingestCartEvent for each',
  input: z.object({}),
  workflow: async (_input, { step, log }) => {
    const host = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
    const key = process.env.POSTHOG_API_KEY
    if (!key) {
      throw new MantaError('INVALID_STATE', 'POSTHOG_API_KEY is required for syncPosthogEvents')
    }

    return await step.action('sync-posthog-events', {
      invoke: async (_i: unknown, ctx) => {
        const db = ctx.app.infra.db as RawDb | undefined
        if (!db) throw new MantaError('UNEXPECTED_STATE', 'No database configured')

        const startedAt = Date.now()

        // ── 1. Resolve the high-water mark ────────────────────────────
        const maxRows = await db.raw<{ max_ts: Date | null }>('SELECT MAX(occurred_at) AS max_ts FROM cart_events')
        const sinceTs = maxRows[0]?.max_ts
        const sinceIso = sinceTs ? (sinceTs instanceof Date ? sinceTs.toISOString() : String(sinceTs)) : null
        const sinceFilter = sinceIso ? ` AND timestamp > toDateTime('${sinceIso}')` : ''

        log.info(`[syncPosthogEvents] starting — since=${sinceIso ?? 'genesis'}`)

        // ── 2. HogQL query ────────────────────────────────────────────
        const hogql = `SELECT uuid, event, distinct_id, timestamp, properties
                         FROM events
                        WHERE (event LIKE 'cart:%' OR event LIKE 'checkout:%')${sinceFilter}
                        ORDER BY timestamp ASC
                        LIMIT ${MAX_EVENTS_PER_RUN}`

        const res = await fetch(`${host}/api/projects/@current/query/`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: { kind: 'HogQLQuery', query: hogql } }),
          signal: ctx.signal,
        })
        if (!res.ok) {
          throw new MantaError('UNEXPECTED_STATE', `PostHog HogQL ${res.status} ${await res.text().catch(() => '')}`)
        }
        const data = (await res.json()) as { results?: unknown[][] }
        // PostHog returns each row as `[uuid, event, distinct_id, timestamp, properties]`.
        // The HogQL query above selects exactly those 5 columns so the tuple shape is
        // guaranteed at runtime — go through `unknown` to satisfy the strict tuple type.
        const rows = (data.results ?? []) as unknown as HogQLEventRow[]

        log.info(`[syncPosthogEvents] HogQL returned ${rows.length} event(s)`)

        // ── 3. Dispatch each event through ingestCartEvent ────────────
        const counters = await ingestHogQLRows(rows, {
          ingest: (input) => step.command.ingestCartEvent(input),
          warn: (msg) => log.warn(`[syncPosthogEvents] ${msg}`),
          shouldStop: () => ctx.signal?.aborted ?? false,
        })

        // Translate "stopped early because of cancel" into the canonical
        // MantaError the workflow runner expects. We detect cancellation
        // from `ctx.signal.aborted` (the ingestHogQLRows helper itself
        // never throws — it stops the loop and returns partial counters).
        if (ctx.signal?.aborted) {
          throw new MantaError('CONFLICT', 'syncPosthogEvents cancelled', { code: 'WORKFLOW_CANCELLED' })
        }

        const durationMs = Date.now() - startedAt
        log.info(
          `[syncPosthogEvents] done — fetched=${rows.length} ingested=${counters.ingested} skipped=${counters.skipped} errors=${counters.errors} duration_ms=${durationMs}`,
        )

        return {
          fetched: rows.length,
          ingested: counters.ingested,
          skipped: counters.skipped,
          errors: counters.errors,
          duration_ms: durationMs,
          since: sinceIso,
        }
      },
      compensate: async () => {
        // ingestCartEvent is idempotent at the cart row level; cart_events is
        // append-only. The cron is a safety net so partial progress is fine —
        // the next tick resumes from the new MAX(occurred_at).
      },
    })
  },
})
