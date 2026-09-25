import { remapGoogleAdsDispatches } from '../modules/event-hub/ad-dispatch-repair'
import { repairUnpreparedDispatches } from '../modules/event-hub/dispatch-repair'
import { flushDestinationDispatches, type RawDispatchDb } from '../modules/event-hub/dispatch-runner'
import { getGoogleAdsConfig, googleAdsDestinationConnector } from '../modules/event-hub/google-ads-connector'

interface FlushGoogleAdsResult {
  scanned: number
  validated: number
  sent: number
  invalid: number
  retry: number
  error: number
  not_configured: number
  configured: boolean
  validate_only: boolean
}

const EMPTY: FlushGoogleAdsResult = {
  scanned: 0,
  validated: 0,
  sent: 0,
  invalid: 0,
  retry: 0,
  error: 0,
  not_configured: 0,
  configured: false,
  validate_only: false,
}

export default defineJob('flush-google-ads-dispatches', '* * * * *', async ({ db, log }) => {
  if (process.env.NODE_ENV !== 'production') {
    log.info(`[flush-google-ads-dispatches] skipped (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}, prod-only)`)
    return EMPTY
  }

  const runtimeDb = db as RawDispatchDb | undefined
  if (!runtimeDb?.raw) {
    log.error('[flush-google-ads-dispatches] DB missing')
    return { ...EMPTY, error: 1 }
  }

  await repairUnpreparedDispatches(runtimeDb, googleAdsDestinationConnector)
  await remapGoogleAdsDispatches(runtimeDb)
  const result = await flushDestinationDispatches({
    db: runtimeDb,
    connector: googleAdsDestinationConnector,
    batchLimit: 100,
  })
  const config = getGoogleAdsConfig()
  const output: FlushGoogleAdsResult = {
    ...result,
    validate_only: config.validateOnly,
  }
  log.info(
    `[flush-google-ads-dispatches] scanned=${output.scanned} sent=${output.sent} validated=${output.validated} invalid=${output.invalid} retry=${output.retry} error=${output.error} not_configured=${output.not_configured} configured=${output.configured} validate_only=${output.validate_only}`,
  )
  return output
})
