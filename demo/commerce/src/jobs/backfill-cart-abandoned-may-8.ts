// One-off backfill: drain abandoned carts from May 8th 2026 (testing the
// Resend pipeline at small scale before extending to the full backlog).
//
// Schedule: every minute, 04:00–07:59 UTC (= 06:00–09:59 Europe/Paris in CEST).
// Each tick sends at most 1 email so we throttle gently for sender reputation.
//
// Behaviour:
//   - forDate: '2026-05-08' → window restricted to that calendar day in Paris
//   - batchLimit: 1         → 1 email per tick max
//   - klaviyoRecentHours: 12 → still skip carts that received a Klaviyo
//     abandonment-flow email in the last 12h (don't double the customer)
//   - Hard cap (count<1) inherited from the command — no cart is ever
//     emailed twice.
//
// Auto-no-op: when no eligible carts remain on May 8th, the command returns
// scanned=0 and the job logs a single line. Safe to leave the cron in place
// for a few days then remove from vercel.json.
//
// Production-only guard (same as detect-abandoned-carts) so local dev runs
// don't accidentally hit prod data.

interface NotifyResult {
  scanned: number
  notified: number
  skipped: number
  errors: number
  skipped_optout?: number
  skipped_klaviyo_recent?: number
}

const EMPTY: NotifyResult = { scanned: 0, notified: 0, skipped: 0, errors: 0 }

export default defineJob('backfill-cart-abandoned-may-8', '* 4-7 * * *', async ({ command, log }) => {
  if (process.env.NODE_ENV !== 'production') {
    log.info(`[backfill-may-8] skipped (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}, prod-only)`)
    return EMPTY
  }

  const result = (await command.notifyAbandonedCarts({
    forDate: '2026-05-08',
    batchLimit: 1,
    klaviyoRecentHours: 12,
    // minIdle/maxAge are ignored when forDate is set, but we still pass
    // sensible numbers to satisfy the schema.
    minIdleHours: 1,
    maxAgeHours: 720,
  })) as NotifyResult

  log.info(
    `[backfill-may-8] scanned=${result.scanned} notified=${result.notified} skipped=${result.skipped} errors=${result.errors} skipped_klaviyo_recent=${result.skipped_klaviyo_recent ?? 0}`,
  )
  return result
})
