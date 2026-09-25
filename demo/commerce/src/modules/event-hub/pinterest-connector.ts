import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { CANONICAL_EVENT_CONTRACTS, isCanonicalEventName } from './canonical-contract'
import type { DestinationConnector, DispatchSendResult } from './destination-connector'

export type PinterestConfig = {
  adAccountId: string | null
  accessToken: string | null
  testMode: boolean
}

export type PinterestMapResult =
  | { supported: true; ok: true; payload: Record<string, unknown>; metadata: Record<string, unknown> }
  | {
      supported: boolean
      ok: false
      errors: string[]
      payload: Record<string, unknown>
      metadata: Record<string, unknown>
    }

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function str(value: unknown, max = 2048): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= max ? trimmed : null
}

function num(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry != null))
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function hash(value: unknown): string | null {
  const candidate = str(value, 64)
  return candidate && /^[a-f\d]{64}$/i.test(candidate) ? candidate.toLowerCase() : null
}

function unixSeconds(value: unknown): number | null {
  const raw = str(value, 80)
  if (
    !(value instanceof Date) &&
    (!raw || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw))
  )
    return null
  const milliseconds = value instanceof Date ? value.getTime() : raw ? Date.parse(raw) : Number.NaN
  const seconds = Math.floor(milliseconds / 1000)
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null
}

function webUrl(value: unknown): string | null {
  const raw = str(value, 4096)
  if (!raw) return null
  try {
    const url = new URL(raw)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? raw : null
  } catch {
    return null
  }
}

export function getPinterestConfig(env: NodeJS.ProcessEnv = process.env): PinterestConfig {
  return {
    adAccountId: str(env.PINTEREST_AD_ACCOUNT_ID, 18),
    accessToken: str(env.PINTEREST_ACCESS_TOKEN, 8192),
    testMode: env.PINTEREST_TEST_MODE?.trim().toLowerCase() === 'true',
  }
}

export function isPinterestConfigured(config: PinterestConfig = getPinterestConfig()): boolean {
  return Boolean(config.adAccountId && /^\d{1,18}$/.test(config.adAccountId) && str(config.accessToken, 8192))
}

export function mapCanonicalToPinterest(
  canonicalEventName: string,
  canonicalPayload: Record<string, unknown>,
): PinterestMapResult {
  const eventName = isCanonicalEventName(canonicalEventName)
    ? (CANONICAL_EVENT_CONTRACTS[canonicalEventName].destinations.pinterest ?? null)
    : null
  const metadata: Record<string, unknown> = { event_name: canonicalEventName, pinterest_event_name: eventName }
  if (!eventName) {
    return { supported: false, ok: false, errors: ['pinterest_event_not_supported'], payload: {}, metadata }
  }

  const consent = obj(canonicalPayload.consent)
  const errors = ['ad_storage', 'ad_user_data', 'ad_personalization']
    .filter((key) => consent[key] !== true)
    .map((key) => `pinterest_${key}_consent_not_granted`)
  // Invalid rows can still be stored for diagnosis. Do not persist advertising identifiers without consent.
  if (errors.length) return { supported: true, ok: false, errors, payload: {}, metadata }

  const user = obj(canonicalPayload.user)
  const ecommerce = obj(canonicalPayload.ecommerce)
  const eventId = str(canonicalPayload.event_id, 180)
  const eventTime = unixSeconds(canonicalPayload.event_time)
  const sourceUrl = webUrl(obj(canonicalPayload.context).url)
  if (!eventId) errors.push('pinterest_event_id_missing')
  if (!eventTime) errors.push('pinterest_event_time_invalid')
  if (!sourceUrl) errors.push('pinterest_event_source_url_missing')

  const rawEmail = str(user.email, 320)?.toLowerCase()
  const email =
    hash(user.email_sha256) || (rawEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) ? digest(rawEmail) : null)
  const external =
    str(user.external_id, 180) ||
    str(user.contact_id, 180) ||
    str(user.muid, 180) ||
    str(user.shopify_customer_id, 180) ||
    str(user.distinct_id, 180)
  const externalId = external ? hash(external) || digest(external) : null
  const phone = hash(user.phone_sha256)
  const ip = str(user.client_ip, 64)
  const validIp = ip && isIP(ip) && ip !== '0.0.0.0' && ip !== '::' ? ip : null
  const agent = str(user.user_agent, 1024)
  const clickId = str(user.epik, 2048)
  // Pinterest requires email, a mobile advertising ID, or the IP + UA pair; external/click IDs supplement matching.
  if (!email && !(validIp && agent)) errors.push('pinterest_user_data_missing')

  const value = num(ecommerce.value)
  const currency = str(ecommerce.currency, 3)?.toUpperCase() ?? null
  const requiresValue = ['purchase', 'add_to_cart', 'begin_checkout'].includes(canonicalEventName)
  if ((requiresValue || ecommerce.value != null) && (value == null || value < 0)) errors.push('pinterest_value_invalid')
  if ((requiresValue || ecommerce.currency != null || value != null) && (!currency || !/^[A-Z]{3}$/.test(currency))) {
    errors.push('pinterest_currency_invalid')
  }
  const orderId = str(ecommerce.transaction_id, 180) || str(obj(canonicalPayload.checkout).shopify_order_id, 180)
  if (canonicalEventName === 'purchase' && !orderId) errors.push('pinterest_order_id_missing')
  const search = str(canonicalPayload.search_term, 300)
  if (canonicalEventName === 'search' && !search) errors.push('pinterest_search_term_missing')

  const rawItems = Array.isArray(ecommerce.items) ? ecommerce.items : []
  if (rawItems.length > 200) errors.push('pinterest_too_many_items')
  if (['purchase', 'add_to_cart', 'view_item', 'view_item_list'].includes(canonicalEventName) && !rawItems.length) {
    errors.push('pinterest_items_missing')
  }
  const items = rawItems.slice(0, 200).map((item) => {
    const row = obj(item)
    const id = str(row.item_id, 180)
    const quantity = row.quantity == null ? 1 : num(row.quantity)
    const price = num(row.price)
    if (!id) errors.push('pinterest_item_id_missing')
    if (quantity == null || !Number.isSafeInteger(quantity) || quantity <= 0)
      errors.push('pinterest_item_quantity_invalid')
    if (row.price != null && (price == null || price < 0)) errors.push('pinterest_item_price_invalid')
    return compact({
      id,
      item_name: str(row.item_name, 300),
      item_price: price == null ? null : String(price),
      quantity,
    })
  })

  Object.assign(metadata, {
    email_present: Boolean(email),
    external_id_present: Boolean(externalId),
    click_id_present: Boolean(clickId),
    client_ip_present: Boolean(validIp),
    client_user_agent_present: Boolean(agent),
  })
  if (errors.length) return { supported: true, ok: false, errors: [...new Set(errors)], payload: {}, metadata }

  const customData = compact({
    currency,
    value: value == null ? null : String(value),
    order_id: orderId,
    search_string: search,
    content_ids: items.length ? items.map((item) => item.id) : null,
    contents: items.length ? items : null,
    num_items: items.length ? items.reduce((sum, item) => sum + Number(item.quantity), 0) : null,
  })
  const event = compact({
    event_name: eventName,
    event_id: eventId,
    event_time: eventTime,
    action_source: 'web',
    event_source_url: sourceUrl,
    user_data: compact({
      em: email ? [email] : null,
      ph: phone ? [phone] : null,
      external_id: externalId ? [externalId] : null,
      click_id: clickId,
      client_ip_address: validIp,
      client_user_agent: agent,
    }),
    custom_data: Object.keys(customData).length ? customData : null,
  })
  return { supported: true, ok: true, payload: { data: [event] }, metadata }
}

function failure(
  status: DispatchSendResult['status'],
  code: string,
  message: string,
  httpStatus: number | null = null,
  responsePayload: Record<string, unknown> | null = null,
): DispatchSendResult {
  return {
    status,
    http_status: httpStatus,
    error_code: code,
    error_message: message,
    response_payload: responsePayload,
  }
}

export async function sendPinterestPayload(
  payload: Record<string, unknown>,
  config: PinterestConfig = getPinterestConfig(),
  signal?: AbortSignal,
): Promise<DispatchSendResult> {
  if (!isPinterestConfigured(config)) {
    return failure(
      'not_configured',
      'pinterest_not_configured',
      'PINTEREST_AD_ACCOUNT_ID and PINTEREST_ACCESS_TOKEN are required',
    )
  }
  const data = Array.isArray(payload.data) ? payload.data : []
  if (!data.length)
    return failure('invalid', 'pinterest_payload_invalid', 'Pinterest payload must include events in data[]')

  try {
    const url = new URL(`https://api.pinterest.com/v5/ad_accounts/${config.adAccountId}/events`)
    if (config.testMode) url.searchParams.set('test', 'true')
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.accessToken}` },
      body: JSON.stringify(payload),
      signal,
    })
    if (!res.ok) {
      return failure(
        res.status === 429 || res.status >= 500 ? 'retry' : 'error',
        `pinterest_http_${res.status}`,
        'Pinterest rejected the request',
        res.status,
      )
    }
    const text = await res.text()
    let body: Record<string, unknown> = {}
    try {
      body = obj(JSON.parse(text))
    } catch {
      // A malformed success response cannot prove acceptance.
    }
    const events = Array.isArray(body.events) ? body.events.map(obj) : []
    // Only retain fixed enums and integer counts. Error/warning messages may echo identifiers or credentials.
    const summary = compact({
      num_events_received: Number.isSafeInteger(body.num_events_received) ? body.num_events_received : null,
      num_events_processed: Number.isSafeInteger(body.num_events_processed) ? body.num_events_processed : null,
      events: events.map((event) => ({
        status: event.status === 'processed' ? 'processed' : event.status === 'failed' ? 'failed' : 'unknown',
      })),
    })
    const allProcessed =
      body.num_events_received === data.length &&
      body.num_events_processed === data.length &&
      events.length === data.length &&
      events.every((event) => event.status === 'processed' && !event.error_message)
    if (!allProcessed) {
      // An ambiguous acknowledgment is retryable with the same event IDs; only explicit rejection is terminal.
      const explicitlyFailed = events.some(
        (event) =>
          event.status === 'failed' ||
          (typeof event.error_message === 'string' && event.error_message.trim().length > 0),
      )
      return failure(
        explicitlyFailed ? 'error' : 'retry',
        'pinterest_events_not_accepted',
        'Pinterest did not confirm acceptance of every event',
        res.status,
        summary,
      )
    }
    return {
      status: config.testMode ? 'validated' : 'sent',
      http_status: res.status,
      error_code: null,
      error_message: null,
      response_payload: summary,
    }
  } catch {
    return failure('retry', 'pinterest_fetch_error', 'Pinterest request failed')
  }
}

export const pinterestDestinationConnector: DestinationConnector = {
  destination: 'pinterest',
  pendingStatuses: ['pending', 'retry', 'not_configured'],
  notConfiguredErrorCode: 'pinterest_not_configured',
  notConfiguredMessage: 'Set PINTEREST_AD_ACCOUNT_ID and PINTEREST_ACCESS_TOKEN to enable dispatch',
  isConfigured: () => isPinterestConfigured(),
  send: (payload, signal) => sendPinterestPayload(payload, getPinterestConfig(), signal),
}
