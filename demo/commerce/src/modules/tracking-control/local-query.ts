import type { RawDb } from '../../utils/raw-db'
import {
  CANONICAL_EVENT_CONTRACTS,
  type CanonicalEventName,
  DISPATCHABLE_CANONICAL_EVENT_NAMES,
} from '../event-hub/canonical-contract'
import { calendarWindow, earliestParisDate } from './calendar'
import type { ControlDestination, ControlReceipt, ControlWindow, LocalControl, ProviderReadInput } from './types'

export class ControlInputError extends Error {}
export type ControlInput = { destination: ControlDestination; window: ControlWindow }
const DAY_MS = 86_400_000
const RECENT_LIMIT = 50
const GOOGLE_LIMIT = 60
const DESTINATIONS = new Set(['meta_capi', 'google_ads', 'pinterest', 'ga4'])

export function parseControlRequest(params: URLSearchParams, now = new Date()): ControlInput {
  const destination = params.get('destination')
  if (!destination || !DESTINATIONS.has(destination)) throw new ControlInputError('Destination inconnue.')
  if (params.has('date')) {
    if (['hours', 'from', 'to'].some((key) => params.has(key)))
      throw new ControlInputError('Choisissez une journée ou une durée.')
    const window = calendarWindow(params.get('date')!, now)
    if (!window)
      throw new ControlInputError('Choisissez une journée valide parmi les sept derniers jours, en heure de Paris.')
    return { destination: destination as ControlDestination, window }
  }
  const start = params.get('from')
  const end = params.get('to')
  let from: Date
  let to: Date
  if (start !== null || end !== null) {
    if (!start || !end || params.has('hours')) throw new ControlInputError('Choisissez une durée ou deux dates.')
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/
    if (!iso.test(start) || !iso.test(end))
      throw new ControlInputError('Les dates doivent inclure leur fuseau horaire.')
    for (const value of [start, end]) {
      const day = new Date(`${value.slice(0, 10)}T00:00:00Z`)
      if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10)) {
        throw new ControlInputError('Date invalide.')
      }
    }
    from = new Date(start)
    to = new Date(end)
  } else {
    const hours = Number(params.get('hours') ?? 4)
    if (!Number.isInteger(hours) || hours < 1 || hours > 24)
      throw new ControlInputError('Durée attendue : 1 à 24 heures.')
    to = now
    from = new Date(now.getTime() - hours * 3_600_000)
  }
  if (
    !Number.isFinite(from.getTime()) ||
    !Number.isFinite(to.getTime()) ||
    from >= to ||
    to.getTime() > now.getTime() ||
    from.getTime() <
      (params.get('view') === 'matrix'
        ? Date.parse(calendarWindow(earliestParisDate(now), now)!.from)
        : now.getTime() - DAY_MS) ||
    to.getTime() - from.getTime() > (params.get('view') === 'matrix' ? 25 : 24) * 3_600_000
  ) {
    throw new ControlInputError(
      params.get('view') === 'matrix'
        ? 'Choisissez un intervalle passé de 25 heures maximum parmi les sept derniers jours.'
        : 'Choisissez un intervalle passé, dans les dernières 24 heures.',
    )
  }
  return {
    destination: destination as ControlDestination,
    window: { from: from.toISOString(), to: to.toISOString(), timezone: 'UTC' },
  }
}

type Row = Record<string, unknown>
function count(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : 0
}
function date(value: unknown): string | null {
  if (value == null) return null
  const d = new Date(value as string)
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}
function providerName(event: string, destination: ControlDestination): string | null {
  return CANONICAL_EVENT_CONTRACTS[event as CanonicalEventName]?.destinations[destination] ?? null
}
function statuses(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(
    ['pending', 'sending', 'sent', 'validated', 'invalid', 'error', 'retry', 'not_configured']
      .filter((key) => key in value)
      .map((key) => [key, count((value as Row)[key])]),
  )
}

export async function loadLocalControl(
  input: ControlInput,
  db: RawDb,
): Promise<{ local: LocalControl; providerInput: ProviderReadInput }> {
  const { destination, window } = input
  const args = [window.from, window.to, destination, Array.from(DISPATCHABLE_CANONICAL_EVENT_NAMES)]
  // This cohort remains independent of the send-time series below. One persisted
  // dispatch per event/destination means retries never inflate distinct counts.
  const [cohort, sends, recent, totals, google] = await Promise.all([
    db.raw<Row>(
      `/* control:cohort */
      WITH cohort AS (
        SELECT e.event_name, d.status,
          e.payload_normalized #>> ARRAY['validation','destinations',$3::text,'ready'] AS ready,
          e.payload_normalized #>> ARRAY['validation','destinations',$3::text,'supported'] AS supported,
          d.event_id AS dispatch_id
        FROM event_logs e LEFT JOIN dispatch_logs d ON d.event_id = e.event_id AND d.destination = $3
        WHERE e.received_at >= $1::timestamptz AND e.received_at < $2::timestamptz AND e.event_name = ANY($4::text[])
      ), grouped AS (
        SELECT event_name, COUNT(*) AS captured,
          COUNT(*) FILTER (WHERE ready = 'true') AS eligible,
          COUNT(*) FILTER (WHERE ready = 'false' OR supported = 'false') AS excluded,
          COUNT(*) FILTER (WHERE ready IS NULL AND supported IS DISTINCT FROM 'false') AS unknown_eligibility,
          COUNT(*) FILTER (WHERE ready = 'true' AND dispatch_id IS NULL) AS missing_dispatch
        FROM cohort GROUP BY event_name
      ), status_counts AS (
        SELECT event_name, jsonb_object_agg(status, n) AS statuses FROM (
          SELECT event_name, status, COUNT(*) AS n FROM cohort WHERE status IS NOT NULL GROUP BY event_name, status
        ) counts GROUP BY event_name
      ) SELECT grouped.*, COALESCE(status_counts.statuses, '{}'::jsonb) AS statuses
        FROM grouped LEFT JOIN status_counts USING (event_name) ORDER BY captured DESC, event_name`,
      args,
    ),
    db.raw<Row>(
      `/* control:sends */ SELECT canonical_event_name AS event_name, COUNT(*) AS count
      FROM dispatch_logs WHERE sent_at >= $1::timestamptz AND sent_at < $2::timestamptz
        AND destination = $3 AND canonical_event_name = ANY($4::text[]) AND status = 'sent'
      GROUP BY canonical_event_name ORDER BY count DESC, canonical_event_name`,
      args,
    ),
    db.raw<Row>(
      `/* control:recent */ SELECT event_id, canonical_event_name AS event_name, status, attempt_count,
      event_received_at AS received_at, last_attempt_at, sent_at, http_status, error_code,
      (response_payload IS NOT NULL) AS details_available,
      CASE WHEN status = 'validated' OR (destination = 'ga4' AND response_payload ? 'validationMessages') THEN 'validation_only'
        WHEN status = 'sent' AND destination IN ('meta_capi','pinterest','google_ads') THEN 'acknowledged'
        WHEN http_status IS NOT NULL THEN 'http_response' ELSE 'unknown' END AS receipt_kind
      FROM dispatch_logs WHERE event_received_at >= $1::timestamptz AND event_received_at < $2::timestamptz
        AND destination = $3 AND canonical_event_name = ANY($4::text[])
      ORDER BY event_received_at DESC, event_id LIMIT ${RECENT_LIMIT}`,
      args,
    ),
    db.raw<Row>(
      `/* control:counts */ SELECT COUNT(*) AS receipt_count,
      COUNT(DISTINCT response_payload->>'requestId') FILTER (WHERE status = 'sent' AND destination = 'google_ads') AS google_request_count
      FROM dispatch_logs WHERE event_received_at >= $1::timestamptz AND event_received_at < $2::timestamptz
        AND destination = $3 AND canonical_event_name = ANY($4::text[])`,
      args,
    ),
    destination === 'google_ads'
      ? db.raw<Row>(
          `/* control:google */ SELECT DISTINCT ON (response_payload->>'requestId')
      response_payload->>'requestId' AS request_id, canonical_event_name AS event_name
      FROM dispatch_logs WHERE event_received_at >= $1::timestamptz AND event_received_at < $2::timestamptz
        AND destination = $3 AND canonical_event_name = ANY($4::text[]) AND status = 'sent'
        AND response_payload->>'requestId' IS NOT NULL
      ORDER BY response_payload->>'requestId', event_received_at DESC LIMIT ${GOOGLE_LIMIT}`,
          args,
        )
      : Promise.resolve([]),
  ])
  return {
    local: {
      basis: 'event_received_at',
      rows: cohort.map((row) => ({
        event_name: String(row.event_name),
        provider_event_name: providerName(String(row.event_name), destination),
        captured: count(row.captured),
        eligible: count(row.eligible),
        excluded: count(row.excluded),
        unknown_eligibility: count(row.unknown_eligibility),
        missing_dispatch: count(row.missing_dispatch),
        statuses: statuses(row.statuses),
      })),
      sent_in_window: sends.map((row) => ({
        event_name: String(row.event_name),
        provider_event_name: providerName(String(row.event_name), destination),
        count: count(row.count),
      })),
      recent: recent.map((row) => ({
        event_id: String(row.event_id),
        event_name: String(row.event_name),
        status: String(row.status),
        attempt_count: count(row.attempt_count),
        received_at: date(row.received_at)!,
        last_attempt_at: date(row.last_attempt_at),
        sent_at: date(row.sent_at),
        http_status: row.http_status == null ? null : count(row.http_status),
        error_code:
          typeof row.error_code === 'string' &&
          /^(ga4|meta_capi|google_ads|pinterest)_[a-z0-9_]{1,100}$/.test(row.error_code)
            ? row.error_code
            : null,
        receipt_kind: ['acknowledged', 'validation_only', 'http_response'].includes(String(row.receipt_kind))
          ? (row.receipt_kind as ControlReceipt['receipt_kind'])
          : 'unknown',
        details_available: row.details_available === true,
      })),
      receipt_count: count(totals[0]?.receipt_count),
      recent_limit: RECENT_LIMIT,
      detail_retention_hours: 24,
      limitations: [
        'Les statuts sont ceux observés maintenant pour les événements reçus dans la période, pas un état historique à sa fin.',
        'La série des envois utilise sent_at : elle peut inclure des événements reçus avant la période. Les nouvelles tentatives ne sont pas de nouveaux événements.',
        'Les détails peuvent être allégés après 24 h. Une absence de réponse enregistrée ne prouve pas un échec.',
        'Les événements exclus ou dont la préparation est inconnue ne sont pas assimilés à des pertes.',
        ...(destination === 'ga4'
          ? [
              'Pour GA4, sent indique un succès HTTP, y compris en validation. Cela ne prouve pas une collecte dans les rapports.',
            ]
          : []),
      ],
    },
    providerInput: {
      destination,
      window,
      google_requests: google
        .filter((row) => typeof row.request_id === 'string' && row.request_id.length <= 512)
        .map((row) => ({
          request_id: String(row.request_id),
          event_name: String(row.event_name),
        })),
      google_limit: GOOGLE_LIMIT,
      google_request_count: count(totals[0]?.google_request_count),
    },
  }
}
