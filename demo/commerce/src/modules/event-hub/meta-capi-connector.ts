import { createHash } from 'node:crypto'
import type { DestinationConnector, DispatchSendResult, DispatchStatus } from './destination-connector'

export type MetaCapiDispatchStatus = DispatchStatus

export type MetaCapiConfig = {
  pixelId: string | null
  accessToken: string | null
  testEventCode: string | null
  apiVersion: string
  endpoint: string
}

export type MetaCapiMapResult =
  | {
      supported: true
      ok: true
      payload: Record<string, unknown>
      metadata: Record<string, unknown>
    }
  | {
      supported: true
      ok: false
      errors: string[]
      payload: Record<string, unknown>
      metadata: Record<string, unknown>
    }
  | {
      supported: false
      ok: false
      errors: string[]
      payload: Record<string, unknown>
      metadata: Record<string, unknown>
    }

export type MetaCapiSendResult = DispatchSendResult

const META_EVENT_NAMES: Record<string, string> = {
  page_view: 'PageView',
  view_item: 'ViewContent',
  search: 'Search',
  add_to_cart: 'AddToCart',
  begin_checkout: 'InitiateCheckout',
  add_contact_info: 'Lead',
  add_payment_info: 'AddPaymentInfo',
  purchase: 'Purchase',
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

function num(value: unknown): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function compact<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value != null && value !== ''))
}

function isSha256(value: string | null): value is string {
  return Boolean(value && /^[a-f0-9]{64}$/i.test(value))
}

function sha256(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex')
}

function toUnixSeconds(value: unknown): number | null {
  const raw = str(value, 80)
  const parsed = raw ? new Date(raw) : new Date()
  if (!Number.isFinite(parsed.getTime())) return null
  return Math.floor(parsed.getTime() / 1000)
}

function mapItems(items: unknown[]): Array<Record<string, unknown>> {
  return items.slice(0, 200).map((item) => {
    const row = obj(item)
    return compact({
      id: str(row.item_id, 160),
      quantity: num(row.quantity) ?? 1,
      item_price: num(row.price),
    })
  })
}

function externalIdFor(user: Record<string, unknown>): string | null {
  const direct = str(user.external_id, 128)
  if (isSha256(direct)) return direct
  const raw =
    str(user.contact_id, 180) || str(user.muid, 128) || str(user.shopify_customer_id, 180) || str(user.distinct_id, 180)
  return raw ? sha256(raw) : null
}

export function getMetaCapiConfig(env: NodeJS.ProcessEnv = process.env): MetaCapiConfig {
  const apiVersion = (env.META_CAPI_API_VERSION || env.META_API_VERSION || 'v25.0').trim()
  return {
    pixelId: env.META_PIXEL_ID || env.FACEBOOK_PIXEL_ID || null,
    accessToken: env.META_ACCESS_TOKEN || env.FACEBOOK_ACCESS_TOKEN || null,
    testEventCode: env.META_TEST_EVENT_CODE || env.FACEBOOK_TEST_EVENT_CODE || null,
    apiVersion,
    endpoint: env.META_CAPI_ENDPOINT || `https://graph.facebook.com/${apiVersion}`,
  }
}

export function isMetaCapiConfigured(config: MetaCapiConfig = getMetaCapiConfig()) {
  return Boolean(config.pixelId && config.accessToken)
}

export function mapCanonicalToMetaCapi(
  canonicalEventName: string,
  canonicalPayload: Record<string, unknown>,
  config: Pick<MetaCapiConfig, 'testEventCode'> = getMetaCapiConfig(),
): MetaCapiMapResult {
  const mappedEventName = META_EVENT_NAMES[canonicalEventName]
  if (!mappedEventName) {
    return {
      supported: false,
      ok: false,
      errors: ['meta_capi_event_not_supported'],
      payload: {},
      metadata: { event_name: canonicalEventName, ready: false },
    }
  }

  const errors: string[] = []
  const user = obj(canonicalPayload.user)
  const context = obj(canonicalPayload.context)
  const ecommerce = obj(canonicalPayload.ecommerce)
  const checkout = obj(canonicalPayload.checkout)
  const consent = obj(canonicalPayload.consent)

  const eventTime = toUnixSeconds(canonicalPayload.event_time)
  const eventId = str(canonicalPayload.event_id, 180) || str(canonicalPayload.eventId, 180)
  const eventSourceUrl = str(context.url, 4096)
  const clientIpAddress = str(user.client_ip, 256)
  const clientUserAgent = str(user.user_agent, 1024)
  const emailSha256 = str(user.email_sha256, 128)
  const phoneSha256 = str(user.phone_sha256, 128)
  const externalId = externalIdFor(user)
  const fbp = str(user.fbp, 256)
  const fbc = str(user.fbc, 256)

  if (!eventTime) errors.push('meta_capi_event_time_missing')
  if (!eventId) errors.push('meta_capi_event_id_missing')
  if (!eventSourceUrl) errors.push('meta_capi_event_source_url_missing')
  if (!clientUserAgent) errors.push('meta_capi_client_user_agent_missing')
  if (!isSha256(emailSha256) && !isSha256(phoneSha256) && !externalId && !fbp && !fbc) {
    errors.push('meta_capi_user_data_missing')
  }
  if (consent.ad_storage !== true) errors.push('meta_capi_ad_storage_consent_not_granted')
  if (consent.ad_user_data !== true) errors.push('meta_capi_ad_user_data_consent_not_granted')
  if (consent.ad_personalization !== true) errors.push('meta_capi_ad_personalization_consent_not_granted')

  const items = Array.isArray(ecommerce.items) ? mapItems(ecommerce.items) : []
  const value = num(ecommerce.value)
  const currency = str(ecommerce.currency, 8)
  const orderId = str(ecommerce.transaction_id, 180) || str(checkout.shopify_order_id, 180)

  const userData = compact({
    em: isSha256(emailSha256) ? [emailSha256] : null,
    ph: isSha256(phoneSha256) ? [phoneSha256] : null,
    external_id: externalId ? [externalId] : null,
    fbp,
    fbc,
    client_ip_address: clientIpAddress,
    client_user_agent: clientUserAgent,
  })

  const customData = compact({
    currency,
    value,
    order_id: orderId,
    search_string: str(canonicalPayload.search_term, 300),
    content_type: items.length > 0 ? 'product' : null,
    content_ids: items.length > 0 ? items.map((item) => item.id).filter(Boolean) : null,
    contents: items.length > 0 ? items : null,
    num_items: items.length > 0 ? items.reduce((sum, item) => sum + (num(item.quantity) ?? 0), 0) : null,
  })

  const event = compact({
    event_name: mappedEventName,
    event_time: eventTime,
    event_id: eventId,
    action_source: 'website',
    event_source_url: eventSourceUrl,
    user_data: userData,
    custom_data: Object.keys(customData).length > 0 ? customData : null,
  })

  const payload = compact({
    data: [event],
    test_event_code: str(config.testEventCode, 128),
  })

  const metadata = compact({
    event_name: canonicalEventName,
    meta_event_name: mappedEventName,
    event_id: eventId,
    email_present: isSha256(emailSha256),
    phone_present: isSha256(phoneSha256),
    external_id_present: Boolean(externalId),
    fbp_present: Boolean(fbp),
    fbc_present: Boolean(fbc),
    client_ip_present: Boolean(clientIpAddress),
    client_user_agent_present: Boolean(clientUserAgent),
    test_event_code_present: Boolean(str(config.testEventCode, 128)),
  })

  return errors.length === 0
    ? { supported: true, ok: true, payload, metadata }
    : { supported: true, ok: false, errors, payload, metadata }
}

export async function sendMetaCapiPayload(
  payload: Record<string, unknown>,
  config: MetaCapiConfig = getMetaCapiConfig(),
  signal?: AbortSignal,
): Promise<MetaCapiSendResult> {
  if (!isMetaCapiConfigured(config)) {
    return {
      status: 'not_configured',
      http_status: null,
      error_code: 'meta_capi_not_configured',
      error_message: 'META_PIXEL_ID and META_ACCESS_TOKEN are required',
      response_payload: null,
    }
  }

  const data = Array.isArray(payload.data) ? payload.data : []
  if (data.length === 0) {
    return {
      status: 'invalid',
      http_status: null,
      error_code: 'meta_capi_payload_invalid',
      error_message: 'Meta CAPI payload must include at least one event in data[]',
      response_payload: null,
    }
  }

  try {
    const url = new URL(`${config.endpoint.replace(/\/$/, '')}/${config.pixelId}/events`)
    url.searchParams.set('access_token', config.accessToken ?? '')
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
    const text = await res.text().catch(() => '')
    const responsePayload = text ? safeJson(text) : null
    const response = obj(responsePayload)
    const eventsReceived = Number(response.events_received ?? 0)

    if (res.ok && eventsReceived >= data.length) {
      return {
        status: 'sent',
        http_status: res.status,
        error_code: null,
        error_message: null,
        response_payload: responsePayload,
      }
    }

    const error = obj(response.error)
    const code = str(error.code, 120) || str(error.error_subcode, 120)
    const message = str(error.message, 1000) || text.slice(0, 1000)
    return {
      status: res.status >= 500 || res.status === 429 ? 'retry' : 'error',
      http_status: res.status,
      error_code: code ? `meta_capi_${code}` : `meta_capi_http_${res.status}`,
      error_message: message || res.statusText,
      response_payload: responsePayload,
    }
  } catch (err) {
    return {
      status: 'retry',
      http_status: null,
      error_code: 'meta_capi_fetch_error',
      error_message: err instanceof Error ? err.message.slice(0, 1000) : String(err).slice(0, 1000),
      response_payload: null,
    }
  }
}

export const metaCapiDestinationConnector: DestinationConnector = {
  destination: 'meta_capi',
  pendingStatuses: ['pending', 'retry', 'not_configured'],
  notConfiguredErrorCode: 'meta_capi_not_configured',
  notConfiguredMessage: 'Set META_PIXEL_ID and META_ACCESS_TOKEN to enable dispatch',
  isConfigured: () => isMetaCapiConfigured(getMetaCapiConfig()),
  send: (payload, signal) => sendMetaCapiPayload(payload, getMetaCapiConfig(), signal),
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    return obj(JSON.parse(text))
  } catch {
    return { text: text.slice(0, 1000) }
  }
}
