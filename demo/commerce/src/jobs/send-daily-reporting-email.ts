// Cron — daily Palas reporting email.
//
// Vercel cron is UTC-only. 03:00 UTC is 05:00 in Paris during the current
// summer reporting period; the product requirement is "in the night / around
// 5h", so this stays early enough for operations.

import { sendDailyReportEmail } from '../utils/daily-reporting'
import type { RuntimeSql } from '../utils/manta-runtime'

const EMPTY = {
  day: null as string | null,
  sent: 0,
  errors: 0,
}

export default defineJob('send-daily-reporting-email', '0 3 * * *', async ({ db, notification, log }) => {
  if (process.env.NODE_ENV !== 'production') {
    log.info(`[send-daily-reporting-email] skipped (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}, prod-only)`)
    return EMPTY
  }

  const pool = db?.getPool()
  if (!db || typeof pool !== 'function' || !notification) {
    log.error('[send-daily-reporting-email] IDatabasePort or INotificationPort missing')
    return { ...EMPTY, errors: 1 }
  }

  const result = await sendDailyReportEmail({
    sql: pool as RuntimeSql,
    notification,
    log,
  })
  const errors = result.sent.filter((row) => row.status === 'FAILURE').length
  log.info(
    `[send-daily-reporting-email] day=${result.payload.day} status=${result.snapshot_status} sent=${result.sent.length} errors=${errors}`,
  )
  return {
    day: result.payload.day,
    sent: result.sent.length,
    errors,
  }
})
