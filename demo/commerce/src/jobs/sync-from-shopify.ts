// Cron — hourly Shopify Admin → local DB sync (contacts + orders).
//
// Runs at :45 of every hour (offset from the other syncs to spread load
// across the hour). Pulls everything updated since the last successful
// run via `syncContactsFromShopify`.
//
// Production-only: in dev/test we no-op so local servers don't hammer
// the prod Shopify Admin endpoint. Trigger manually via
// `command.syncContactsFromShopify({})` when needed.

interface SyncResult {
  contacts: number
  orders: number
  duration_ms: number
  since: string | null
}

const EMPTY: SyncResult = { contacts: 0, orders: 0, duration_ms: 0, since: null }

export default defineJob('sync-from-shopify', '45 * * * *', async ({ command, log }) => {
  if (process.env.NODE_ENV !== 'production') {
    log.info(`[sync-from-shopify] skipped (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}, prod-only)`)
    return EMPTY
  }
  const result = (await command.syncContactsFromShopify({})) as SyncResult
  log.info(
    `[sync-from-shopify] contacts=${result.contacts} orders=${result.orders} since=${result.since ?? 'genesis'} duration_ms=${result.duration_ms}`,
  )
  return result
})
