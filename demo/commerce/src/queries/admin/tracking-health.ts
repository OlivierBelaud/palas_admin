import {
  DISPATCHABLE_CANONICAL_EVENT_NAMES,
} from '../../modules/event-hub/canonical-contract'
import { type RawDb, resolveRawDb } from '../../utils/raw-db'
import {
  isTrackingHealthValid,
  trackingHealthValidationErrors,
  type DestinationSummary,
} from './tracking-health-validity'

type EventLogRow = {
  id: string
  event_id: string
  event_name: string
  source: string
  received_at: string | Date
  page_type: string | null
  market: string | null
  identity_muid: string | null
  identity_email_sha256: string | null
  distinct_id: string | null
  valid: boolean
  validation_errors: string[] | null
  payload_normalized: Record<string, unknown> | null
  total_count?: string | number
}

type DispatchLogRow = {
  event_id: string
  destination: string
  status: string
  http_status: number | null
  error_code: string | null
  error_message: string | null
  attempt_count: number
  sent_at: string | Date | null
  last_attempt_at: string | Date | null
}

type ContactRow = {
  id: string
  email: string
  distinct_id: string | null
}

type CartEmailRow = {
  id: string
  cart_token: string | null
  checkout_token: string | null
  distinct_id: string | null
  email: string | null
  updated_at: string | Date | null
}

type EventTypeRow = {
  event_name: string
  count: string | number
  valid: string | number
  invalid: string | number
  latest_at: string | Date | null
}

type StatRow = {
  total: string | number
  valid: string | number
  identified: string | number
  unique_distinct_ids: string | number
  unique_session_ids: string | number
  ga4_ready: string | number
  posthog_forwarded: string | number
  consent_analytics_granted: string | number
  consent_ads_granted: string | number
}

type StatusCountRow = {
  destination?: string
  status: string
  count: string | number
}

const DISPATCHABLE_EVENT_NAMES = Array.from(DISPATCHABLE_CANONICAL_EVENT_NAMES)
const TRACKING_HEALTH_VALID_SQL = `(
  COALESCE(jsonb_array_length(payload_normalized #> '{validation,errors}'), 0) = 0
  AND (
    COALESCE(payload_normalized #>> '{validation,destinations,ga4,supported}', 'false') <> 'true'
    OR COALESCE(payload_normalized #>> '{validation,destinations,ga4,ready}', 'false') = 'true'
  )
)`

export default defineQuery({
  name: 'tracking-health-loader',
  description: 'Live Event Hub hot log for the last 24 hours',
  input: z.object({
    hours: z.number().int().positive().max(24).default(4),
    limit: z.number().int().positive().max(200).default(50),
    offset: z.number().int().min(0).default(0),
    event_name: z.string().optional(),
  }),
  handler: async (input, ctx) => {
    return loadTrackingHealthData(input, resolveRawDb(ctx))
  },
})

export async function loadTrackingHealthData(
  input: { hours?: number; limit?: number; offset?: number; event_name?: string },
  db: RawDb,
) {
  const hours = input.hours ?? 4
  const limit = input.limit ?? 50
  const offset = input.offset ?? 0
  const to = new Date()
  const from = new Date(to.getTime() - hours * 60 * 60 * 1000)
  const eventName = input.event_name && input.event_name !== 'all' ? input.event_name : null

  const [rows, typeRows, statRows, dispatchStatRows] = await Promise.all([
    loadPageRows(db, from, to, eventName, limit, offset),
    loadEventTypes(db, from, to),
    loadStats(db, from, to, eventName),
    loadDestinationStatusCounts(db, from, to),
  ])
  const total = toNumber(rows[0]?.total_count)
  const stats = statRows[0] ?? emptyStats()
  const latestAt = latestEventAt(typeRows)

  const pageEventIds = rows.map((row) => row.event_id).filter(Boolean)
  const pageDispatchRows = pageEventIds.length > 0 ? await loadPageDispatches(db, pageEventIds) : []
  const dispatchByKey = new Map(pageDispatchRows.map((row) => [`${row.event_id}:${row.destination}`, row]))

  const contactIds = uniqueStrings(
    rows
      .map((row) => {
        const user = userPayload(row)
        return typeof user.contact_id === 'string' ? user.contact_id : null
      })
      .filter(Boolean) as string[],
  )
  const distinctIds = uniqueStrings(rows.map((row) => row.distinct_id).filter(Boolean) as string[])
  const cartTokens = uniqueStrings(
    rows
      .map((row) => {
        const cart = cartPayload(row)
        return typeof cart.token === 'string' ? cart.token : null
      })
      .filter(Boolean) as string[],
  )
  const checkoutTokens = uniqueStrings(
    rows
      .map((row) => {
        const checkout = checkoutPayload(row)
        return typeof checkout.token === 'string' ? checkout.token : null
      })
      .filter(Boolean) as string[],
  )

  const [contactsByIdRows, contactsByDistinctRows, cartsByTokenRows, cartsByCheckoutRows, cartsByDistinctRows] =
    await Promise.all([
      contactIds.length > 0 ? loadContactsById(db, contactIds) : Promise.resolve([]),
      distinctIds.length > 0 ? loadContactsByDistinctId(db, distinctIds) : Promise.resolve([]),
      cartTokens.length > 0 ? loadCartsByField(db, 'cart_token', cartTokens) : Promise.resolve([]),
      checkoutTokens.length > 0 ? loadCartsByField(db, 'checkout_token', checkoutTokens) : Promise.resolve([]),
      distinctIds.length > 0 ? loadCartsByField(db, 'distinct_id', distinctIds) : Promise.resolve([]),
    ])
  const contactById = new Map(contactsByIdRows.map((row) => [row.id, row]))
  const contactByDistinctId = new Map(
    contactsByDistinctRows.filter((row) => row.distinct_id).map((row) => [row.distinct_id as string, row]),
  )
  const cartEmailByToken = firstEmailBy(cartsByTokenRows, 'cart_token')
  const cartEmailByCheckoutToken = firstEmailBy(cartsByCheckoutRows, 'checkout_token')
  const cartEmailByDistinctId = firstEmailBy(cartsByDistinctRows, 'distinct_id')

  const events = rows.map((row) => {
    const payload = row.payload_normalized ?? {}
    const ecommerce = (payload.ecommerce ?? {}) as Record<string, unknown>
    const cart = cartPayload(row)
    const checkout = checkoutPayload(row)
    const user = userPayload(row)
    const consent = (payload.consent ?? {}) as Record<string, unknown>
    const dispatch = (payload.dispatch ?? {}) as Record<string, unknown>
    const validation = (payload.validation ?? {}) as Record<string, unknown>
    const validationDestinations = (validation.destinations ?? {}) as Record<string, unknown>
    const ga4Destination = destinationSummary('ga4', validationDestinations.ga4)
    const metaCapiDestination = destinationSummary('meta_capi', validationDestinations.meta_capi)
    const googleAdsDestination = destinationSummary('google_ads', validationDestinations.google_ads)
    const ga4 = (dispatch.ga4 ?? {}) as Record<string, unknown>
    const posthog = (dispatch.posthog ?? {}) as Record<string, unknown>
    const ga4Log = dispatchByKey.get(`${row.event_id}:ga4`)
    const metaCapiLog = dispatchByKey.get(`${row.event_id}:meta_capi`)
    const googleAdsLog = dispatchByKey.get(`${row.event_id}:google_ads`)
    const contactId = typeof user.contact_id === 'string' ? user.contact_id : null
    const cartToken = typeof cart.token === 'string' ? cart.token : null
    const checkoutToken = typeof checkout.token === 'string' ? checkout.token : null
    const directEmail = typeof user.email === 'string' ? user.email : null
    const email =
      directEmail ??
      (contactId ? contactById.get(contactId)?.email : null) ??
      (cartToken ? cartEmailByToken.get(cartToken) : null) ??
      (checkoutToken ? cartEmailByCheckoutToken.get(checkoutToken) : null) ??
      (row.distinct_id ? cartEmailByDistinctId.get(row.distinct_id) : null) ??
      (row.distinct_id ? contactByDistinctId.get(row.distinct_id)?.email : null) ??
      null
    const hasEmailHash = Boolean(row.identity_email_sha256 || user.email_sha256)
    return {
      id: row.id,
      event_id: row.event_id,
      event_name: row.event_name,
      raw_event_name: typeof payload.raw_event_name === 'string' ? payload.raw_event_name : row.event_name,
      source: row.source,
      received_at: new Date(row.received_at).toISOString(),
      page_type: row.page_type,
      market: row.market,
      identity: user.contact_id
        ? 'contact'
        : row.identity_email_sha256
          ? 'email'
          : row.identity_muid
            ? 'muid'
            : row.distinct_id
              ? 'posthog'
              : 'anon',
      profile_tracking_id:
        contactId ??
        row.identity_muid ??
        (row.distinct_id ? `posthog:${row.distinct_id}` : null) ??
        (row.identity_email_sha256 ? `sha256:${row.identity_email_sha256}` : null),
      distinct_id: row.distinct_id,
      session_id: typeof user.session_id === 'string' ? user.session_id : null,
      identity_source: typeof user.identity_source === 'string' ? user.identity_source : null,
      contact_id: contactId,
      email: email ?? null,
      email_status: email ? 'resolved' : hasEmailHash ? 'hashed' : 'unknown',
      matched_v1: user.matched_v1 === true,
      consent: {
        analytics_storage: consent.analytics_storage === true,
        ad_storage: consent.ad_storage === true,
        ad_user_data: consent.ad_user_data === true,
        ad_personalization: consent.ad_personalization === true,
        source: typeof consent.source === 'string' ? consent.source : 'unknown',
      },
      valid: isTrackingHealthValid(validation, ga4Destination),
      validation_errors: trackingHealthValidationErrors(validation, ga4Destination),
      value: ecommerce.value ?? null,
      currency: ecommerce.currency ?? null,
      item_count: ecommerce.item_count ?? null,
      cart_token: cartToken,
      checkout_token: checkoutToken,
      shopify_order_id: checkout.shopify_order_id ?? null,
      posthog_status: typeof posthog.status === 'string' ? posthog.status : 'unknown',
      posthog_http_status: typeof posthog.http_status === 'number' ? posthog.http_status : null,
      ga4_ready: ga4Destination.supported
        ? ga4Log
          ? ['pending', 'sending', 'sent', 'retry'].includes(ga4Log.status)
          : ga4.ready === true
        : false,
      ga4_status: ga4Destination.supported
        ? (ga4Log?.status ?? (typeof ga4.status === 'string' ? ga4.status : 'not_configured'))
        : 'unsupported',
      ga4_http_status: ga4Log?.http_status ?? null,
      ga4_error_code: ga4Log?.error_code ?? null,
      ga4_error_message: ga4Log?.error_message ?? null,
      ga4_attempt_count: ga4Log?.attempt_count ?? 0,
      ga4_sent_at: ga4Log?.sent_at ? new Date(ga4Log.sent_at).toISOString() : null,
      meta_ready: metaCapiDestination.supported
        ? metaCapiLog
          ? ['pending', 'sending', 'sent', 'retry'].includes(metaCapiLog.status)
          : metaCapiDestination.ready === true
        : false,
      meta_status: metaCapiDestination.supported ? (metaCapiLog?.status ?? 'pending') : 'unsupported',
      meta_http_status: metaCapiLog?.http_status ?? null,
      meta_error_code: metaCapiLog?.error_code ?? null,
      meta_error_message: metaCapiLog?.error_message ?? null,
      meta_attempt_count: metaCapiLog?.attempt_count ?? 0,
      meta_sent_at: metaCapiLog?.sent_at ? new Date(metaCapiLog.sent_at).toISOString() : null,
      meta_blockers: metaCapiDestination.blockers,
      google_ads_ready: googleAdsDestination.supported
        ? googleAdsLog
          ? ['pending', 'sending', 'sent', 'retry'].includes(googleAdsLog.status)
          : googleAdsDestination.ready === true
        : false,
      google_ads_status: googleAdsDestination.supported ? (googleAdsLog?.status ?? 'pending') : 'unsupported',
      google_ads_http_status: googleAdsLog?.http_status ?? null,
      google_ads_error_code: googleAdsLog?.error_code ?? null,
      google_ads_error_message: googleAdsLog?.error_message ?? null,
      google_ads_attempt_count: googleAdsLog?.attempt_count ?? 0,
      google_ads_sent_at: googleAdsLog?.sent_at ? new Date(googleAdsLog.sent_at).toISOString() : null,
      google_ads_blockers: googleAdsDestination.blockers,
    }
  })

  const valid = toNumber(stats.valid)
  const identified = toNumber(stats.identified)
  const statusCounts = countByDestinationStatus(dispatchStatRows)
  const ga4StatusCounts = statusCounts.get('ga4') ?? new Map<string, number>()
  const metaStatusCounts = statusCounts.get('meta_capi') ?? new Map<string, number>()
  return {
    meta: {
      range: { from: from.toISOString(), to: to.toISOString() },
      generated_at: new Date().toISOString(),
      latest_event_at: latestAt,
      retention_hours: hours,
      pagination: {
        limit,
        offset,
        total,
        page: Math.floor(offset / limit) + 1,
        page_count: Math.max(1, Math.ceil(total / limit)),
      },
    },
    kpis: {
      total,
      valid,
      invalid: total - valid,
      identified,
      anonymous: total - identified,
      unique_distinct_ids: toNumber(stats.unique_distinct_ids),
      unique_session_ids: toNumber(stats.unique_session_ids),
      ga4_ready: toNumber(stats.ga4_ready),
      ga4_pending: countStatus(ga4StatusCounts, 'pending') + countStatus(ga4StatusCounts, 'retry'),
      ga4_sent: countStatus(ga4StatusCounts, 'sent'),
      ga4_invalid: countStatus(ga4StatusCounts, 'invalid'),
      ga4_error:
        countStatus(ga4StatusCounts, 'error') +
        countStatus(ga4StatusCounts, 'not_configured') +
        countStatus(ga4StatusCounts, 'sending'),
      meta_pending: countStatus(metaStatusCounts, 'pending') + countStatus(metaStatusCounts, 'retry'),
      meta_sent: countStatus(metaStatusCounts, 'sent'),
      meta_invalid: countStatus(metaStatusCounts, 'invalid'),
      meta_error:
        countStatus(metaStatusCounts, 'error') +
        countStatus(metaStatusCounts, 'not_configured') +
        countStatus(metaStatusCounts, 'sending'),
      posthog_forwarded: toNumber(stats.posthog_forwarded),
      consent_analytics_granted: toNumber(stats.consent_analytics_granted),
      consent_analytics_denied: total - toNumber(stats.consent_analytics_granted),
      consent_ads_granted: toNumber(stats.consent_ads_granted),
      consent_ads_denied: total - toNumber(stats.consent_ads_granted),
    },
    event_types: typeRows.map((row) => ({
      event_name: row.event_name,
      count: toNumber(row.count),
      valid: toNumber(row.valid),
      invalid: toNumber(row.invalid),
      latest_at: row.latest_at ? new Date(row.latest_at).toISOString() : null,
    })),
    events,
  }
}

function loadPageRows(db: RawDb, from: Date, to: Date, eventName: string | null, limit: number, offset: number) {
  return db.raw<EventLogRow>(
    `SELECT id, event_id, event_name, source, received_at, page_type, market,
            identity_muid, identity_email_sha256, distinct_id, ${TRACKING_HEALTH_VALID_SQL} AS valid,
            validation_errors, payload_normalized, COUNT(*) OVER()::text AS total_count
       FROM event_logs
      WHERE deleted_at IS NULL
        AND received_at >= $1
        AND received_at <= $2
        AND event_name = ANY($3::text[])
        AND ($4::text IS NULL OR event_name = $4)
      ORDER BY received_at DESC
      LIMIT $5 OFFSET $6`,
    [from.toISOString(), to.toISOString(), DISPATCHABLE_EVENT_NAMES, eventName, limit, offset],
  )
}

function loadEventTypes(db: RawDb, from: Date, to: Date) {
  return db.raw<EventTypeRow>(
    `SELECT event_name,
            COUNT(*)::text AS count,
            COUNT(*) FILTER (WHERE ${TRACKING_HEALTH_VALID_SQL})::text AS valid,
            COUNT(*) FILTER (WHERE NOT ${TRACKING_HEALTH_VALID_SQL})::text AS invalid,
            MAX(received_at) AS latest_at
       FROM event_logs
      WHERE deleted_at IS NULL
        AND received_at >= $1
        AND received_at <= $2
        AND event_name = ANY($3::text[])
      GROUP BY event_name
      ORDER BY COUNT(*) DESC, event_name ASC`,
    [from.toISOString(), to.toISOString(), DISPATCHABLE_EVENT_NAMES],
  )
}

function loadStats(db: RawDb, from: Date, to: Date, eventName: string | null) {
  return db.raw<StatRow>(
    `SELECT COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE ${TRACKING_HEALTH_VALID_SQL})::text AS valid,
            COUNT(*) FILTER (
              WHERE payload_normalized #>> '{user,contact_id}' IS NOT NULL
                 OR identity_email_sha256 IS NOT NULL
                 OR identity_muid IS NOT NULL
                 OR distinct_id IS NOT NULL
            )::text AS identified,
            COUNT(DISTINCT distinct_id)::text AS unique_distinct_ids,
            COUNT(DISTINCT payload_normalized #>> '{user,session_id}')::text AS unique_session_ids,
            COUNT(*) FILTER (WHERE payload_normalized #>> '{dispatch,ga4,ready}' = 'true')::text AS ga4_ready,
            COUNT(*) FILTER (WHERE payload_normalized #>> '{dispatch,posthog,status}' = 'forwarded')::text AS posthog_forwarded,
            COUNT(*) FILTER (WHERE payload_normalized #>> '{consent,analytics_storage}' = 'true')::text
              AS consent_analytics_granted,
            COUNT(*) FILTER (
              WHERE payload_normalized #>> '{consent,ad_storage}' = 'true'
                AND payload_normalized #>> '{consent,ad_user_data}' = 'true'
                AND payload_normalized #>> '{consent,ad_personalization}' = 'true'
            )::text AS consent_ads_granted
       FROM event_logs
      WHERE deleted_at IS NULL
        AND received_at >= $1
        AND received_at <= $2
        AND event_name = ANY($3::text[])
        AND ($4::text IS NULL OR event_name = $4)`,
    [from.toISOString(), to.toISOString(), DISPATCHABLE_EVENT_NAMES, eventName],
  )
}

function loadDestinationStatusCounts(db: RawDb, from: Date, to: Date) {
  return db.raw<StatusCountRow>(
    `SELECT destination, status, COUNT(*)::text AS count
       FROM dispatch_logs
      WHERE deleted_at IS NULL
        AND destination = ANY($3::text[])
        AND event_received_at >= $1
        AND event_received_at <= $2
      GROUP BY destination, status`,
    [from.toISOString(), to.toISOString(), ['ga4', 'meta_capi', 'google_ads']],
  )
}

function loadPageDispatches(db: RawDb, eventIds: string[]) {
  return db.raw<DispatchLogRow>(
    `SELECT event_id, destination, status, http_status, error_code, error_message,
            attempt_count, sent_at, last_attempt_at
       FROM dispatch_logs
      WHERE deleted_at IS NULL
        AND destination = ANY($2::text[])
        AND event_id = ANY($1::text[])
      ORDER BY event_received_at DESC`,
    [eventIds, ['ga4', 'meta_capi', 'google_ads']],
  )
}

function loadContactsById(db: RawDb, ids: string[]) {
  return db.raw<ContactRow>(
    `SELECT id, email, distinct_id
       FROM contacts
      WHERE deleted_at IS NULL
        AND id = ANY($1::uuid[])`,
    [ids],
  )
}

function loadContactsByDistinctId(db: RawDb, distinctIds: string[]) {
  return db.raw<ContactRow>(
    `SELECT id, email, distinct_id
       FROM contacts
      WHERE deleted_at IS NULL
        AND distinct_id = ANY($1::text[])`,
    [distinctIds],
  )
}

function loadCartsByField(db: RawDb, field: 'cart_token' | 'checkout_token' | 'distinct_id', values: string[]) {
  return db.raw<CartEmailRow>(
    `SELECT id, cart_token, checkout_token, distinct_id, email, updated_at
       FROM carts
      WHERE deleted_at IS NULL
        AND ${field} = ANY($1::text[])
      ORDER BY updated_at DESC
      LIMIT 1000`,
    [values],
  )
}

function emptyStats(): StatRow {
  return {
    total: 0,
    valid: 0,
    identified: 0,
    unique_distinct_ids: 0,
    unique_session_ids: 0,
    ga4_ready: 0,
    posthog_forwarded: 0,
    consent_analytics_granted: 0,
    consent_ads_granted: 0,
  }
}

function countByDestinationStatus(rows: StatusCountRow[]) {
  const map = new Map<string, Map<string, number>>()
  for (const row of rows) {
    const destination = row.destination ?? 'unknown'
    const destinationMap = map.get(destination) ?? new Map<string, number>()
    destinationMap.set(row.status, toNumber(row.count))
    map.set(destination, destinationMap)
  }
  return map
}

function countStatus(map: Map<string, number>, status: string) {
  return map.get(status) ?? 0
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function userPayload(row: EventLogRow): Record<string, unknown> {
  return (row.payload_normalized?.user ?? {}) as Record<string, unknown>
}

function cartPayload(row: EventLogRow): Record<string, unknown> {
  return (row.payload_normalized?.cart ?? {}) as Record<string, unknown>
}

function checkoutPayload(row: EventLogRow): Record<string, unknown> {
  return (row.payload_normalized?.checkout ?? {}) as Record<string, unknown>
}

function firstEmailBy(
  rows: CartEmailRow[],
  field: 'cart_token' | 'checkout_token' | 'distinct_id',
): Map<string, string> {
  const map = new Map<string, string>()
  const sorted = [...rows].sort((a, b) => timeValue(b.updated_at) - timeValue(a.updated_at))
  for (const row of sorted) {
    const key = row[field]
    const email = normalizeEmail(row.email)
    if (key && email && !map.has(key)) map.set(key, email)
  }
  return map
}

function latestEventAt(rows: EventTypeRow[]): string | null {
  let latest: string | null = null
  for (const row of rows) {
    if (!row.latest_at) continue
    const value = new Date(row.latest_at).toISOString()
    if (!latest || value > latest) latest = value
  }
  return latest
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email.includes('@') ? email : null
}

function timeValue(value: string | Date | null): number {
  if (!value) return 0
  return new Date(value).getTime()
}

function toNumber(value: number | string | null | undefined): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0
  return Number.isFinite(n) ? n : 0
}

function destinationSummary(destination: string, value: unknown): DestinationSummary {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  return {
    destination,
    supported: row.supported === true,
    ready: row.ready === true,
    blockers: Array.isArray(row.blockers)
      ? row.blockers.filter((item): item is string => typeof item === 'string')
      : [],
  }
}
