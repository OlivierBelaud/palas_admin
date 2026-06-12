import { GA4_CANONICAL_EVENT_NAMES } from './canonical-contract'
import type { DestinationConnector, DispatchSendResult, DispatchStatus } from './destination-connector'

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

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function str(value: unknown, max = 2048): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max) return null
  return trimmed
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
      item_id: str(row.item_id, 160),
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
  })

  const payload = compact({
    client_id: clientId,
    user_id: str(user.contact_id, 180) || str(user.email_sha256, 180),
    user_properties: user.email_sha256
      ? {
          email_sha256: { value: user.email_sha256 },
          identity_source: { value: str(user.identity_source, 120) ?? 'unknown' },
        }
      : null,
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

export const ga4DestinationConnector: DestinationConnector = {
  destination: 'ga4',
  pendingStatuses: ['pending', 'retry', 'not_configured'],
  notConfiguredErrorCode: 'ga4_not_configured',
  notConfiguredMessage: 'Set GA4_MEASUREMENT_ID and GA4_API_SECRET to enable dispatch',
  isConfigured: () => isGa4Configured(getGa4Config()),
  send: (payload, signal) => sendGa4Payload(payload, getGa4Config(), signal),
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text)
    return obj(parsed)
  } catch {
    return { text: text.slice(0, 1000) }
  }
}
