import { GA4_CANONICAL_EVENT_NAMES } from './canonical-contract'
import type { DestinationConnector, DispatchSendResult, DispatchStatus } from './destination-connector'
import type { RawDispatchDb } from './dispatch-runner'

export type Ga4DispatchStatus = DispatchStatus

export type Ga4Config = {
  measurementId: string | null
  apiSecret: string | null
  endpoint: string
  debug: boolean
}

export type Ga4MapResult =
  | { ok: true; payload: Record<string, unknown>; metadata: Record<string, unknown> }
  | { ok: false; errors: string[]; payload: Record<string, unknown>; metadata: Record<string, unknown> }

export type Ga4SendResult = DispatchSendResult

type MissingGa4DispatchRow = {
  event_id: string
  event_name: string
  source_event_name: string | null
  received_at: Date | string
  payload_normalized: Record<string, unknown> | string | null
}

export type EnsureMissingGa4DispatchLogsResult = {
  scanned: number
  inserted: number
  invalid: number
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function str(value: unknown, max = 2048): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max) return null
  return trimmed
}

function idStr(value: unknown, max = 160): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value)).slice(0, max)
  return str(value, max)
}

function num(value: unknown): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function int(value: unknown): number | null {
  const n = num(value)
  return n == null ? null : Math.trunc(n)
}

function compact<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value != null && value !== ''))
}

function isSha256(value: string | null): value is string {
  return Boolean(value && /^[a-f0-9]{64}$/i.test(value))
}

export function getGa4Config(env: NodeJS.ProcessEnv = process.env): Ga4Config {
  const debug = !(env.GA4_DEBUG === 'false' || env.GOOGLE_ANALYTICS_DEBUG === 'false')
  return {
    measurementId: env.GA4_MEASUREMENT_ID ?? env.GOOGLE_ANALYTICS_MEASUREMENT_ID ?? null,
    apiSecret: env.GA4_API_SECRET ?? env.GOOGLE_ANALYTICS_API_SECRET ?? null,
    endpoint:
      env.GA4_ENDPOINT ??
      (debug ? 'https://www.google-analytics.com/debug/mp/collect' : 'https://www.google-analytics.com/mp/collect'),
    debug,
  }
}

export function isGa4Configured(config: Ga4Config = getGa4Config()) {
  return Boolean(config.measurementId && config.apiSecret)
}

export function gaClientIdFromCookie(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  const match = trimmed.match(/^GA\d+\.\d+\.(\d+\.\d+)$/)
  if (match?.[1]) return match[1]
  return /^\d+\.\d+$/.test(trimmed) ? trimmed : null
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null
  const parts = header.split(';')
  for (const part of parts) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const key = part.slice(0, idx).trim()
    if (key !== name) continue
    return decodeURIComponent(part.slice(idx + 1).trim())
  }
  return null
}

export function ga4ContextFromHeaders(headers: Headers): Record<string, unknown> {
  const cookie = headers.get('cookie')
  return compact({
    ga_client_id: gaClientIdFromCookie(readCookie(cookie, '_ga')),
    fbp: readCookie(cookie, '_fbp'),
    fbc: readCookie(cookie, '_fbc'),
    gclid: readCookie(cookie, 'gclid') || readCookie(cookie, '_gcl_aw'),
    user_agent: headers.get('user-agent'),
    client_ip: headers.get('x-forwarded-for') ?? headers.get('x-real-ip'),
  })
}

function mapItems(items: unknown[]): Array<Record<string, unknown>> {
  return items.slice(0, 200).map((item) => {
    const row = obj(item)
    return compact({
      item_id: idStr(row.item_id, 160) || idStr(row.id, 160) || idStr(row.variant_id, 160) || idStr(row.product_id, 160),
      item_name: str(row.item_name, 240),
      item_variant: str(row.item_variant, 160),
      price: num(row.price),
      quantity: num(row.quantity) ?? 1,
      index: int(row.index),
    })
  })
}

export function mapCanonicalToGa4(canonicalEventName: string, canonicalPayload: Record<string, unknown>): Ga4MapResult {
  const errors: string[] = []
  const user = obj(canonicalPayload.user)
  const context = obj(canonicalPayload.context)
  const ecommerce = obj(canonicalPayload.ecommerce)
  const checkout = obj(canonicalPayload.checkout)
  const utm = obj(context.utm)
  const ads = obj(context.ads)

  if (!GA4_CANONICAL_EVENT_NAMES.has(canonicalEventName)) {
    errors.push('ga4_event_not_supported')
  }

  const clientId = str(user.ga_client_id, 128)
  if (!clientId) errors.push('ga4_client_id_missing')

  const items = Array.isArray(ecommerce.items) ? mapItems(ecommerce.items) : []
  const value = num(ecommerce.value)
  const currency = str(ecommerce.currency, 8)
  const transactionId = str(ecommerce.transaction_id, 180) || str(checkout.shopify_order_id, 180)

  if (
    ['view_item', 'view_item_list', 'add_to_cart', 'remove_from_cart'].includes(canonicalEventName) &&
    items.length === 0
  ) {
    errors.push('ga4_items_missing')
  }
  if (
    ['add_to_cart', 'begin_checkout', 'add_shipping_info', 'add_payment_info', 'purchase'].includes(canonicalEventName)
  ) {
    if (value == null) errors.push('ga4_value_missing')
    if (!currency) errors.push('ga4_currency_missing')
  }
  if (canonicalEventName === 'purchase' && !transactionId) {
    errors.push('ga4_transaction_id_missing')
  }

  const params = compact({
    page_location: str(context.url, 2048),
    page_referrer: str(context.referrer, 2048),
    page_title: str(context.title, 300),
    search_term: str(canonicalPayload.search_term, 300),
    currency,
    value,
    transaction_id: transactionId,
    coupon: str(ecommerce.coupon, 160),
    shipping: num(ecommerce.shipping),
    tax: num(ecommerce.tax),
    items: items.length > 0 ? items : null,
    item_list_id: str(ecommerce.item_list_id, 160),
    item_list_name: str(ecommerce.item_list_name, 240),
    session_id: int(user.ga_session_id) ?? int(user.session_id),
    engagement_time_msec: 1,
    source: str(utm.source, 160),
    medium: str(utm.medium, 160),
    campaign: str(utm.campaign, 240),
    term: str(utm.term, 240),
    content: str(utm.content, 240),
    utm_id: str(utm.id, 160),
    utm_source_platform: str(utm.source_platform, 160),
    utm_creative_format: str(utm.creative_format, 160),
    utm_marketing_tactic: str(utm.marketing_tactic, 160),
    gclid: str(user.gclid, 512),
    gbraid: str(user.gbraid, 512),
    wbraid: str(user.wbraid, 512),
    fbclid: str(user.fbclid, 512),
    fbc: str(user.fbc, 256),
    fbp: str(user.fbp, 256),
    ttclid: str(user.ttclid, 512),
    campaign_id: str(ads.campaign_id, 160),
    ad_group_id: str(ads.ad_group_id, 160),
    adset_id: str(ads.adset_id, 160),
    ad_id: str(ads.ad_id, 160),
    creative_id: str(ads.creative_id, 160),
    campaign_name: str(ads.campaign_name, 240),
    ad_group_name: str(ads.ad_group_name, 240),
    adset_name: str(ads.adset_name, 240),
    ad_name: str(ads.ad_name, 240),
    placement: str(ads.placement, 160),
    network: str(ads.network, 160),
    matchtype: str(ads.matchtype, 80),
  })

  const emailSha256 = str(user.email_sha256, 128)
  const phoneSha256 = str(user.phone_sha256, 128)
  const userData = compact({
    sha256_email_address: isSha256(emailSha256) ? [emailSha256] : null,
    sha256_phone_number: isSha256(phoneSha256) ? [phoneSha256] : null,
  })

  const userProperties = compact({
    identity_source: { value: str(user.identity_source, 120) ?? 'unknown' },
    palas_muid: { value: str(user.muid, 128) },
    posthog_distinct_id: { value: str(user.distinct_id, 180) },
  })

  const payload = compact({
    client_id: clientId,
    user_id: str(user.contact_id, 180) || str(user.muid, 128) || str(user.distinct_id, 180),
    user_properties: Object.keys(userProperties).length > 0 ? userProperties : null,
    user_data: Object.keys(userData).length > 0 ? userData : null,
    events: [
      {
        name: canonicalEventName,
        params,
      },
    ],
  })

  const metadata = compact({
    event_name: canonicalEventName,
    client_id_present: Boolean(clientId),
    user_id_present: Boolean(payload.user_id),
    item_count: items.length,
    transaction_id: transactionId,
  })

  return errors.length === 0 ? { ok: true, payload, metadata } : { ok: false, errors, payload, metadata }
}

export async function sendGa4Payload(
  payload: Record<string, unknown>,
  config: Ga4Config = getGa4Config(),
  signal?: AbortSignal,
): Promise<Ga4SendResult> {
  if (!config.measurementId || !config.apiSecret) {
    return {
      status: 'not_configured',
      http_status: null,
      error_code: 'ga4_not_configured',
      error_message: 'GA4_MEASUREMENT_ID and GA4_API_SECRET are required',
      response_payload: null,
    }
  }

  const url = new URL(config.endpoint)
  url.searchParams.set('measurement_id', config.measurementId)
  url.searchParams.set('api_secret', config.apiSecret)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
    const text = await res.text().catch(() => '')
    const responsePayload = text ? safeJson(text) : null

    if (config.debug && responsePayload && Array.isArray(responsePayload.validationMessages)) {
      const messages = responsePayload.validationMessages as unknown[]
      if (messages.length > 0) {
        return {
          status: 'invalid',
          http_status: res.status,
          error_code: 'ga4_debug_validation_failed',
          error_message: JSON.stringify(messages).slice(0, 1000),
          response_payload: responsePayload,
        }
      }
    }

    if (res.ok) {
      return {
        status: 'sent',
        http_status: res.status,
        error_code: null,
        error_message: null,
        response_payload: responsePayload,
      }
    }

    return {
      status: res.status >= 500 || res.status === 429 ? 'retry' : 'error',
      http_status: res.status,
      error_code: `ga4_http_${res.status}`,
      error_message: text.slice(0, 1000) || res.statusText,
      response_payload: responsePayload,
    }
  } catch (err) {
    return {
      status: 'retry',
      http_status: null,
      error_code: 'ga4_fetch_error',
      error_message: err instanceof Error ? err.message.slice(0, 1000) : String(err).slice(0, 1000),
      response_payload: null,
    }
  }
}

export async function ensureMissingGa4DispatchLogs(
  db: RawDispatchDb,
  options: { lookbackHours?: number; limit?: number } = {},
): Promise<EnsureMissingGa4DispatchLogsResult> {
  const lookbackHours = Math.max(1, Math.min(72, Math.trunc(options.lookbackHours ?? 24)))
  const limit = Math.max(1, Math.min(1000, Math.trunc(options.limit ?? 500)))
  const rows = await db.raw<MissingGa4DispatchRow>(
    `SELECT e.event_id,
            e.event_name,
            e.event_name AS source_event_name,
            e.received_at,
            e.payload_normalized
       FROM event_logs e
       LEFT JOIN dispatch_logs d
         ON d.event_id = e.event_id
        AND d.destination = 'ga4'
      WHERE e.received_at >= NOW() - ($1::int * INTERVAL '1 hour')
        AND e.payload_normalized #>> '{validation,destinations,ga4,supported}' = 'true'
        AND d.event_id IS NULL
      ORDER BY e.received_at ASC
      LIMIT $2`,
    [lookbackHours, limit],
  )

  let inserted = 0
  let invalid = 0
  for (const row of rows) {
    const normalized = parseNormalizedPayload(row.payload_normalized)
    const mapped = mapCanonicalToGa4(row.event_name, normalized)
    if (!mapped.ok) invalid += 1

    await db.raw(
      `INSERT INTO dispatch_logs (
         id, event_destination_key, event_id, canonical_event_name, source_event_name,
         destination, status, event_received_at, first_attempt_at, last_attempt_at,
         next_attempt_at, sent_at, attempt_count, http_status, error_code,
         error_message, request_payload, response_payload, metadata, created_at, updated_at
       ) VALUES (
         gen_random_uuid(), $1, $2, $3, $4,
         'ga4', $5, $6::timestamptz, NULL, NULL,
         $7::timestamptz, NULL, 0, NULL, $8,
         $9, $10::jsonb, NULL, $11::jsonb, NOW(), NOW()
       )
       ON CONFLICT (event_destination_key) DO NOTHING`,
      [
        `${row.event_id}:ga4`,
        row.event_id,
        row.event_name,
        row.source_event_name,
        mapped.ok ? 'pending' : 'invalid',
        row.received_at,
        mapped.ok ? new Date() : null,
        mapped.ok ? null : (mapped.errors[0] ?? 'ga4_invalid_payload'),
        mapped.ok ? null : mapped.errors.join(', '),
        JSON.stringify(mapped.payload),
        JSON.stringify({ ...mapped.metadata, ready: mapped.ok, errors: mapped.ok ? [] : mapped.errors }),
      ],
    )
    inserted += 1
  }

  return { scanned: rows.length, inserted, invalid }
}

export const ga4DestinationConnector: DestinationConnector = {
  destination: 'ga4',
  pendingStatuses: ['pending', 'retry', 'not_configured'],
  notConfiguredErrorCode: 'ga4_not_configured',
  notConfiguredMessage: 'Set GA4_MEASUREMENT_ID and GA4_API_SECRET to enable dispatch',
  isConfigured: () => isGa4Configured(getGa4Config()),
  send: (payload, signal) => sendGa4Payload(payload, getGa4Config(), signal),
}

function parseNormalizedPayload(value: MissingGa4DispatchRow['payload_normalized']): Record<string, unknown> {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return obj(parsed)
    } catch {
      return {}
    }
  }
  return obj(value)
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text)
    return obj(parsed)
  } catch {
    return { text: text.slice(0, 1000) }
  }
}
