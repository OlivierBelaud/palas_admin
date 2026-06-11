// Cron: every 5 minutes — keep visitor_sessions current from PostHog.
//
// This job materializes session snapshots only. Raw event history remains in
// PostHog and can be replayed through syncVisitorSessions/backfill scripts.

interface SyncVisitorSessionsResult {
  fetched: number
  attempted: number
  skipped: number
  errors: number
  since: string | null
  max_at: string | null
  duration_ms: number
}

const EMPTY: SyncVisitorSessionsResult = {
  fetched: 0,
  attempted: 0,
  skipped: 0,
  errors: 0,
  since: null,
  max_at: null,
  duration_ms: 0,
}

export default defineJob('sync-visitor-sessions', '*/5 * * * *', async ({ command, log }) => {
  if (process.env.NODE_ENV !== 'production') {
    log.info(`[sync-visitor-sessions] skipped (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}, prod-only)`)
    return EMPTY
  }

  const result = (await (
    command as unknown as { syncVisitorSessions: (input: unknown) => Promise<unknown> }
  ).syncVisitorSessions({ lookbackMinutes: 15 })) as SyncVisitorSessionsResult

  log.info(
    `[sync-visitor-sessions] fetched=${result.fetched} attempted=${result.attempted} skipped=${result.skipped} errors=${result.errors} since=${result.since ?? 'none'} maxAt=${result.max_at ?? 'none'} duration_ms=${result.duration_ms}`,
  )
  return result
})
