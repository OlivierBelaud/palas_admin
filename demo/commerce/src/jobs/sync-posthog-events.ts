// Cron: every 5 minutes — pull the latest cart/checkout events from PostHog.
//
// All sync semantics live in `command.syncPosthogEvents`: notably the
// per-class 24h overlap that protects checkout events from being skipped when
// Shopify/webhook writes advance the cart snapshot timestamps. Keep this job
// as a thin scheduler so there is only one cursor policy to reason about.

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

export default defineJob('sync-posthog-events', '*/5 * * * *', async ({ command, db, log }) => {
  if (process.env.NODE_ENV !== 'production') {
    log.info(`[sync-posthog-events] skipped (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}, prod-only)`)
    return EMPTY
  }

  if (!db) {
    log.error('[sync-posthog-events] DB missing')
    return { ...EMPTY, errors: 1 }
  }

  const commands = command as unknown as { syncPosthogEvents(input: Record<string, never>): Promise<SyncResult> }
  const result = await commands.syncPosthogEvents({})
  log.info(
    `[sync-posthog-events] fetched=${result.fetched} ingested=${result.ingested} skipped=${result.skipped} errors=${result.errors} cartSince=${result.cart_since ?? 'genesis'} checkoutSince=${result.checkout_since ?? 'genesis'} duration_ms=${result.duration_ms}`,
  )
  return result
})
