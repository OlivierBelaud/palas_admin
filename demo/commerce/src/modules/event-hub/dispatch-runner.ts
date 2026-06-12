import type { DestinationConnector, DispatchStatus } from './destination-connector'

export type RawDispatchDb = {
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

export type FlushDestinationDispatchesResult = {
  scanned: number
  sent: number
  invalid: number
  retry: number
  error: number
  not_configured: number
  configured: boolean
}

type FlushDestinationDispatchesInput = {
  db: RawDispatchDb
  connector: DestinationConnector
  batchLimit: number
  signal?: AbortSignal
}

type FlushDispatchLogByKeyInput = {
  db: RawDispatchDb
  connector: DestinationConnector
  eventDestinationKey: string
  signal?: AbortSignal
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

function countResult(status: DispatchStatus, counters: FlushDestinationDispatchesResult) {
  if (status === 'sent') counters.sent += 1
  else if (status === 'invalid') counters.invalid += 1
  else if (status === 'retry') counters.retry += 1
  else if (status === 'not_configured') counters.not_configured += 1
  else counters.error += 1
}

async function flushRows(
  rows: DispatchRow[],
  db: RawDispatchDb,
  connector: DestinationConnector,
  configured: boolean,
  signal?: AbortSignal,
): Promise<FlushDestinationDispatchesResult> {
  const counters: FlushDestinationDispatchesResult = {
    scanned: rows.length,
    sent: 0,
    invalid: 0,
    retry: 0,
    error: 0,
    not_configured: 0,
    configured,
  }

  for (const row of rows) {
    if (signal?.aborted) break

    const attempt = Number(row.attempt_count ?? 0) + 1
    const payload = parsePayload(row.request_payload)
    const firstAttemptSql = row.attempt_count > 0 ? 'first_attempt_at' : 'NOW()'

    if (!payload) {
      counters.invalid += 1
      await db.raw(
        `UPDATE dispatch_logs
            SET status = 'invalid',
                first_attempt_at = COALESCE(first_attempt_at, NOW()),
                last_attempt_at = NOW(),
                next_attempt_at = NULL,
                attempt_count = $2,
                error_code = $3,
                error_message = $4,
                updated_at = NOW()
          WHERE id = $1`,
        [
          row.id,
          attempt,
          `${connector.destination}_payload_missing`,
          `${connector.destination} request_payload is empty or invalid JSON`,
        ],
      )
      continue
    }

    if (!configured) {
      counters.not_configured += 1
      await db.raw(
        `UPDATE dispatch_logs
            SET status = 'not_configured',
                first_attempt_at = COALESCE(first_attempt_at, ${firstAttemptSql}),
                last_attempt_at = NOW(),
                next_attempt_at = NOW() + INTERVAL '5 minutes',
                attempt_count = $2,
                error_code = $3,
                error_message = $4,
                updated_at = NOW()
          WHERE id = $1`,
        [row.id, attempt, connector.notConfiguredErrorCode, connector.notConfiguredMessage],
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

    const result = await connector.send(payload, signal)
    countResult(result.status, counters)

    const nextAttemptMinutes =
      result.status === 'retry' || result.status === 'not_configured' ? nextRetryDelayMinutes(attempt) : null
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

  return counters
}

export async function flushDestinationDispatches({
  db,
  connector,
  batchLimit,
  signal,
}: FlushDestinationDispatchesInput): Promise<FlushDestinationDispatchesResult> {
  const configured = connector.isConfigured()
  const rows = await db.raw<DispatchRow>(
    `SELECT id, event_id, canonical_event_name, status, attempt_count, request_payload
       FROM dispatch_logs
      WHERE destination = $1
        AND ($2::text IS NULL OR canonical_event_name = $2)
        AND status = ANY($3::text[])
        AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
      ORDER BY event_received_at ASC
      LIMIT $4`,
    [connector.destination, connector.eventNameFilter ?? null, connector.pendingStatuses, batchLimit],
  )

  return flushRows(rows, db, connector, configured, signal)
}

export async function flushDispatchLogByEventDestinationKey({
  db,
  connector,
  eventDestinationKey,
  signal,
}: FlushDispatchLogByKeyInput): Promise<FlushDestinationDispatchesResult> {
  const configured = connector.isConfigured()
  const rows = await db.raw<DispatchRow>(
    `SELECT id, event_id, canonical_event_name, status, attempt_count, request_payload
       FROM dispatch_logs
      WHERE destination = $1
        AND event_destination_key = $2
        AND status = ANY($3::text[])
        AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
      LIMIT 1`,
    [connector.destination, eventDestinationKey, connector.pendingStatuses],
  )

  return flushRows(rows, db, connector, configured, signal)
}
