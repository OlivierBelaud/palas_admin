import type { DestinationConnector, DispatchSendResult, DispatchStatus } from './destination-connector'

export type GoogleAdsDispatchStatus = DispatchStatus

export type GoogleAdsConfig = {
  clientId: string | null
  clientSecret: string | null
  refreshToken: string | null
  customerId: string | null
  loginCustomerId: string | null
  purchaseConversionActionId: string | null
  addToCartConversionActionId: string | null
  beginCheckoutConversionActionId: string | null
  leadConversionActionId: string | null
  addShippingInfoConversionActionId: string | null
  addPaymentInfoConversionActionId: string | null
  validateOnly: boolean
  endpoint: string
  oauthTokenEndpoint: string
}

export type GoogleAdsMapResult =
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

export type GoogleAdsSendResult = DispatchSendResult

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
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim()))
    return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function compact<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value != null && value !== ''))
}

function digits(value: string | null): string | null {
  if (!value) return null
  const cleaned = value.replaceAll('-', '').trim()
  return /^\d+$/.test(cleaned) ? cleaned : null
}

function isSha256(value: string | null): value is string {
  return Boolean(value && /^[a-f0-9]{64}$/i.test(value))
}

function pickClickId(value: unknown): string | null {
  const raw = str(value, 512)
  if (!raw) return null
  const gclAwMatch = raw.match(/GCL\.[^.]+\.[^.]+\.(.+)$/)
  return gclAwMatch?.[1] ? gclAwMatch[1] : raw
}

function clickIdFromUrl(url: unknown, key: 'gclid' | 'gbraid' | 'wbraid'): string | null {
  const raw = str(url, 4096)
  if (!raw) return null
  try {
    return str(new URL(raw).searchParams.get(key), 512)
  } catch {
    return null
  }
}

function toGoogleAdsDateTime(value: unknown): string | null {
  const raw = str(value, 80)
  if (!raw || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) return null
  if (Number(raw.slice(11, 13)) > 23 || Number(raw.slice(14, 16)) > 59 || Number(raw.slice(17, 19)) > 59) return null
  const date = new Date(raw)
  // Date silently rolls impossible dates (February 30) forward; reject them.
  const calendar = raw.slice(0, 10)
  const day = new Date(`${calendar}T00:00:00Z`)
  if (
    !Number.isFinite(date.getTime()) ||
    !Number.isFinite(day.getTime()) ||
    day.toISOString().slice(0, 10) !== calendar
  )
    return null
  return date.toISOString()
}

export function getGoogleAdsConfig(env: NodeJS.ProcessEnv = process.env): GoogleAdsConfig {
  return {
    clientId: env.GOOGLE_ADS_CLIENT_ID || null,
    clientSecret: env.GOOGLE_ADS_CLIENT_SECRET || null,
    refreshToken: env.GOOGLE_ADS_REFRESH_TOKEN || null,
    customerId: digits(env.GOOGLE_ADS_CUSTOMER_ID || null),
    loginCustomerId: digits(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || null),
    purchaseConversionActionId: digits(env.GOOGLE_ADS_PURCHASE_CONVERSION_ACTION_ID || null),
    addToCartConversionActionId: digits(env.GOOGLE_ADS_ADD_TO_CART_CONVERSION_ACTION_ID || null),
    beginCheckoutConversionActionId: digits(env.GOOGLE_ADS_BEGIN_CHECKOUT_CONVERSION_ACTION_ID || null),
    leadConversionActionId: digits(
      env.GOOGLE_ADS_LEAD_CONVERSION_ACTION_ID || env.GOOGLE_ADS_ADD_CONTACT_INFO_CONVERSION_ACTION_ID || null,
    ),
    addShippingInfoConversionActionId: digits(env.GOOGLE_ADS_ADD_SHIPPING_INFO_CONVERSION_ACTION_ID || null),
    addPaymentInfoConversionActionId: digits(env.GOOGLE_ADS_ADD_PAYMENT_INFO_CONVERSION_ACTION_ID || null),
    validateOnly: env.GOOGLE_ADS_VALIDATE_ONLY === 'true',
    endpoint: env.GOOGLE_ADS_ENDPOINT || 'https://datamanager.googleapis.com/v1',
    oauthTokenEndpoint: env.GOOGLE_OAUTH_TOKEN_ENDPOINT || 'https://oauth2.googleapis.com/token',
  }
}

export function isGoogleAdsConfigured(config: GoogleAdsConfig = getGoogleAdsConfig()) {
  return Boolean(
    config.clientId &&
      config.clientSecret &&
      config.refreshToken &&
      config.customerId &&
      (config.purchaseConversionActionId ||
        config.addToCartConversionActionId ||
        config.beginCheckoutConversionActionId ||
        config.leadConversionActionId ||
        config.addShippingInfoConversionActionId ||
        config.addPaymentInfoConversionActionId),
  )
}

function conversionActionIdFor(
  canonicalEventName: string,
  config: Pick<
    GoogleAdsConfig,
    | 'purchaseConversionActionId'
    | 'addToCartConversionActionId'
    | 'beginCheckoutConversionActionId'
    | 'leadConversionActionId'
    | 'addShippingInfoConversionActionId'
    | 'addPaymentInfoConversionActionId'
  >,
): string | null {
  if (canonicalEventName === 'purchase') return config.purchaseConversionActionId
  if (canonicalEventName === 'add_to_cart') return config.addToCartConversionActionId
  if (canonicalEventName === 'begin_checkout') return config.beginCheckoutConversionActionId
  if (canonicalEventName === 'add_contact_info') return config.leadConversionActionId
  if (canonicalEventName === 'add_shipping_info') return config.addShippingInfoConversionActionId
  if (canonicalEventName === 'add_payment_info') return config.addPaymentInfoConversionActionId
  return null
}

export function mapCanonicalToGoogleAds(
  canonicalEventName: string,
  canonicalPayload: Record<string, unknown>,
  config: Pick<
    GoogleAdsConfig,
    | 'customerId'
    | 'purchaseConversionActionId'
    | 'addToCartConversionActionId'
    | 'beginCheckoutConversionActionId'
    | 'leadConversionActionId'
    | 'addShippingInfoConversionActionId'
    | 'addPaymentInfoConversionActionId'
  > = getGoogleAdsConfig(),
): GoogleAdsMapResult {
  if (
    ![
      'purchase',
      'add_to_cart',
      'begin_checkout',
      'add_contact_info',
      'add_shipping_info',
      'add_payment_info',
    ].includes(canonicalEventName)
  ) {
    return {
      supported: false,
      ok: false,
      errors: ['google_ads_conversion_not_supported'],
      payload: {},
      metadata: { event_name: canonicalEventName, ready: false },
    }
  }

  const errors: string[] = []
  const configurationErrors: string[] = []
  const user = obj(canonicalPayload.user)
  const context = obj(canonicalPayload.context)
  const ecommerce = obj(canonicalPayload.ecommerce)
  const checkout = obj(canonicalPayload.checkout)
  const consent = obj(canonicalPayload.consent)

  const customerId = config.customerId
  const conversionActionId = conversionActionIdFor(canonicalEventName, config)
  const conversionDateTime = toGoogleAdsDateTime(canonicalPayload.event_time)
  const conversionValue = num(ecommerce.value)
  const currencyCode = str(ecommerce.currency, 8)
  const orderId = str(ecommerce.transaction_id, 180) || str(checkout.shopify_order_id, 180)
  const gclid = pickClickId(user.gclid) || clickIdFromUrl(context.url, 'gclid')
  const gbraid = pickClickId(user.gbraid) || clickIdFromUrl(context.url, 'gbraid')
  const wbraid = pickClickId(user.wbraid) || clickIdFromUrl(context.url, 'wbraid')
  const hashedEmail = str(user.email_sha256, 128)
  const hashedPhone = str(user.phone_sha256, 128)
  const eventId = str(canonicalPayload.event_id, 180)

  if (!customerId) configurationErrors.push('google_ads_customer_id_missing')
  if (!conversionActionId) configurationErrors.push('google_ads_conversion_action_id_missing')
  if (!conversionDateTime) errors.push('google_ads_conversion_date_time_missing')
  if (
    ['purchase', 'add_to_cart', 'begin_checkout', 'add_shipping_info', 'add_payment_info'].includes(canonicalEventName)
  ) {
    if (conversionValue == null) errors.push('google_ads_conversion_value_missing')
    if (!currencyCode || !/^[A-Z]{3}$/.test(currencyCode)) errors.push('google_ads_currency_code_missing')
  }
  if (canonicalEventName === 'purchase' && !orderId) errors.push('google_ads_order_id_missing')
  if (canonicalEventName !== 'purchase' && !eventId) errors.push('google_ads_event_id_missing')
  if (!gclid && !gbraid && !wbraid && !isSha256(hashedEmail) && !isSha256(hashedPhone)) {
    errors.push('google_ads_identifier_missing')
  }
  if (consent.ad_storage !== true) errors.push('google_ads_ad_storage_consent_not_granted')
  if (consent.ad_user_data !== true) errors.push('google_ads_ad_user_data_consent_not_granted')
  if (consent.ad_personalization !== true) errors.push('google_ads_ad_personalization_consent_not_granted')

  const userIdentifiers = [
    isSha256(hashedEmail) ? { emailAddress: hashedEmail.toLowerCase() } : null,
    isSha256(hashedPhone) ? { phoneNumber: hashedPhone.toLowerCase() } : null,
  ].filter(Boolean)
  const payload = {
    destinations: [
      {
        operatingAccount: { accountType: 'GOOGLE_ADS', accountId: customerId },
        productDestinationId: conversionActionId,
      },
    ],
    events: [
      compact({
        eventTimestamp: conversionDateTime,
        transactionId: canonicalEventName === 'purchase' ? orderId : eventId,
        conversionValue,
        currency: currencyCode,
        eventSource: 'WEB',
        adIdentifiers: gclid || gbraid || wbraid ? compact({ gclid, gbraid, wbraid }) : null,
        userData: userIdentifiers.length ? { userIdentifiers } : null,
      }),
    ],
    consent: {
      adUserData: consent.ad_user_data === true ? 'CONSENT_GRANTED' : 'CONSENT_DENIED',
      adPersonalization: consent.ad_personalization === true ? 'CONSENT_GRANTED' : 'CONSENT_DENIED',
    },
    encoding: 'HEX',
    validateOnly: false,
  }
  const allErrors = [...configurationErrors, ...errors]
  const metadata = {
    event_name: canonicalEventName,
    conversion_action_id: conversionActionId,
    order_id: orderId,
    gclid_present: Boolean(gclid),
    gbraid_present: Boolean(gbraid),
    wbraid_present: Boolean(wbraid),
    enhanced_conversion_present: userIdentifiers.length > 0,
    consent_ad_user_data: consent.ad_user_data,
    consent_ad_personalization: consent.ad_personalization,
    configuration_errors: configurationErrors,
    payload_errors: errors,
    ready: allErrors.length === 0,
  }
  return allErrors.length === 0
    ? { supported: true, ok: true, payload, metadata }
    : { supported: true, ok: false, errors: allErrors, payload, metadata }
}

function failure(
  status: DispatchStatus,
  code: string,
  message: string,
  httpStatus: number | null = null,
): GoogleAdsSendResult {
  return { status, http_status: httpStatus, error_code: code, error_message: message, response_payload: null }
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const value = await response.json()
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

async function fetchAccessToken(config: GoogleAdsConfig, signal: AbortSignal): Promise<string | GoogleAdsSendResult> {
  const response = await fetch(config.oauthTokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId ?? '',
      client_secret: config.clientSecret ?? '',
      refresh_token: config.refreshToken ?? '',
      grant_type: 'refresh_token',
    }),
    signal,
    redirect: 'error',
  })
  const parsed = await readJson(response)
  const token = str(parsed?.access_token, 4096)
  if (response.ok && token) return token
  const refused =
    response.status === 401 ||
    response.status === 403 ||
    ['invalid_grant', 'invalid_client', 'unauthorized_client', 'invalid_scope'].includes(String(parsed?.error))
  return failure(
    refused ? 'not_configured' : 'retry',
    'google_ads_oauth_failed',
    refused
      ? 'Google authorization requires operator repair or reauthorization with the datamanager scope'
      : 'Google OAuth token exchange failed',
    response.status,
  )
}

function validPayload(payload: Record<string, unknown>, config: GoogleAdsConfig): boolean {
  const destinations = Array.isArray(payload.destinations) ? payload.destinations : []
  const events = Array.isArray(payload.events) ? payload.events : []
  const consent = obj(payload.consent)
  if (
    destinations.length !== 1 ||
    events.length !== 1 ||
    payload.encoding !== 'HEX' ||
    consent.adUserData !== 'CONSENT_GRANTED' ||
    consent.adPersonalization !== 'CONSENT_GRANTED'
  )
    return false
  const destination = obj(destinations[0])
  const account = obj(destination.operatingAccount)
  if (
    account.accountType !== 'GOOGLE_ADS' ||
    account.accountId !== config.customerId ||
    !digits(str(destination.productDestinationId, 32))
  )
    return false
  const event = obj(events[0])
  const ids = obj(event.adIdentifiers)
  const identifiers = obj(event.userData).userIdentifiers
  const userIdentifiers = Array.isArray(identifiers) ? identifiers : []
  if (userIdentifiers.some((id) => !isSha256(str(obj(id).emailAddress)) && !isSha256(str(obj(id).phoneNumber))))
    return false
  if (!['gclid', 'gbraid', 'wbraid'].some((key) => str(ids[key], 512)) && !userIdentifiers.length) return false
  if (!toGoogleAdsDateTime(event.eventTimestamp) || !str(event.transactionId, 180)) return false
  if (
    event.conversionValue != null &&
    (typeof event.conversionValue !== 'number' || num(event.conversionValue) == null)
  )
    return false
  return event.currency == null || /^[A-Z]{3}$/.test(String(event.currency))
}

function sanitizedWarnings(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 20).map((entry) => {
    const warning = obj(entry)
    // Descriptions can echo submitted personal data. Retain only enum codes and field paths.
    const reason = str(warning.reason, 160)
    const field = str(warning.field, 256)
    return compact({
      reason: reason && /^WARNING_REASON_[A-Z_]+$/.test(reason) ? reason : null,
      field: field && /^(events|destinations|consent|encoding)(?:\[\d+\]|\.[a-zA-Z]+)*$/.test(field) ? field : null,
    })
  })
}

export async function sendGoogleAdsPurchasePayload(
  payload: Record<string, unknown>,
  config: GoogleAdsConfig = getGoogleAdsConfig(),
  signal?: AbortSignal,
): Promise<GoogleAdsSendResult> {
  if (!isGoogleAdsConfigured(config))
    return failure(
      'not_configured',
      'google_ads_not_configured',
      'Google OAuth credentials, customer id and a conversion action id are required',
    )
  if ('conversions' in payload)
    return failure(
      'invalid',
      'google_ads_payload_remap_required',
      'Remap the persisted canonical event to Data Manager before sending',
    )
  if (!validPayload(payload, config))
    return failure('invalid', 'google_ads_payload_invalid', 'Google Data Manager payload is invalid')
  const controller = new AbortController()
  const cancel = () => controller.abort()
  const timeout = setTimeout(cancel, 15000)
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  try {
    controller.signal.throwIfAborted()
    const token = await fetchAccessToken(config, controller.signal)
    if (typeof token !== 'string') return token
    const destinations = (payload.destinations as Record<string, unknown>[]).map((destination) => ({
      operatingAccount: destination.operatingAccount,
      productDestinationId: destination.productDestinationId,
      ...(config.loginCustomerId
        ? { loginAccount: { accountType: 'GOOGLE_ADS', accountId: config.loginCustomerId } }
        : {}),
    }))
    const response = await fetch(`${config.endpoint.replace(/\/$/, '')}/events:ingest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        destinations,
        events: payload.events,
        consent: payload.consent,
        encoding: 'HEX',
        validateOnly: config.validateOnly,
      }),
      signal: controller.signal,
      redirect: 'error',
    })
    const parsed = await readJson(response)
    if (!response.ok) {
      const status =
        response.status === 401 || response.status === 403
          ? 'not_configured'
          : response.status === 429 || response.status >= 500
            ? 'retry'
            : 'invalid'
      return failure(
        status,
        `google_ads_http_${response.status}`,
        `Google Data Manager returned HTTP ${response.status}`,
        response.status,
      )
    }
    const requestId = str(parsed?.requestId, 512)
    if (!parsed || parsed.error || (!config.validateOnly && !requestId)) {
      return failure(
        'retry',
        'google_ads_response_invalid',
        'Google Data Manager did not return an acceptance receipt',
        response.status,
      )
    }
    return {
      status: config.validateOnly ? 'validated' : 'sent',
      http_status: response.status,
      error_code: null,
      error_message: null,
      response_payload: compact({
        requestId,
        fieldWarnings: sanitizedWarnings(parsed.fieldWarnings),
        processing_status: config.validateOnly ? 'validated' : 'accepted',
      }),
    }
  } catch {
    return failure('retry', 'google_ads_fetch_error', 'Google request failed, timed out or was cancelled')
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', cancel)
  }
}

export const googleAdsDestinationConnector: DestinationConnector = {
  destination: 'google_ads',
  pendingStatuses: ['pending', 'retry', 'not_configured'],
  notConfiguredErrorCode: 'google_ads_not_configured',
  notConfiguredMessage: 'Set Google Data Manager OAuth credentials and a conversion action id to enable dispatch',
  isConfigured: () => isGoogleAdsConfigured(getGoogleAdsConfig()),
  send: (payload, signal) => sendGoogleAdsPurchasePayload(payload, getGoogleAdsConfig(), signal),
}
