// Cron: every 5 minutes — pull the latest cart/checkout events from
// PostHog and dispatch them through `ingestCartEvent`. Safety net for
// the live `posthog-cart-tracker` subscriber (anything that reaches
// PostHog directly from the storefront still lands in the `carts`
// snapshot).
//
// All the work lives in the `syncPosthogEvents` command — this is a
// thin scheduler so the same command can be run on demand (admin
// dashboard or `manta exec`).
//
// Production-only: in dev/test we no-op so local servers don't run
// HogQL against the prod PostHog account on every reload. Trigger
// manually via `command.syncPosthogEvents({})` when needed.

import type { RawDb } from '../modules/cart-tracking/apply-event'
import { type HogQLEventRow, ingestHogQLRows } from '../modules/cart-tracking/posthog-sync'
import { posthogPrivateKey, runPosthogHogQL } from '../utils/posthog-query'

interface SyncResult {
  fetched: number
  ingested: number
  skipped: number
  errors: number
  duration_ms: number
  cart_since: string | null
  checkout_since: string | null
}

const EMPTY: SyncResult = {
  fetched: 0,
  ingested: 0,
  skipped: 0,
  errors: 0,
  duration_ms: 0,
  cart_since: null,
  checkout_since: null,
}

const MAX_EVENTS_PER_RUN = 5000

export default defineJob('sync-posthog-events', '*/5 * * * *', async ({ command, db, log }) => {
  if (process.env.NODE_ENV !== 'production') {
    log.info(`[sync-posthog-events] skipped (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}, prod-only)`)
    return EMPTY
  }

  const key = posthogPrivateKey()
  const runtimeDb = db as RawDb | undefined
  if (!key || !runtimeDb?.raw) {
    log.error('[sync-posthog-events] DB or POSTHOG_API_KEY missing')
    return { ...EMPTY, errors: 1 }
  }

  const startedAt = Date.now()
  const maxRows = await runtimeDb.raw<{ kind: string; max_ts: Date | null }>(
    `SELECT CASE WHEN last_action LIKE 'cart:%' THEN 'cart' ELSE 'checkout' END AS kind,
            MAX(last_action_at) AS max_ts
       FROM carts
      WHERE last_action LIKE 'cart:%' OR last_action LIKE 'checkout:%'
      GROUP BY 1`,
  )
  const toIso = (ts: Date | null | undefined): string | null =>
    ts ? (ts instanceof Date ? ts.toISOString() : String(ts)) : null
  const cartSinceIso = toIso(maxRows.find((r) => r.kind === 'cart')?.max_ts)
  const checkoutSinceIso = toIso(maxRows.find((r) => r.kind === 'checkout')?.max_ts)
  const cartClause = cartSinceIso
    ? `(event LIKE 'cart:%' AND timestamp > toDateTime('${cartSinceIso}'))`
    : `event LIKE 'cart:%'`
  const checkoutClause = checkoutSinceIso
    ? `(event LIKE 'checkout:%' AND timestamp > toDateTime('${checkoutSinceIso}'))`
    : `event LIKE 'checkout:%'`

  const rows = (await runPosthogHogQL(
    `SELECT uuid, event, distinct_id, timestamp, properties
       FROM events
      WHERE ${cartClause} OR ${checkoutClause}
      ORDER BY timestamp ASC
      LIMIT ${MAX_EVENTS_PER_RUN}`,
    { privateKey: key },
  )) as unknown as HogQLEventRow[]

  const counters = await ingestHogQLRows(rows, {
    ingest: (input) => command.ingestCartEvent(input),
    warn: (msg) => log.warn(`[sync-posthog-events] ${msg}`),
  })

  const result: SyncResult = {
    fetched: rows.length,
    ingested: counters.ingested,
    skipped: counters.skipped,
    errors: counters.errors,
    duration_ms: Date.now() - startedAt,
    cart_since: cartSinceIso,
    checkout_since: checkoutSinceIso,
  }
  log.info(
    `[sync-posthog-events] fetched=${result.fetched} ingested=${result.ingested} skipped=${result.skipped} errors=${result.errors} cartSince=${result.cart_since ?? 'genesis'} checkoutSince=${result.checkout_since ?? 'genesis'} duration_ms=${result.duration_ms}`,
  )
  return result
})
