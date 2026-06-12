interface FlushGoogleAdsResult {
  scanned: number
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
  sent: 0,
  invalid: 0,
  retry: 0,
  error: 0,
  not_configured: 0,
  configured: false,
  validate_only: false,
}

export default defineJob('flush-google-ads-dispatches', '* * * * *', async ({ command, log }) => {
  if (process.env.NODE_ENV !== 'production') {
    log.info(`[flush-google-ads-dispatches] skipped (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}, prod-only)`)
    return EMPTY
  }

  const result = (await (
    command as typeof command & {
      flushGoogleAdsDispatches(input: { batchLimit: number }): Promise<unknown>
    }
  ).flushGoogleAdsDispatches({ batchLimit: 100 })) as FlushGoogleAdsResult
  log.info(
    `[flush-google-ads-dispatches] scanned=${result.scanned} sent=${result.sent} invalid=${result.invalid} retry=${result.retry} error=${result.error} not_configured=${result.not_configured} configured=${result.configured} validate_only=${result.validate_only}`,
  )
  return result
})
