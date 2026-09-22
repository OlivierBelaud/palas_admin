import type { DestinationConnector, DispatchSendResult, DispatchStatus } from './destination-connector'

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

    // Claim immediately before I/O: an old candidate cannot reclaim a newer attempt.
    const [claimed] = await db.raw<DispatchRow>(
      `UPDATE dispatch_logs
          SET status = 'sending', attempt_count = attempt_count + 1,
              first_attempt_at = COALESCE(first_attempt_at, NOW()),
              last_attempt_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND attempt_count = $2
          AND ((status = ANY($3::text[]) AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()))
            OR (status = 'sending' AND last_attempt_at <= NOW() - INTERVAL '2 minutes'))
        RETURNING id, attempt_count, request_payload`,
      [row.id, row.attempt_count, connector.pendingStatuses],
    )
    if (!claimed) continue
    const attempt = Number(claimed.attempt_count)
    const payload = parsePayload(claimed.request_payload)
    let result: DispatchSendResult
    if (!payload) {
      result = {
        status: 'invalid',
        http_status: null,
        error_code: `${connector.destination}_payload_missing`,
        error_message: `${connector.destination} request_payload is empty or invalid JSON`,
        response_payload: null,
      }
    } else {
      // Bound network work below the recovery lease; cancellation also leaves a durable retry.
      const controller = new AbortController()
      const abort = () => controller.abort(signal?.reason)
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
      let timer: ReturnType<typeof setTimeout> | undefined
      let onAbort: (() => void) | undefined
      try {
        const interrupted = new Promise<never>((_, reject) => {
          onAbort = () => reject(new Error('Dispatch interrupted'))
          controller.signal.addEventListener('abort', onAbort, { once: true })
          timer = setTimeout(() => controller.abort(), 90_000)
          if (controller.signal.aborted) onAbort()
        })
        result = await Promise.race([connector.send(payload, controller.signal), interrupted])
      } catch {
        // Provider errors may contain credentials or personal data: retain only a safe code.
        result = {
          status: 'retry',
          http_status: null,
          error_code: 'dispatch_transport_interrupted',
          error_message: 'Delivery interrupted; scheduled retry retained',
          response_payload: null,
        }
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        if (onAbort) controller.signal.removeEventListener('abort', onAbort)
      }
    }

    const nextAttemptMinutes =
      result.status === 'retry' || result.status === 'not_configured' ? nextRetryDelayMinutes(attempt) : null
    const finished = await db.raw(
      `UPDATE dispatch_logs
          SET status = $2,
              http_status = $3,
              error_code = $4,
              error_message = $5,
              response_payload = $6::text::jsonb,
              sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END,
              next_attempt_at = CASE WHEN $7::int IS NULL THEN NULL ELSE NOW() + ($7::text || ' minutes')::interval END,
              updated_at = NOW()
        WHERE id = $1 AND status = 'sending' AND attempt_count = $8
        RETURNING id`,
      [
        row.id,
        result.status,
        result.http_status,
        result.error_code,
        result.error_message,
        JSON.stringify(result.response_payload ?? {}),
        nextAttemptMinutes,
        attempt,
      ],
    )
    if (finished.length) countResult(result.status, counters)
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
  if (!configured || signal?.aborted) return flushRows([], db, connector, configured, signal)
  const rows = await db.raw<DispatchRow>(
    `SELECT id, attempt_count
       FROM dispatch_logs
      WHERE destination = $1
        AND ($2::text IS NULL OR canonical_event_name = $2)
        AND (
          (status = ANY($3::text[]) AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()))
          OR (status = 'sending' AND last_attempt_at <= NOW() - INTERVAL '2 minutes')
        )
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
  if (!configured || signal?.aborted) return flushRows([], db, connector, configured, signal)
  const rows = await db.raw<DispatchRow>(
    `SELECT id, attempt_count
       FROM dispatch_logs
      WHERE destination = $1
        AND event_destination_key = $2
        AND (
          (status = ANY($3::text[]) AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()))
          OR (status = 'sending' AND last_attempt_at <= NOW() - INTERVAL '2 minutes')
        )
      LIMIT 1`,
    [connector.destination, eventDestinationKey, connector.pendingStatuses],
  )

  return flushRows(rows, db, connector, configured, signal)
}
