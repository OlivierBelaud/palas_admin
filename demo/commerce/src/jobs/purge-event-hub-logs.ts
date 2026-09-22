import type { RawDispatchDb } from '../modules/event-hub/dispatch-runner'
import { compactTrackingHistory } from '../modules/event-hub/retention'

// Bound every pass; preserve pending work and compact deduplication receipts.
// Scheduling is unchanged. Old history drains gradually without a bulk delete.
export default defineJob('purge-event-hub-logs', '0 */4 * * *', async ({ db, log }) => {
  const runtimeDb = db as RawDispatchDb | undefined
  if (!runtimeDb?.raw) {
    log.error('[purge-event-hub-logs] IDatabasePort missing')
    return { deleted: 0, error: 'DB_UNAVAILABLE' }
  }
  const result = { events_compacted: 0, dispatches_compacted: 0, workflows_deleted: 0 }
  const deadline = Date.now() + 10_000
  for (let batch = 0; batch < 50 && Date.now() < deadline; batch += 1) {
    const current = await compactTrackingHistory(runtimeDb)
    result.events_compacted += current.events_compacted
    result.dispatches_compacted += current.dispatches_compacted
    result.workflows_deleted += current.workflows_deleted
    if (current.events_compacted + current.dispatches_compacted + current.workflows_deleted === 0) break
  }
  log.info(`[purge-event-hub-logs] ${JSON.stringify(result)}`)
  return result
})
