import { repairUnpreparedDispatches } from '../modules/event-hub/dispatch-repair'
import { flushDestinationDispatches, type RawDispatchDb } from '../modules/event-hub/dispatch-runner'
import { pinterestDestinationConnector } from '../modules/event-hub/pinterest-connector'

interface FlushPinterestResult {
  scanned: number
  validated: number
  sent: number
  invalid: number
  retry: number
  error: number
  not_configured: number
  configured: boolean
}

const EMPTY: FlushPinterestResult = {
  scanned: 0,
  validated: 0,
  sent: 0,
  invalid: 0,
  retry: 0,
  error: 0,
  not_configured: 0,
  configured: false,
}

export default defineJob('flush-pinterest-dispatches', '* * * * *', async ({ db, log }) => {
  if (process.env.NODE_ENV !== 'production') {
    log.info(`[flush-pinterest-dispatches] skipped (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}, prod-only)`)
    return EMPTY
  }

  const runtimeDb = db as RawDispatchDb | undefined
  if (!runtimeDb?.raw) {
    log.error('[flush-pinterest-dispatches] DB missing')
    return { ...EMPTY, error: 1 }
  }

  await repairUnpreparedDispatches(runtimeDb, pinterestDestinationConnector)
  const result = await flushDestinationDispatches({
    db: runtimeDb,
    connector: pinterestDestinationConnector,
    batchLimit: 100,
  })
  log.info(
    `[flush-pinterest-dispatches] scanned=${result.scanned} sent=${result.sent} validated=${result.validated} invalid=${result.invalid} retry=${result.retry} error=${result.error} not_configured=${result.not_configured} configured=${result.configured}`,
  )
  return result
})
