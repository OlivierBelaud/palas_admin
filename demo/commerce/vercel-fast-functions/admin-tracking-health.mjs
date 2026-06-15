import { clampInt, db, iso, json, nowMs, requireAdmin, timingHeader, toNumber, unauthorized } from './runtime.mjs'

const DISPATCHABLE_EVENT_NAMES = [
  'page_view',
  'view_item_list',
  'view_item',
  'search',
  'add_to_cart',
  'remove_from_cart',
  'view_cart',
  'begin_checkout',
  'add_contact_info',
  'add_shipping_info',
  'add_payment_info',
  'purchase',
]

const GA4_EVENT_NAMES = [
  'page_view',
  'view_item_list',
  'view_item',
  'search',
  'add_to_cart',
  'remove_from_cart',
  'view_cart',
  'begin_checkout',
  'add_shipping_info',
  'add_payment_info',
  'purchase',
]

export default {
  async fetch(req) {
    const started = nowMs()
    const auth = requireAdmin(req)
    if (!auth) return unauthorized()
    const authDone = nowMs()

    const url = new URL(req.url)
    const hours = clampInt(url.searchParams.get('hours'), 4, 1, 24)
    const limit = clampInt(url.searchParams.get('limit'), 50, 1, 200)
    const offset = clampInt(url.searchParams.get('offset'), 0, 0, 100_000)
    const eventName = url.searchParams.get('event_name')
    const filterEventName = eventName && eventName !== 'all' ? eventName : null
    const to = new Date()
    const from = new Date(to.getTime() - hours * 60 * 60 * 1000)

    const [rows, typeRows, statRows, dispatchStatRows] = await Promise.all([
      loadPageRows(from, to, filterEventName, limit, offset),
      loadEventTypes(from, to),
      loadStats(from, to, filterEventName),
      loadGa4StatusCounts(from, to),
    ])
    const queryDone = nowMs()

    const pageEventIds = rows.map((row) => row.event_id).filter(Boolean)
    const pageDispatchRows = pageEventIds.length > 0 ? await loadPageDispatches(pageEventIds) : []
    const dispatchDone = nowMs()

    const dispatchByEventId = new Map(pageDispatchRows.map((row) => [row.event_id, row]))
    const stats = statRows[0] ?? emptyStats()
    const total = toNumber(rows[0]?.total_count)
    const ga4StatusCounts = countByStatus(dispatchStatRows)
    const valid = toNumber(stats.valid)
    const identified = toNumber(stats.identified)
    const data = {
      meta: {
        range: { from: from.toISOString(), to: to.toISOString() },
        generated_at: new Date().toISOString(),
        latest_event_at: latestEventAt(typeRows),
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
        latest_at: row.latest_at ? iso(row.latest_at) : null,
      })),
      events: rows.map((row) => eventDto(row, dispatchByEventId.get(row.event_id))),
    }
    const serializeDone = nowMs()

    return json(
      { data },
      {
        headers: {
          'server-timing': timingHeader({
            auth: authDone - started,
            query: queryDone - authDone,
            dispatch: dispatchDone - queryDone,
            serialize: serializeDone - dispatchDone,
            total: serializeDone - started,
          }),
        },
      },
    )
  },
}

function loadPageRows(from, to, eventName, limit, offset) {
  return db().unsafe(
    `SELECT id, event_id, event_name, source, received_at, page_type, market,
            identity_muid, identity_email_sha256, distinct_id, valid,
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

function loadEventTypes(from, to) {
  return db().unsafe(
    `SELECT event_name,
            COUNT(*)::text AS count,
            COUNT(*) FILTER (WHERE valid)::text AS valid,
            COUNT(*) FILTER (WHERE NOT valid)::text AS invalid,
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

function loadStats(from, to, eventName) {
  return db().unsafe(
    `SELECT COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE valid)::text AS valid,
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

function loadGa4StatusCounts(from, to) {
  return db().unsafe(
    `SELECT status, COUNT(*)::text AS count
      FROM dispatch_logs
      WHERE deleted_at IS NULL
        AND destination = 'ga4'
        AND canonical_event_name = ANY($3::text[])
        AND event_received_at >= $1
        AND event_received_at <= $2
      GROUP BY status`,
    [from.toISOString(), to.toISOString(), GA4_EVENT_NAMES],
  )
}

function loadPageDispatches(eventIds) {
  return db().unsafe(
    `SELECT event_id, destination, status, http_status, error_code, error_message,
            attempt_count, sent_at, last_attempt_at
       FROM dispatch_logs
      WHERE deleted_at IS NULL
        AND destination = 'ga4'
        AND event_id = ANY($1::text[])
      ORDER BY event_received_at DESC`,
    [eventIds],
  )
}

function eventDto(row, ga4Log) {
  const payload = row.payload_normalized ?? {}
  const ecommerce = payload.ecommerce ?? {}
  const cart = payload.cart ?? {}
  const checkout = payload.checkout ?? {}
  const user = payload.user ?? {}
  const consent = payload.consent ?? {}
  const dispatch = payload.dispatch ?? {}
  const validation = payload.validation ?? {}
  const validationDestinations = validation.destinations ?? {}
  const ga4Destination = destinationSummary('ga4', validationDestinations.ga4)
  const ga4 = dispatch.ga4 ?? {}
  const posthog = dispatch.posthog ?? {}
  const contactId = typeof user.contact_id === 'string' ? user.contact_id : null
  const hasEmailHash = Boolean(row.identity_email_sha256 || user.email_sha256)

  return {
    id: row.id,
    event_id: row.event_id,
    event_name: row.event_name,
    raw_event_name: typeof payload.raw_event_name === 'string' ? payload.raw_event_name : row.event_name,
    source: row.source,
    received_at: iso(row.received_at),
    page_type: row.page_type,
    market: row.market,
    identity: contactId
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
    email: typeof user.email === 'string' ? user.email : null,
    email_status: typeof user.email === 'string' ? 'resolved' : hasEmailHash ? 'hashed' : 'unknown',
    matched_v1: user.matched_v1 === true,
    consent: {
      analytics_storage: consent.analytics_storage === true,
      ad_storage: consent.ad_storage === true,
      ad_user_data: consent.ad_user_data === true,
      ad_personalization: consent.ad_personalization === true,
      source: typeof consent.source === 'string' ? consent.source : 'unknown',
    },
    valid: row.valid,
    validation_errors: Array.isArray(row.validation_errors) ? row.validation_errors : [],
    value: ecommerce.value ?? null,
    currency: ecommerce.currency ?? null,
    item_count: ecommerce.item_count ?? null,
    cart_token: typeof cart.token === 'string' ? cart.token : null,
    checkout_token: typeof checkout.token === 'string' ? checkout.token : null,
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
    ga4_sent_at: ga4Log?.sent_at ? iso(ga4Log.sent_at) : null,
    ad_destinations: ['meta_capi', 'google_ads', 'tiktok']
      .map((destination) => destinationSummary(destination, validationDestinations[destination]))
      .filter((destination) => destination.supported),
  }
}

function emptyStats() {
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

function countByStatus(rows) {
  const map = new Map()
  for (const row of rows) map.set(row.status, toNumber(row.count))
  return map
}

function countStatus(map, status) {
  return map.get(status) ?? 0
}

function latestEventAt(rows) {
  let latest = null
  for (const row of rows) {
    if (!row.latest_at) continue
    const value = iso(row.latest_at)
    if (!latest || value > latest) latest = value
  }
  return latest
}

function destinationSummary(destination, value) {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    destination,
    supported: row.supported === true,
    ready: row.ready === true,
    blockers: Array.isArray(row.blockers) ? row.blockers.filter((item) => typeof item === 'string') : [],
  }
}
