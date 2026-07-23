// Cron adapter for the canonical PostHog -> visitor_sessions projection.
// Projection behavior belongs in utils/visitor-session-sync.ts.

import {
  EMPTY_VISITOR_SESSION_SYNC_RESULT,
  type RuntimeDatabase,
  runVisitorSessionSync,
} from '../utils/visitor-session-sync'
import { posthogPrivateKey } from '../utils/posthog-query'

export default defineJob('sync-visitor-sessions', '*/5 * * * *', async ({ db, log }) => {
  if (process.env.NODE_ENV !== 'production') {
    log.info(`[sync-visitor-sessions] skipped (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}, prod-only)`)
    return EMPTY_VISITOR_SESSION_SYNC_RESULT
  }

  const runtimeDb = db as RuntimeDatabase | undefined
  const key = posthogPrivateKey()
  if (!runtimeDb?.raw || !key) {
    log.error('[sync-visitor-sessions] DB or POSTHOG_API_KEY missing')
    return { ...EMPTY_VISITOR_SESSION_SYNC_RESULT, errors: 1 }
  }

  return runVisitorSessionSync({
    db: runtimeDb,
    privateKey: key,
    log,
  })
})
