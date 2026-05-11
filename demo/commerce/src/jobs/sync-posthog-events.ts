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

export default defineJob('sync-posthog-events', '*/5 * * * *', async ({ command, log }) => {
  if (process.env.NODE_ENV !== 'production') {
    log.info(`[sync-posthog-events] skipped (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}, prod-only)`)
    return EMPTY
  }

  const result = (await command.syncPosthogEvents({})) as SyncResult
  log.info(
    `[sync-posthog-events] fetched=${result.fetched} ingested=${result.ingested} skipped=${result.skipped} errors=${result.errors} cartSince=${result.cart_since ?? 'genesis'} checkoutSince=${result.checkout_since ?? 'genesis'} duration_ms=${result.duration_ms}`,
  )
  return result
})
