// Cron — hourly pull of Klaviyo abandonment events from PostHog DW into the
// local `klaviyo_events` table. The abandoned-carts admin query joins this
// table instead of running a synchronous HogQL — same data, no DW round-trip.

interface SyncResult {
  scanned: number
  inserted: number
  skipped: number
  carts_marked_klaviyo: number
  profiles_scanned?: number
  profiles_updated?: number
  profiles_has_more?: boolean
}

const EMPTY: SyncResult = { scanned: 0, inserted: 0, skipped: 0, carts_marked_klaviyo: 0 }

export default defineJob('sync-klaviyo-events', '20 * * * *', async ({ command, log }) => {
  if (process.env.NODE_ENV !== 'production') {
    log.info(`[sync-klaviyo-events] skipped (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}, prod-only)`)
    return EMPTY
  }
  const commands = command as unknown as { syncKlaviyoEvents(input: Record<string, never>): Promise<SyncResult> }
  const result = await commands.syncKlaviyoEvents({})
  log.info(
    `[sync-klaviyo-events] scanned=${result.scanned} inserted=${result.inserted} skipped=${result.skipped} carts_marked_klaviyo=${result.carts_marked_klaviyo} profiles_scanned=${result.profiles_scanned ?? 0} profiles_updated=${result.profiles_updated ?? 0} profiles_has_more=${result.profiles_has_more ?? false}`,
  )
  return result
})
