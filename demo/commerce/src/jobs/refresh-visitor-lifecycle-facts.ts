// Cron: every 5 minutes — keep the lifecycle dashboard fact cache fresh.
//
// We rebuild a rolling 35-day window because late PostHog/shopify attribution
// can update recent visitor_sessions after the original browsing day. Older
// ranges can be rebuilt manually with `refreshVisitorLifecycleFacts`.

interface RefreshLifecycleFactsResult {
  from: string
  to: string
  days: number
  sessions: number
  facts: number
  duration_ms: number
}

const EMPTY: RefreshLifecycleFactsResult = {
  from: '',
  to: '',
  days: 0,
  sessions: 0,
  facts: 0,
  duration_ms: 0,
}

export default defineJob('refresh-visitor-lifecycle-facts', '*/5 * * * *', async ({ command, log }) => {
  if (process.env.NODE_ENV !== 'production') {
    log.info(`[refresh-visitor-lifecycle-facts] skipped (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}, prod-only)`)
    return EMPTY
  }

  const result = (await (
    command as unknown as { refreshVisitorLifecycleFacts: (input: unknown) => Promise<unknown> }
  ).refreshVisitorLifecycleFacts({ days: 35 })) as RefreshLifecycleFactsResult
  log.info(
    `[refresh-visitor-lifecycle-facts] from=${result.from} to=${result.to} days=${result.days} sessions=${result.sessions} facts=${result.facts} duration_ms=${result.duration_ms}`,
  )
  return result
})
