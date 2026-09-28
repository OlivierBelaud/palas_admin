import type { RawDb } from '../../utils/raw-db'
import {
  CANONICAL_EVENT_CONTRACTS,
  type CanonicalEventName,
  DISPATCHABLE_CANONICAL_EVENT_NAMES,
} from '../event-hub/canonical-contract'
import type { ControlInput } from './local-query'
import { readProviderEvidence } from './providers'
import type { ControlDestination, ControlWindow, ProviderReadResult } from './types'

export const MATRIX_DESTINATIONS: ControlDestination[] = ['ga4', 'meta_capi', 'google_ads', 'pinterest']
export type MatrixCell = {
  sent: number
  received: number | null
  unconfirmed: number
  tests: number
  unknown_mode: number
  provider_event_name: string
}
export type TrackingMatrix = {
  window: ControlWindow
  generated_at: string
  rows: Array<{
    event_name: string
    captured: number
    valid: number
    platforms: Record<ControlDestination, MatrixCell | null>
  }>
  providers: Partial<Record<ControlDestination, ProviderReadResult>>
  remote_loaded: boolean
}
const count = (value: unknown) => Math.max(0, Number(value) || 0)
type Row = Record<string, unknown>

export async function loadTrackingMatrix(
  input: ControlInput,
  db: RawDb,
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
  remote = true,
): Promise<TrackingMatrix> {
  const args = [input.window.from, input.window.to, [...DISPATCHABLE_CANONICAL_EVENT_NAMES]]
  const [events, dispatches, requests] = await Promise.all([
    db.raw<Row>(
      `/* matrix:events */ SELECT event_name, COUNT(*) AS captured, COUNT(*) FILTER (WHERE valid = true) AS valid FROM event_logs
      WHERE deleted_at IS NULL AND received_at >= $1::timestamptz AND received_at < $2::timestamptz
      AND event_name = ANY($3::text[]) GROUP BY event_name`,
      args,
    ),
    db.raw<Row>(
      `/* matrix:dispatches */ SELECT e.event_name, d.destination,
      COUNT(*) FILTER (WHERE d.status = 'sent' AND NOT COALESCE(d.response_payload ? 'validationMessages', false)
        AND NOT COALESCE(d.request_payload ? 'test_event_code', false)
        AND NOT (d.destination IN ('ga4','meta_capi') AND d.request_payload IS NULL AND d.response_payload IS NULL)) AS sent,
      COUNT(*) FILTER (WHERE d.status='sent' AND d.destination IN ('ga4','meta_capi')
        AND d.request_payload IS NULL AND d.response_payload IS NULL) AS unknown_mode,
      COUNT(*) FILTER (WHERE d.status = 'validated' OR d.response_payload ? 'validationMessages' OR d.request_payload ? 'test_event_code') AS tests,
      COUNT(*) FILTER (WHERE d.status = 'sent' AND (
        (d.destination = 'meta_capi' AND d.response_payload->>'events_received' = '1' AND NOT COALESCE(d.request_payload ? 'test_event_code', false)) OR
        (d.destination = 'pinterest' AND d.response_payload->>'num_events_received' = '1' AND d.response_payload->>'num_events_processed' = '1') OR
        (d.destination = 'google_ads' AND NULLIF(d.response_payload->>'requestId', '') IS NOT NULL)
      )) AS acknowledged
      FROM event_logs e JOIN dispatch_logs d ON d.event_id = e.event_id AND d.deleted_at IS NULL
      WHERE e.deleted_at IS NULL AND e.received_at >= $1::timestamptz AND e.received_at < $2::timestamptz
        AND e.event_name = ANY($3::text[]) AND d.destination IN ('ga4','meta_capi','google_ads','pinterest')
      GROUP BY e.event_name,d.destination`,
      args,
    ),
    remote
      ? db.raw<Row>(
          `/* matrix:google */ WITH requests AS (SELECT DISTINCT ON (d.response_payload->>'requestId')
        d.response_payload->>'requestId' AS request_id, e.event_name
      FROM event_logs e JOIN dispatch_logs d ON d.event_id=e.event_id AND d.deleted_at IS NULL
      WHERE e.deleted_at IS NULL AND e.received_at >= $1::timestamptz AND e.received_at < $2::timestamptz
        AND e.event_name = ANY($3::text[]) AND d.destination='google_ads' AND d.status='sent'
        AND NULLIF(d.response_payload->>'requestId','') IS NOT NULL
      ORDER BY d.response_payload->>'requestId',e.received_at DESC)
      SELECT request_id,event_name,COUNT(*) OVER() AS total FROM requests ORDER BY request_id LIMIT 60`,
          args,
        )
      : Promise.resolve([]),
  ])
  const rows = [...DISPATCHABLE_CANONICAL_EVENT_NAMES].map((event_name) => {
    const contract = CANONICAL_EVENT_CONTRACTS[event_name as CanonicalEventName]
    return {
      event_name,
      captured: count(events.find((row) => row.event_name === event_name)?.captured),
      valid: count(events.find((row) => row.event_name === event_name)?.valid),
      platforms: Object.fromEntries(
        MATRIX_DESTINATIONS.map((destination) => {
          const name = contract.destinations[destination]
          if (!name) return [destination, null]
          const row = dispatches.find((row) => row.event_name === event_name && row.destination === destination)
          const sent = count(row?.sent)
          const received = destination === 'ga4' ? null : count(row?.acknowledged)
          return [
            destination,
            {
              sent,
              received,
              unconfirmed: (received === null ? sent : Math.max(0, sent - received)) + count(row?.unknown_mode),
              unknown_mode: count(row?.unknown_mode),
              tests: count(row?.tests),
              provider_event_name: name,
            },
          ]
        }),
      ) as Record<ControlDestination, MatrixCell | null>,
    }
  })
  const providers: TrackingMatrix['providers'] = {}
  if (remote) {
    await Promise.all(
      MATRIX_DESTINATIONS.filter((d) => d !== 'pinterest').map(async (destination) => {
        providers[destination] = await readProviderEvidence(
          {
            destination,
            window: input.window,
            google_requests: requests
              .filter((r) => typeof r.request_id === 'string')
              .map((r) => ({ request_id: String(r.request_id), event_name: String(r.event_name) })),
            google_request_count: count(requests[0]?.total),
            google_limit: 60,
            counts_only: true,
          },
          env,
          fetcher,
        )
      }),
    )
  }
  return { window: input.window, generated_at: new Date().toISOString(), rows, providers, remote_loaded: remote }
}
