import type { DestinationConnector, DispatchSendResult, DispatchStatus } from './destination-connector'

export type GoogleAdsDispatchStatus = DispatchStatus

export type GoogleAdsConfig = {
  developerToken: string | null
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
  apiVersion: string
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
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
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

function googleConsent(value: unknown): 'GRANTED' | 'DENIED' | 'UNSPECIFIED' {
  if (value === true) return 'GRANTED'
  if (value === false) return 'DENIED'
  return 'UNSPECIFIED'
}

function toGoogleAdsDateTime(value: unknown): string | null {
  const raw = str(value, 80)
  const parsed = raw ? new Date(raw) : new Date()
  if (!Number.isFinite(parsed.getTime())) return null
  return parsed
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, '+00:00')
}

export function getGoogleAdsConfig(env: NodeJS.ProcessEnv = process.env): GoogleAdsConfig {
  const apiVersion = (env.GOOGLE_ADS_API_VERSION || 'v24').trim()
  return {
    developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN || null,
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
    apiVersion,
    validateOnly: env.GOOGLE_ADS_VALIDATE_ONLY === 'true',
    endpoint: env.GOOGLE_ADS_ENDPOINT || `https://googleads.googleapis.com/${apiVersion}`,
    oauthTokenEndpoint: env.GOOGLE_OAUTH_TOKEN_ENDPOINT || 'https://oauth2.googleapis.com/token',
  }
}

export function isGoogleAdsConfigured(config: GoogleAdsConfig = getGoogleAdsConfig()) {
  return Boolean(
    config.developerToken &&
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
  const userAgent = str(user.user_agent, 1024)

  if (!conversionActionId) errors.push('google_ads_conversion_action_id_missing')
  if (!conversionDateTime) errors.push('google_ads_conversion_date_time_missing')
  if (
    ['purchase', 'add_to_cart', 'begin_checkout', 'add_shipping_info', 'add_payment_info'].includes(canonicalEventName)
  ) {
    if (conversionValue == null) errors.push('google_ads_conversion_value_missing')
    if (!currencyCode) errors.push('google_ads_currency_code_missing')
  }
  if (canonicalEventName === 'purchase' && !orderId) errors.push('google_ads_order_id_missing')
  if (!gclid && !gbraid && !wbraid && !isSha256(hashedEmail) && !isSha256(hashedPhone)) {
    errors.push('google_ads_identifier_missing')
  }
  if (consent.ad_storage !== true) errors.push('google_ads_ad_storage_consent_not_granted')
  if (consent.ad_user_data !== true) errors.push('google_ads_ad_user_data_consent_not_granted')
  if (consent.ad_personalization !== true) errors.push('google_ads_ad_personalization_consent_not_granted')

  const userIdentifiers = [
    isSha256(hashedEmail)
      ? {
          hashedEmail,
          userIdentifierSource: 'FIRST_PARTY',
        }
      : null,
    isSha256(hashedPhone)
      ? {
          hashedPhoneNumber: hashedPhone,
          userIdentifierSource: 'FIRST_PARTY',
        }
      : null,
  ].filter(Boolean)

  const conversion = compact({
    conversionAction:
      customerId && conversionActionId ? `customers/${customerId}/conversionActions/${conversionActionId}` : null,
    conversionDateTime,
    conversionValue,
    currencyCode,
    orderId: canonicalEventName === 'purchase' ? orderId : null,
    gclid,
    gbraid,
    wbraid,
    userAgent,
    consent: {
      adUserData: googleConsent(consent.ad_user_data),
      adPersonalization: googleConsent(consent.ad_personalization),
    },
    userIdentifiers: userIdentifiers.length > 0 ? userIdentifiers : null,
  })

  const payload = {
    customerId,
    conversions: [conversion],
    partialFailure: true,
    validateOnly: false,
  }
  const metadata = compact({
    event_name: canonicalEventName,
    conversion_action_id: conversionActionId,
    order_id: orderId,
    gclid_present: Boolean(gclid),
    gbraid_present: Boolean(gbraid),
    wbraid_present: Boolean(wbraid),
    enhanced_conversion_present: userIdentifiers.length > 0,
    consent_ad_user_data: consent.ad_user_data,
    consent_ad_personalization: consent.ad_personalization,
  })

  return errors.length === 0
    ? { supported: true, ok: true, payload, metadata }
    : { supported: true, ok: false, errors, payload, metadata }
}

async function fetchAccessToken(config: GoogleAdsConfig, signal?: AbortSignal): Promise<string> {
  const body = new URLSearchParams({
    client_id: config.clientId ?? '',
    client_secret: config.clientSecret ?? '',
    refresh_token: config.refreshToken ?? '',
    grant_type: 'refresh_token',
  })
  const res = await fetch(config.oauthTokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal,
  })
  const text = await res.text().catch(() => '')
  const parsed = text ? safeJson(text) : null
  const accessToken = str(parsed?.access_token, 4096)
  if (res.ok && accessToken) return accessToken
  const message = str(parsed?.error_description, 1000) || str(parsed?.error, 1000) || text.slice(0, 1000)
  throw new MantaError('UNEXPECTED_STATE', message || `OAuth token request failed with HTTP ${res.status}`)
}

export async function sendGoogleAdsPurchasePayload(
  payload: Record<string, unknown>,
  config: GoogleAdsConfig = getGoogleAdsConfig(),
  signal?: AbortSignal,
): Promise<GoogleAdsSendResult> {
  if (!isGoogleAdsConfigured(config)) {
    return {
      status: 'not_configured',
      http_status: null,
      error_code: 'google_ads_not_configured',
      error_message: 'Google Ads API credentials and at least one conversion action id are required',
      response_payload: null,
    }
  }

  const customerId = str(payload.customerId, 32) || config.customerId
  const conversions = Array.isArray(payload.conversions) ? payload.conversions : []
  if (!customerId || conversions.length === 0) {
    return {
      status: 'invalid',
      http_status: null,
      error_code: 'google_ads_payload_invalid',
      error_message: 'Google Ads payload must include customerId and at least one conversion',
      response_payload: null,
    }
  }

  try {
    const accessToken = await fetchAccessToken(config, signal)
    const endpoint = `${config.endpoint.replace(/\/$/, '')}/customers/${customerId}:uploadClickConversions`
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'developer-token': config.developerToken ?? '',
    }
    if (config.loginCustomerId) headers['login-customer-id'] = config.loginCustomerId

    const enrichedConversions = conversions.map((conversion) => {
      const row = obj(conversion)
      return compact({
        ...row,
        conversionAction:
          str(row.conversionAction, 256) ||
          `customers/${customerId}/conversionActions/${config.purchaseConversionActionId}`,
      })
    })

    const requestBody = {
      conversions: enrichedConversions,
      partialFailure: true,
      validateOnly: config.validateOnly,
    }
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal,
    })
    const text = await res.text().catch(() => '')
    const responsePayload = text ? safeJson(text) : null
    const partialFailure = obj(responsePayload?.partialFailureError)

    if (res.ok && Object.keys(partialFailure).length === 0) {
      return {
        status: 'sent',
        http_status: res.status,
        error_code: null,
        error_message: null,
        response_payload: responsePayload,
      }
    }

    if (res.ok && Object.keys(partialFailure).length > 0) {
      return {
        status: 'invalid',
        http_status: res.status,
        error_code: 'google_ads_partial_failure',
        error_message: JSON.stringify(partialFailure).slice(0, 1000),
        response_payload: responsePayload,
      }
    }

    return {
      status: res.status >= 500 || res.status === 429 ? 'retry' : 'error',
      http_status: res.status,
      error_code: `google_ads_http_${res.status}`,
      error_message: text.slice(0, 1000) || res.statusText,
      response_payload: responsePayload,
    }
  } catch (err) {
    return {
      status: 'retry',
      http_status: null,
      error_code: 'google_ads_fetch_error',
      error_message: err instanceof Error ? err.message.slice(0, 1000) : String(err).slice(0, 1000),
      response_payload: null,
    }
  }
}

export const googleAdsDestinationConnector: DestinationConnector = {
  destination: 'google_ads',
  pendingStatuses: ['pending', 'retry', 'not_configured'],
  notConfiguredErrorCode: 'google_ads_not_configured',
  notConfiguredMessage: 'Set Google Ads API credentials and at least one conversion action id to enable dispatch',
  isConfigured: () => isGoogleAdsConfigured(getGoogleAdsConfig()),
  send: (payload, signal) => sendGoogleAdsPurchasePayload(payload, getGoogleAdsConfig(), signal),
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    return obj(JSON.parse(text))
  } catch {
    return { text: text.slice(0, 1000) }
  }
}
