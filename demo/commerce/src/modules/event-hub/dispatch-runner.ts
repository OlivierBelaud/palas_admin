import type {
  DestinationConnector,
  DispatchDestination,
  DispatchSendResult,
  DispatchStatus,
} from './destination-connector'

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

type MissingDispatchRow = {
  event_id: string
  event_name: string
  source_event_name: string | null
  received_at: Date | string
  payload_normalized: Record<string, unknown> | string | null
}

export type DispatchReconciliationMapResult = {
  supported?: boolean
  ok: boolean
  errors?: string[]
  payload: Record<string, unknown>
  metadata: Record<string, unknown>
}

export type EnsureMissingDestinationDispatchLogsResult = {
  scanned: number
  inserted: number
  invalid: number
}

export type FlushDestinationDispatchesResult = {
  scanned: number
  sent: number
  invalid: number
  retry: number
  error: number
  not_configured: number
  claim_conflict: number
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

type EnsureMissingDestinationDispatchLogsInput = {
  db: RawDispatchDb
  destination: DispatchDestination
  map: (eventName: string, payload: Record<string, unknown>) => DispatchReconciliationMapResult
  lookbackHours?: number
  limit?: number
}

// Provider work must settle before a stale `sending` row becomes claimable
// again. All current connectors pass this signal to their fetch calls.
const PROVIDER_CALL_TIMEOUT_MS = 90_000

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

function parseNormalizedPayload(value: MissingDispatchRow['payload_normalized']): Record<string, unknown> {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
    } catch {
      return {}
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

function connectorExceptionResult(connector: DestinationConnector, err: unknown): DispatchSendResult {
  return {
    status: 'retry',
    http_status: null,
    error_code: `${connector.destination}_connector_exception`,
    error_message: err instanceof Error ? err.message.slice(0, 1000) : String(err).slice(0, 1000),
    response_payload: null,
  }
}

async function sendBeforeLeaseExpiry(
  connector: DestinationConnector,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<DispatchSendResult> {
  const timeoutController = new AbortController()
  const timeout = setTimeout(() => {
    timeoutController.abort(new Error(`${connector.destination} provider request exceeded dispatch lease`))
  }, PROVIDER_CALL_TIMEOUT_MS)
  const providerSignal = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal

  try {
    return await connector.send(payload, providerSignal)
  } finally {
    clearTimeout(timeout)
  }
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
    claim_conflict: 0,
    configured,
  }

  for (const row of rows) {
    if (signal?.aborted) break

    const attempt = Number(row.attempt_count ?? 0) + 1
    const payload = parsePayload(row.request_payload)
    const claimed = await db.raw<{ id: string }>(
      `UPDATE dispatch_logs
          SET status = 'sending',
              first_attempt_at = COALESCE(first_attempt_at, NOW()),
              last_attempt_at = NOW(),
              attempt_count = $2,
              updated_at = NOW()
        WHERE id = $1
          AND attempt_count = $3
          AND (
            (status = ANY($4::text[]) AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()))
            OR (status = 'sending' AND last_attempt_at <= NOW() - INTERVAL '2 minutes')
          )
      RETURNING id`,
      [row.id, attempt, row.attempt_count, connector.pendingStatuses],
    )
    if (claimed.length === 0) {
      counters.claim_conflict += 1
      continue
    }

    if (!payload) {
      const finalized = await db.raw<{ id: string }>(
        `UPDATE dispatch_logs
            SET status = 'invalid',
                next_attempt_at = NULL,
                error_code = $2,
                error_message = $3,
                updated_at = NOW()
          WHERE id = $1
            AND status = 'sending'
            AND attempt_count = $4
        RETURNING id`,
        [
          row.id,
          `${connector.destination}_payload_missing`,
          `${connector.destination} request_payload is empty or invalid JSON`,
          attempt,
        ],
      )
      if (finalized.length > 0) counters.invalid += 1
      else counters.claim_conflict += 1
      continue
    }

    if (!configured) {
      const finalized = await db.raw<{ id: string }>(
        `UPDATE dispatch_logs
            SET status = 'not_configured',
                next_attempt_at = NOW() + INTERVAL '5 minutes',
                error_code = $2,
                error_message = $3,
                updated_at = NOW()
          WHERE id = $1
            AND status = 'sending'
            AND attempt_count = $4
        RETURNING id`,
        [row.id, connector.notConfiguredErrorCode, connector.notConfiguredMessage, attempt],
      )
      if (finalized.length > 0) counters.not_configured += 1
      else counters.claim_conflict += 1
      continue
    }

    let result: DispatchSendResult
    try {
      result = await sendBeforeLeaseExpiry(connector, payload, signal)
    } catch (err) {
      result = connectorExceptionResult(connector, err)
    }

    const nextAttemptMinutes =
      result.status === 'retry' || result.status === 'not_configured' ? nextRetryDelayMinutes(attempt) : null
    const finalized = await db.raw<{ id: string }>(
      `UPDATE dispatch_logs
          SET status = $2,
              http_status = $3,
              error_code = $4,
              error_message = $5,
              response_payload = $6::jsonb,
              sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END,
              next_attempt_at = CASE WHEN $7::int IS NULL THEN NULL ELSE NOW() + ($7::text || ' minutes')::interval END,
              updated_at = NOW()
        WHERE id = $1
          AND status = 'sending'
          AND attempt_count = $8
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
    if (finalized.length > 0) countResult(result.status, counters)
    else counters.claim_conflict += 1
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
  const rows = await db.raw<DispatchRow>(
    `SELECT id, event_id, canonical_event_name, status, attempt_count, request_payload
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

export async function ensureMissingDestinationDispatchLogs({
  db,
  destination,
  map,
  lookbackHours: requestedLookbackHours,
  limit: requestedLimit,
}: EnsureMissingDestinationDispatchLogsInput): Promise<EnsureMissingDestinationDispatchLogsResult> {
  const lookbackHours = Math.max(1, Math.min(72, Math.trunc(requestedLookbackHours ?? 24)))
  const limit = Math.max(1, Math.min(1000, Math.trunc(requestedLimit ?? 500)))
  const rows = await db.raw<MissingDispatchRow>(
    `SELECT e.event_id,
            e.event_name,
            COALESCE(e.payload_normalized ->> 'raw_event_name', e.event_name) AS source_event_name,
            e.received_at,
            e.payload_normalized
       FROM event_logs e
       LEFT JOIN dispatch_logs d
         ON d.event_id = e.event_id
        AND d.destination = $1
      WHERE e.received_at >= NOW() - ($2::int * INTERVAL '1 hour')
        AND e.payload_normalized #>> ARRAY['validation', 'destinations', $1::text, 'supported'] = 'true'
        AND d.event_id IS NULL
      ORDER BY e.received_at ASC
      LIMIT $3`,
    [destination, lookbackHours, limit],
  )

  let inserted = 0
  let invalid = 0
  for (const row of rows) {
    const mapped = map(row.event_name, parseNormalizedPayload(row.payload_normalized))
    const errors = mapped.errors ?? []
    const ready = mapped.supported !== false && mapped.ok

    const created = await db.raw<{ id: string }>(
      `INSERT INTO dispatch_logs (
         id, event_destination_key, event_id, canonical_event_name, source_event_name,
         destination, status, event_received_at, first_attempt_at, last_attempt_at,
         next_attempt_at, sent_at, attempt_count, http_status, error_code,
         error_message, request_payload, response_payload, metadata, created_at, updated_at
       ) VALUES (
         gen_random_uuid(), $1, $2, $3, $4,
         $5, $6, $7::timestamptz, NULL, NULL,
         $8::timestamptz, NULL, 0, NULL, $9,
         $10, $11::jsonb, NULL, $12::jsonb, NOW(), NOW()
       )
       ON CONFLICT (event_destination_key) DO NOTHING
       RETURNING id`,
      [
        `${row.event_id}:${destination}`,
        row.event_id,
        row.event_name,
        row.source_event_name,
        destination,
        ready ? 'pending' : 'invalid',
        row.received_at,
        ready ? new Date() : null,
        ready ? null : (errors[0] ?? `${destination}_invalid_payload`),
        ready ? null : errors.join(', '),
        JSON.stringify(mapped.payload),
        JSON.stringify({ ...mapped.metadata, ready, errors: ready ? [] : errors }),
      ],
    )
    if (created.length > 0) {
      inserted += 1
      if (!ready) invalid += 1
    }
  }

  return { scanned: rows.length, inserted, invalid }
}
