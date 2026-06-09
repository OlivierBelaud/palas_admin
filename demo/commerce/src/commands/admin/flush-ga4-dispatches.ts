import { getGa4Config, isGa4Configured, sendGa4Payload } from '../../modules/event-hub/ga4-connector'

type RawDb = {
  raw<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
}

type DispatchRow = {
  id: string
  event_id: string
  canonical_event_name: string
  status: string
  attempt_count: number
  request_payload: Record<string, unknown> | string | null
}

function parsePayload(value: DispatchRow['request_payload']): Record<string, unknown> | null {
  if (!value) return null
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
  return value
}

function nextRetryDelayMinutes(attemptCount: number) {
  return Math.min(60, Math.max(1, 2 ** Math.max(0, attemptCount - 1)))
}

export default defineCommand({
  name: 'flushGa4Dispatches',
  description: 'Send pending Event Hub GA4 dispatch logs via Measurement Protocol and persist delivery status.',
  input: z.object({
    batchLimit: z.number().int().min(1).max(200).default(50),
  }),
  workflow: async (input, { step, log }) => {
    return await step.action('flush-ga4-dispatches', {
      invoke: async (_i: unknown, ctx) => {
        const db = ctx.app.infra.db as RawDb | undefined
        if (!db?.raw) throw new MantaError('UNEXPECTED_STATE', 'No database configured')

        const config = getGa4Config()
        const configured = isGa4Configured(config)
        const rows = await db.raw<DispatchRow>(
          `SELECT id, event_id, canonical_event_name, status, attempt_count, request_payload
             FROM dispatch_logs
            WHERE destination = 'ga4'
              AND status IN ('pending', 'retry', 'not_configured')
              AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
            ORDER BY event_received_at ASC
            LIMIT $1`,
          [input.batchLimit],
        )

        let sent = 0
        let invalid = 0
        let errors = 0
        let retries = 0
        let notConfigured = 0

        for (const row of rows) {
          if (ctx.signal?.aborted) break

          const attempt = Number(row.attempt_count ?? 0) + 1
          const payload = parsePayload(row.request_payload)
          const firstAttemptSql = row.attempt_count > 0 ? 'first_attempt_at' : 'NOW()'

          if (!payload) {
            invalid += 1
            await db.raw(
              `UPDATE dispatch_logs
                  SET status = 'invalid',
                      first_attempt_at = COALESCE(first_attempt_at, NOW()),
                      last_attempt_at = NOW(),
                      next_attempt_at = NULL,
                      attempt_count = $2,
                      error_code = 'ga4_payload_missing',
                      error_message = 'GA4 request_payload is empty or invalid JSON',
                      updated_at = NOW()
                WHERE id = $1`,
              [row.id, attempt],
            )
            continue
          }

          if (!configured) {
            notConfigured += 1
            await db.raw(
              `UPDATE dispatch_logs
                  SET status = 'not_configured',
                      first_attempt_at = COALESCE(first_attempt_at, ${firstAttemptSql}),
                      last_attempt_at = NOW(),
                      next_attempt_at = NOW() + INTERVAL '5 minutes',
                      attempt_count = $2,
                      error_code = 'ga4_not_configured',
                      error_message = 'Set GA4_MEASUREMENT_ID and GA4_API_SECRET to enable dispatch',
                      updated_at = NOW()
                WHERE id = $1`,
              [row.id, attempt],
            )
            continue
          }

          await db.raw(
            `UPDATE dispatch_logs
                SET status = 'sending',
                    first_attempt_at = COALESCE(first_attempt_at, ${firstAttemptSql}),
                    last_attempt_at = NOW(),
                    attempt_count = $2,
                    updated_at = NOW()
              WHERE id = $1`,
            [row.id, attempt],
          )

          const result = await sendGa4Payload(payload, config, ctx.signal)
          const retry = result.status === 'retry'
          if (result.status === 'sent') sent += 1
          else if (result.status === 'invalid') invalid += 1
          else if (retry) retries += 1
          else errors += 1

          const nextAttemptMinutes = retry ? nextRetryDelayMinutes(attempt) : null
          await db.raw(
            `UPDATE dispatch_logs
                SET status = $2,
                    http_status = $3,
                    error_code = $4,
                    error_message = $5,
                    response_payload = $6::jsonb,
                    sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END,
                    next_attempt_at = CASE WHEN $7::int IS NULL THEN NULL ELSE NOW() + ($7::text || ' minutes')::interval END,
                    updated_at = NOW()
              WHERE id = $1`,
            [
              row.id,
              result.status,
              result.http_status,
              result.error_code,
              result.error_message,
              JSON.stringify(result.response_payload ?? {}),
              nextAttemptMinutes,
            ],
          )
        }

        if (ctx.signal?.aborted) {
          throw new MantaError('CONFLICT', 'flushGa4Dispatches cancelled', { code: 'WORKFLOW_CANCELLED' })
        }

        log.info(
          `[flushGa4Dispatches] scanned=${rows.length} sent=${sent} invalid=${invalid} retry=${retries} error=${errors} not_configured=${notConfigured}`,
        )

        return {
          scanned: rows.length,
          sent,
          invalid,
          retry: retries,
          error: errors,
          not_configured: notConfigured,
          configured,
        }
      },
      compensate: async () => {
        // Dispatch rows are idempotent by event_destination_key. Partial
        // progress is expected; the next cron tick resumes pending/retry rows.
      },
    })
  },
})
