import type { RawDispatchDb } from './dispatch-runner'
import { googleAdsDestinationConnector, mapCanonicalToGoogleAds } from './google-ads-connector'

type Candidate = {
  id: string
  event_name: string
  payload_normalized: Record<string, unknown> | string
  status: string
  attempt_count: number
}

// Only migrate unsent, recoverable Google rows. Never reopen a sent or validated receipt.
// Retained canonical envelopes are required: compacted history is not reconstructed.
export async function remapGoogleAdsDispatches(db: RawDispatchDb, signal?: AbortSignal) {
  if (!googleAdsDestinationConnector.isConfigured() || signal?.aborted) return { scanned: 0, remapped: 0 }
  const rows = await db.raw<Candidate>(
    `SELECT d.id, d.status, d.attempt_count, e.event_name, e.payload_normalized
     FROM dispatch_logs d JOIN event_logs e ON e.event_id = d.event_id
     WHERE d.destination = 'google_ads'
       AND d.status IN ('pending', 'retry', 'not_configured', 'invalid', 'error')
       AND e.payload_normalized IS NOT NULL
       AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= NOW())
       AND (d.request_payload ? 'conversions' OR d.error_code = ANY($1::text[]))
     ORDER BY d.event_received_at, d.id LIMIT 100`,
    [
      [
        'google_ads_customer_id_missing',
        'google_ads_conversion_action_id_missing',
        'google_ads_payload_remap_required',
      ],
    ],
  )
  let remapped = 0
  for (const row of rows) {
    if (signal?.aborted) break
    let canonical: Record<string, unknown>
    try {
      canonical =
        typeof row.payload_normalized === 'string' ? JSON.parse(row.payload_normalized) : row.payload_normalized
    } catch {
      continue
    }
    if (!canonical || typeof canonical !== 'object' || Array.isArray(canonical)) continue
    const mapped = mapCanonicalToGoogleAds(row.event_name, canonical)
    if (!mapped.supported) continue
    const configurationOnly =
      Array.isArray(mapped.metadata.configuration_errors) &&
      mapped.metadata.configuration_errors.length > 0 &&
      Array.isArray(mapped.metadata.payload_errors) &&
      mapped.metadata.payload_errors.length === 0
    const status = mapped.ok ? 'pending' : configurationOnly ? 'not_configured' : 'invalid'
    const primaryError =
      !mapped.ok && Array.isArray(mapped.metadata.payload_errors) && mapped.metadata.payload_errors.length
        ? String(mapped.metadata.payload_errors[0])
        : mapped.ok
          ? null
          : mapped.errors[0]
    const updated = await db.raw(
      `UPDATE dispatch_logs SET status=$2, error_code=$3, error_message=$4,
         request_payload=$5::text::jsonb, metadata=$6::text::jsonb, updated_at=NOW(),
         next_attempt_at=CASE WHEN $2='pending' THEN NOW()
           WHEN $2='not_configured' THEN NOW()+INTERVAL '1 hour' ELSE NULL END
       WHERE id=$1 AND status=$7 AND attempt_count = $8 RETURNING id`,
      [
        row.id,
        status,
        primaryError,
        mapped.ok ? null : mapped.errors.join(', '),
        JSON.stringify(mapped.payload),
        JSON.stringify(mapped.metadata),
        row.status,
        row.attempt_count,
      ],
    )
    remapped += updated.length
  }
  return { scanned: rows.length, remapped }
}

// Explicit operator action only. Changing test-mode flags never replays test events.
export async function requeueValidatedAdDispatches(
  db: RawDispatchDb,
  destination: 'google_ads' | 'pinterest',
  eventIds: string[],
) {
  const ids = [...new Set(eventIds)]
  if (!ids.length || ids.length > 20 || ids.some((id) => !id || id.length > 180)) {
    throw new Error('Provide between 1 and 20 valid event IDs')
  }
  const rows = await db.raw(
    `UPDATE dispatch_logs SET status='pending', next_attempt_at=NOW(), updated_at=NOW(),
       error_code=NULL, error_message=NULL, response_payload=NULL
     WHERE destination=$1 AND event_id=ANY($2::text[])
       AND status = 'validated' AND request_payload IS NOT NULL RETURNING event_id`,
    [destination, ids],
  )
  return { requeued: rows.length }
}
