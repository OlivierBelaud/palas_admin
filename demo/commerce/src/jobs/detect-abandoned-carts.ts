// Cron: hourly sweep for abandoned identified carts → Klaviyo relance.
//
// The whole selection + enrichment + send logic lives in the
// `notifyAbandonedCarts` command (see src/commands/admin/notify-abandoned-carts.ts).
// This job is a thin scheduler that dispatches it with the default thresholds:
//   - minIdleHours = 2  (only carts idle for at least 2 hours)
//   - maxAgeDays   = 30 (ignore carts older than 30 days)
//   - batchLimit   = 100
//
// Concurrency is handled by the framework — duplicate invocations are
// skipped via ILockingPort while a previous run is still in flight.
//
// Production-only: the job no-ops outside `NODE_ENV=production` so local
// dev servers don't spam Klaviyo against prod data. To trigger it manually
// (prod or otherwise), call `command.notifyAbandonedCarts({})` from the
// admin dashboard or `manta exec`.

interface NotifyResult {
  notified: number
  skipped: number
  errors: number
  scanned: number
}

const EMPTY: NotifyResult = { notified: 0, skipped: 0, errors: 0, scanned: 0 }

export default defineJob('detect-abandoned-carts', '0 * * * *', async ({ command, log }) => {
  if (process.env.NODE_ENV !== 'production') {
    log.info(`[detect-abandoned-carts] skipped (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}, prod-only)`)
    return EMPTY
  }

  // Command return types are currently generated as `unknown` — cast to the
  // shape declared by notifyAbandonedCarts for structured logging.
  const result = (await command.notifyAbandonedCarts({})) as NotifyResult
  log.info(
    `[detect-abandoned-carts] scanned=${result.scanned} notified=${result.notified} skipped=${result.skipped} errors=${result.errors}`,
  )
  return result
})
