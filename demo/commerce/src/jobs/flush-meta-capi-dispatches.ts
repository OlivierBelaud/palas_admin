import { flushDestinationDispatches, type RawDispatchDb } from '../modules/event-hub/dispatch-runner'
import { metaCapiDestinationConnector } from '../modules/event-hub/meta-capi-connector'

interface FlushMetaCapiResult {
  scanned: number
  sent: number
  invalid: number
  retry: number
  error: number
  not_configured: number
  configured: boolean
}

const EMPTY: FlushMetaCapiResult = {
  scanned: 0,
  sent: 0,
  invalid: 0,
  retry: 0,
  error: 0,
  not_configured: 0,
  configured: false,
}

export default defineJob('flush-meta-capi-dispatches', '* * * * *', async ({ db, log }) => {
  if (process.env.NODE_ENV !== 'production') {
    log.info(`[flush-meta-capi-dispatches] skipped (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}, prod-only)`)
    return EMPTY
  }

  const runtimeDb = db as RawDispatchDb | undefined
  if (!runtimeDb?.raw) {
    log.error('[flush-meta-capi-dispatches] DB missing')
    return { ...EMPTY, error: 1 }
  }

  const result = await flushDestinationDispatches({
    db: runtimeDb,
    connector: metaCapiDestinationConnector,
    batchLimit: 100,
  })
  log.info(
    `[flush-meta-capi-dispatches] scanned=${result.scanned} sent=${result.sent} invalid=${result.invalid} retry=${result.retry} error=${result.error} not_configured=${result.not_configured} configured=${result.configured}`,
  )
  return result
})
