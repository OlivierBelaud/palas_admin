interface FlushGa4Result {
  scanned: number
  sent: number
  invalid: number
  retry: number
  error: number
  not_configured: number
  configured: boolean
}

const EMPTY: FlushGa4Result = {
  scanned: 0,
  sent: 0,
  invalid: 0,
  retry: 0,
  error: 0,
  not_configured: 0,
  configured: false,
}

export default defineJob('flush-ga4-dispatches', '* * * * *', async ({ command, log }) => {
  if (process.env.NODE_ENV !== 'production') {
    log.info(`[flush-ga4-dispatches] skipped (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}, prod-only)`)
    return EMPTY
  }

  const result = (await command.flushGa4Dispatches({ batchLimit: 100 })) as FlushGa4Result
  log.info(
    `[flush-ga4-dispatches] scanned=${result.scanned} sent=${result.sent} invalid=${result.invalid} retry=${result.retry} error=${result.error} not_configured=${result.not_configured} configured=${result.configured}`,
  )
  return result
})
