// Cron: every 5 minutes — keep the lifecycle dashboard fact cache fresh.
//
// We rebuild a rolling 35-day window because late PostHog/shopify attribution
// can update recent visitor_sessions after the original browsing day. Older
// ranges can be rebuilt manually with `refreshVisitorLifecycleFacts`.

import type { RawDb } from '../modules/cart-tracking/refresh-cart'
import { type RefreshLifecycleFactsResult, refreshLifecycleFacts } from '../modules/visitor-session/lifecycle-facts'

const EMPTY: RefreshLifecycleFactsResult = {
  from: '',
  to: '',
  days: 0,
  sessions: 0,
  facts: 0,
  duration_ms: 0,
}

const REFRESH_DAYS = 35

export default defineJob('refresh-visitor-lifecycle-facts', '*/5 * * * *', async ({ db, log }) => {
  if (process.env.NODE_ENV !== 'production') {
    log.info(`[refresh-visitor-lifecycle-facts] skipped (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}, prod-only)`)
    return EMPTY
  }

  const runtimeDb = db as RawDb | undefined
  if (!runtimeDb?.raw) {
    log.error('[refresh-visitor-lifecycle-facts] DB missing')
    return EMPTY
  }

  const to = new Date()
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() - REFRESH_DAYS))
  const result = await refreshLifecycleFacts(runtimeDb, { from, to })

  log.info(
    `[refresh-visitor-lifecycle-facts] from=${result.from} to=${result.to} days=${result.days} sessions=${result.sessions} facts=${result.facts} duration_ms=${result.duration_ms}`,
  )
  return result
})
