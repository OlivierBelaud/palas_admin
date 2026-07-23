// Frequent recovery worker for already-persisted daily report deliveries.
//
// It deliberately does not rebuild reporting snapshots or recipient content:
// retries replay the immutable payload and provider idempotency key stored by
// the daily reporting job.

import { resumeDailyReportDeliveries } from '../utils/daily-reporting'
import type { RuntimeSql } from '../utils/manta-runtime'

const EMPTY = {
  attempted: 0,
  succeeded: 0,
  errors: 0,
}

export default defineJob('resume-daily-report-deliveries', '*/15 * * * *', async ({ db, notification, log }) => {
  if (process.env.NODE_ENV !== 'production') {
    log.info(
      `[resume-daily-report-deliveries] skipped (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}, prod-only)`,
    )
    return EMPTY
  }

  const pool = db?.getPool()
  if (!db || typeof pool !== 'function' || !notification) {
    log.error('[resume-daily-report-deliveries] IDatabasePort or INotificationPort missing')
    return { ...EMPTY, errors: 1 }
  }

  const result = await resumeDailyReportDeliveries({
    sql: pool as RuntimeSql,
    notification,
    log,
  })
  const succeeded = result.sent.filter((row) => row.delivery_status === 'succeeded').length
  const errors = result.sent.length - succeeded
  log.info(
    `[resume-daily-report-deliveries] attempted=${result.sent.length} succeeded=${succeeded} unresolved=${errors}`,
  )
  return {
    attempted: result.sent.length,
    succeeded,
    errors,
  }
})
