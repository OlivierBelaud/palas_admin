type RuntimeDatabase = {
  raw<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
}

// Cron: every 4 hours, keep only the last 24h of Event Hub hot logs.
export default defineJob('purge-event-hub-logs', '0 */4 * * *', async ({ db, log }) => {
  const runtimeDb = db as RuntimeDatabase | undefined
  if (!runtimeDb?.raw) {
    log.error('[purge-event-hub-logs] IDatabasePort missing')
    return { deleted: 0, error: 'DB_UNAVAILABLE' }
  }

  const rows = await runtimeDb.raw<{ count: string }>(
    `WITH deleted AS (
       DELETE FROM event_logs
        WHERE received_at < NOW() - INTERVAL '24 hours'
        RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM deleted`,
  )
  const deleted = Number(rows[0]?.count ?? 0)
  log.info(`[purge-event-hub-logs] deleted=${deleted}`)
  return { deleted }
})
