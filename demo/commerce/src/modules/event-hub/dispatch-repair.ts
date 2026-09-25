import { isGa4CanonicalEventName } from './canonical-contract'
import type { DestinationConnector } from './destination-connector'
import type { RawDispatchDb } from './dispatch-runner'
import { mapCanonicalToGa4 } from './ga4-connector'
import { mapCanonicalToGoogleAds } from './google-ads-connector'
import { mapCanonicalToMetaCapi } from './meta-capi-connector'
import { mapCanonicalToPinterest } from './pinterest-connector'

type Envelope = {
  event_id: string
  event_name: string
  received_at: string | Date
  payload_normalized: Record<string, unknown> | string
}

// A persisted envelope is itself the recovery source when a request stopped
// between event persistence and outbox provisioning. No browser replay is required.
export async function repairUnpreparedDispatches(
  db: RawDispatchDb,
  connector: DestinationConnector,
  options: { limit?: number; signal?: AbortSignal } = {},
) {
  if (!connector.isConfigured() || options.signal?.aborted) return { scanned: 0, inserted: 0 }
  const rows = await db.raw<Envelope>(
    `SELECT event_id, event_name, received_at, payload_normalized FROM event_logs
      WHERE dispatch_prepared_at IS NULL AND payload_normalized IS NOT NULL
      ORDER BY received_at, event_id LIMIT $1`,
    [Math.max(1, Math.min(100, Math.trunc(options.limit ?? 100)))],
  )
  let inserted = 0
  for (const row of rows) {
    if (options.signal?.aborted) break
    let payload: Record<string, unknown>
    try {
      payload = typeof row.payload_normalized === 'string' ? JSON.parse(row.payload_normalized) : row.payload_normalized
    } catch {
      payload = {}
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) payload = {}
    const mapped = [
      ...(isGa4CanonicalEventName(row.event_name)
        ? [{ destination: 'ga4', ...mapCanonicalToGa4(row.event_name, payload) }]
        : []),
      { destination: 'google_ads', ...mapCanonicalToGoogleAds(row.event_name, payload) },
      { destination: 'meta_capi', ...mapCanonicalToMetaCapi(row.event_name, payload) },
      { destination: 'pinterest', ...mapCanonicalToPinterest(row.event_name, payload) },
    ].filter((value) => !('supported' in value) || value.supported)
    const eventTime = new Date(typeof payload.event_time === 'string' ? payload.event_time : row.received_at)
    const entries = mapped.map((value) => ({
      destination: value.destination,
      status: value.ok ? 'pending' : 'invalid',
      error_code: value.ok ? null : (value.errors[0] ?? `${value.destination}_invalid_payload`),
      error_message: value.ok ? null : value.errors.join(', '),
      request_payload: value.payload,
      metadata: { ...value.metadata, ready: value.ok, errors: value.ok ? [] : value.errors },
    }))
    // One SQL statement guarantees all destination inserts and the completion marker
    // commit together, even on pooled HTTP adapters. Existing delivery receipts win.
    const [result] = await db.raw<{ inserted: number }>(
      `WITH prepared AS (
         INSERT INTO dispatch_logs (
           id,event_destination_key,event_id,canonical_event_name,source_event_name,
           destination,status,event_received_at,next_attempt_at,attempt_count,
           error_code,error_message,request_payload,metadata,created_at,updated_at
         ) SELECT gen_random_uuid(), $1 || ':' || entry.destination, $1, $2, $3,
           entry.destination,entry.status,$4::timestamptz,
           CASE WHEN entry.status='pending' THEN NOW() ELSE NULL END,0,
           entry.error_code,entry.error_message,entry.request_payload,entry.metadata,NOW(),NOW()
         FROM jsonb_to_recordset($5::text::jsonb) AS entry(
           destination text,status text,error_code text,error_message text,request_payload jsonb,metadata jsonb)
         ON CONFLICT (event_destination_key) DO NOTHING RETURNING id
       ), completed AS (
         UPDATE event_logs SET dispatch_prepared_at=NOW()
         WHERE event_id=$1 AND dispatch_prepared_at IS NULL RETURNING event_id
       ) SELECT COUNT(*)::int AS inserted FROM prepared`,
      [
        row.event_id,
        row.event_name,
        typeof payload.raw_event_name === 'string' ? payload.raw_event_name : row.event_name,
        Number.isFinite(eventTime.getTime()) ? eventTime.toISOString() : row.received_at,
        JSON.stringify(entries),
      ],
    )
    inserted += Number(result?.inserted ?? 0)
  }
  return { scanned: rows.length, inserted }
}
