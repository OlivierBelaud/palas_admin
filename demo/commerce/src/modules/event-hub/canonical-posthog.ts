import { createHash } from 'node:crypto'
import { stableMuidForEmail, verifyContactToken } from '../../utils/manta-uid'
import { normalizeCartEvent, type PosthogEvent } from '../cart-tracking/posthog-adapter'
import {
  emailSha256,
  extractIdentitySignals,
  type IdentityShadowComparison,
  type RawPosthogEvent,
} from '../identity/resolve-event-identity'
import { validateCanonicalEvent, validationErrorsForSupportedDestinations } from './canonical-contract'

export type CanonicalPosthogEvent = {
  event_id: string
  event_name: string
  raw_event_name: string
  event_time: string
  source: 'posthog_proxy'
  page_type: string | null
  market: string | null
  valid: boolean
  validation_errors: string[]
  identity_email_sha256: string | null
  identity_muid: string | null
  distinct_id: string | null
  payload_normalized: Record<string, unknown>
}

export type PosthogForwardStatus = {
  forwarded?: boolean
  status?: number | null
}

const RAW_TO_CANONICAL: Record<string, string> = {
  'cart:product_added': 'add_to_cart',
  'cart:product_removed': 'remove_from_cart',
  'cart:viewed': 'view_cart',
  'checkout:started': 'begin_checkout',
  'checkout:contact_info_submitted': 'add_contact_info',
  'checkout:shipping_info_submitted': 'add_shipping_info',
  'checkout:payment_info_submitted': 'add_payment_info',
  'checkout:completed': 'purchase',
  page_view: 'page_view',
  view_item_list: 'view_item_list',
  view_item: 'view_item',
  search: 'search',
  add_to_cart: 'add_to_cart',
  remove_from_cart: 'remove_from_cart',
  view_cart: 'view_cart',
  begin_checkout: 'begin_checkout',
  add_contact_info: 'add_contact_info',
  add_shipping_info: 'add_shipping_info',
  add_payment_info: 'add_payment_info',
  purchase: 'purchase',
}

const INTERNAL_EVENTS = new Set([
  'cart:updated',
  'cart:cleared',
  'cart:closed',
  'cart:discount_applied',
  'checkout:address_info_submitted',
])

const SKIPPED_POSTHOG_EVENTS = new Set(['$snapshot', '$autocapture', '$web_vitals', '$pageleave', '$identify'])

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function str(value: unknown, max = 1024): string | null {
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

function bool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return null
}

function stableHash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function parseUrl(url: string | null): URL | null {
  if (!url) return null
  try {
    return new URL(url)
  } catch {
    return null
  }
}

function queryParamFromUrl(url: string | null, key: string, max = 512): string | null {
  const parsed = parseUrl(url)
  return parsed ? str(parsed.searchParams.get(key), max) : null
}

function fbcFromClickId(url: string | null, observedAt: string | null): string | null {
  const fbclid = queryParamFromUrl(url, 'fbclid')
  if (!fbclid) return null
  const parsed = observedAt ? new Date(observedAt) : new Date()
  const seconds = Number.isFinite(parsed.getTime())
    ? Math.floor(parsed.getTime() / 1000)
    : Math.floor(Date.now() / 1000)
  return `fb.1.${seconds}.${fbclid}`
}

function muidFromMantaToken(token: string | null): string | null {
  if (!token) return null
  try {
    const verified = verifyContactToken(token)
    return verified ? stableMuidForEmail(verified.email) : null
  } catch {
    return null
  }
}

export function inferPageType(currentUrl: string | null): string | null {
  const url = parseUrl(currentUrl)
  if (!url) return null
  const path = url.pathname.toLowerCase()
  const parts = path.split('/').filter(Boolean)
  if (parts.length === 0) return 'home'
  if (parts.includes('products')) return 'product'
  if (parts[0] === 'collections') return 'collection'
  if (parts[0] === 'search') return 'search'
  if (parts[0] === 'cart') return 'cart'
  if (parts[0] === 'checkout' || parts[0] === 'checkouts') return 'checkout'
  return 'other'
}

function canonicalPageViewName(pageType: string | null): string {
  void pageType
  return 'page_view'
}

function inferMarket(props: Record<string, unknown>, currentUrl: string | null): string | null {
  const direct = str(props.market, 32) || str(props.$geoip_country_code, 32)
  if (direct) return direct.toUpperCase()
  const url = parseUrl(currentUrl)
  const first = url?.pathname.split('/').filter(Boolean)[0]
  return first && /^[a-z]{2}$/i.test(first) ? first.toUpperCase() : null
}

function idStr(value: unknown, max = 160): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value)).slice(0, max)
  return str(value, max)
}

function normalizeItems(items: unknown[]): Array<Record<string, unknown>> {
  return items.slice(0, 24).map((item, index) => {
    const row = obj(item)
    return {
      item_id:
        idStr(row.item_id, 160) ||
        idStr(row.variant_id, 160) ||
        idStr(row.product_id, 160) ||
        idStr(row.id, 160) ||
        idStr(row.sku, 160) ||
        null,
      item_name: str(row.item_name, 240) || str(row.title, 240) || str(row.name, 240) || null,
      item_variant: str(row.item_variant, 160) || str(row.variant_title, 160) || null,
      price: num(row.price),
      quantity: num(row.quantity) ?? 1,
      index,
    }
  })
}

function consentFromPosthogProperties(
  props: Record<string, unknown>,
  sourceContext: Record<string, unknown>,
): Record<string, unknown> {
  const consent = obj(props.consent)
  const sourceConsent = obj(sourceContext.consent)
  const analyticsStorage =
    bool(sourceContext.analytics_storage) ??
    bool(sourceConsent.analytics_storage) ??
    bool(consent.analytics_storage) ??
    bool(props.analytics_storage) ??
    bool(props.palas_consent_analytics)
  const adsConsent =
    bool(sourceContext.palas_consent_ads) ??
    bool(sourceContext.ad_storage) ??
    bool(sourceConsent.ad_storage) ??
    bool(consent.ad_storage) ??
    bool(props.ad_storage) ??
    bool(props.palas_consent_ads)
  const adUserData =
    bool(sourceContext.ad_user_data) ??
    bool(sourceConsent.ad_user_data) ??
    bool(consent.ad_user_data) ??
    bool(props.ad_user_data) ??
    adsConsent
  const adPersonalization =
    bool(sourceContext.ad_personalization) ??
    bool(sourceConsent.ad_personalization) ??
    bool(consent.ad_personalization) ??
    bool(props.ad_personalization) ??
    adsConsent

  return {
    analytics_storage: analyticsStorage,
    ad_storage: adsConsent,
    ad_user_data: adUserData,
    ad_personalization: adPersonalization,
    source:
      str(sourceContext.consent_source, 120) ||
      str(sourceContext.palas_consent_source, 120) ||
      str(sourceConsent.source, 120) ||
      str(consent.source, 120) ||
      str(props.consent_source, 120) ||
      str(props.palas_consent_source, 120) ||
      'posthog_properties',
  }
}

export function normalizePosthogEventToCanonical(
  event: RawPosthogEvent,
  comparison: IdentityShadowComparison,
  forward: PosthogForwardStatus = {},
  sourceContext: Record<string, unknown> = {},
): CanonicalPosthogEvent | null {
  const rawEventName = str(event.event, 160) || 'unknown'
  if (SKIPPED_POSTHOG_EVENTS.has(rawEventName)) return null

  const props = obj(event.properties)
  const signals = comparison.signals ?? extractIdentitySignals(event)
  const currentUrl =
    signals.current_url || str(props.$current_url, 4096) || str(props.current_url, 4096) || str(props.url, 4096)
  const pageType = inferPageType(currentUrl)
  const cartEvent = normalizeCartEvent(event as PosthogEvent)

  const canonicalName =
    rawEventName === '$pageview'
      ? canonicalPageViewName(pageType)
      : RAW_TO_CANONICAL[rawEventName] || (INTERNAL_EVENTS.has(rawEventName) ? rawEventName : null)
  if (!canonicalName) return null

  const cartItems = cartEvent ? normalizeItems(cartEvent.items) : []
  const ecommerceProps = obj(props.ecommerce)
  const ecommerceItems = Array.isArray(ecommerceProps.items) ? normalizeItems(ecommerceProps.items) : []
  const eventItems = cartItems.length > 0 ? cartItems : ecommerceItems
  const eventIdFromSignal = signals.event_id
  const eventId =
    eventIdFromSignal ||
    `ph_${stableHash(`${rawEventName}|${signals.posthog_distinct_id ?? ''}|${signals.observed_at}|${currentUrl ?? ''}`).slice(0, 32)}`

  const ecommerce: Record<string, unknown> = {
    currency: cartEvent?.currency ?? str(ecommerceProps.currency, 8) ?? str(props.currency, 8),
    value: cartEvent?.total_price ?? num(ecommerceProps.value) ?? num(props.value) ?? num(props.total_price),
    transaction_id:
      cartEvent?.shopify_order_id ?? str(ecommerceProps.transaction_id, 180) ?? str(props.transaction_id, 180) ?? null,
    coupon: cartEvent?.discount_code ?? str(ecommerceProps.coupon, 160) ?? str(props.coupon, 160) ?? null,
    shipping: cartEvent?.shipping_price ?? num(ecommerceProps.shipping),
    tax: cartEvent?.total_tax ?? num(ecommerceProps.tax),
    item_list_id: str(ecommerceProps.item_list_id, 160),
    item_list_name: str(ecommerceProps.item_list_name, 240),
    item_count: cartEvent?.item_count ?? num(ecommerceProps.item_count) ?? eventItems.length,
    items: eventItems,
  }
  const tokenMuid = muidFromMantaToken(
    queryParamFromUrl(currentUrl, 'u', 4096) ||
      str(obj(props.user).manta_uid_token, 4096) ||
      str(props.manta_uid_token, 4096),
  )
  const userProps = obj(props.user)
  const userDataProps = obj(props.user_data)
  const setProps = obj(props.$set)
  const muid =
    tokenMuid ||
    str(sourceContext.muid, 128) ||
    str(props.muid, 128) ||
    str(props.palas_muid, 128) ||
    str(userProps.muid, 128) ||
    str(userDataProps.muid, 128) ||
    str(setProps.palas_muid, 128) ||
    null

  const payload: Record<string, unknown> = {
    event_id: eventId,
    raw_event_name: rawEventName,
    canonical_source: rawEventName === '$pageview' ? 'posthog_pageview_derivation' : 'posthog_event_mapping',
    event_time: signals.observed_at,
    search_term: str(props.search_term, 300) || str(ecommerceProps.search_term, 300),
    user: {
      muid,
      identity_status: comparison.status,
      identity_source: comparison.v2.source,
      contact_id: comparison.v2.contact_id,
      email_sha256: emailSha256(comparison.v2.email),
      distinct_id: signals.posthog_distinct_id,
      session_id: signals.session_id,
      ga_client_id:
        str(sourceContext.ga_client_id, 128) ||
        str(props.ga_client_id, 128) ||
        str(props.$ga_client_id, 128) ||
        muid ||
        str(signals.posthog_distinct_id, 128),
      ga_session_id: str(props.ga_session_id, 128) || str(props.$ga_session_id, 128),
      fbp:
        str(sourceContext.fbp, 256) ||
        str(userProps.fbp, 256) ||
        str(userDataProps.fbp, 256) ||
        str(props.fbp, 256) ||
        str(props._fbp, 256),
      fbc:
        str(sourceContext.fbc, 256) ||
        str(userProps.fbc, 256) ||
        str(userDataProps.fbc, 256) ||
        str(props.fbc, 256) ||
        str(props._fbc, 256) ||
        fbcFromClickId(currentUrl, signals.observed_at),
      gclid: str(sourceContext.gclid, 512) || str(props.gclid, 512) || queryParamFromUrl(currentUrl, 'gclid'),
      gbraid: str(sourceContext.gbraid, 512) || str(props.gbraid, 512) || queryParamFromUrl(currentUrl, 'gbraid'),
      wbraid: str(sourceContext.wbraid, 512) || str(props.wbraid, 512) || queryParamFromUrl(currentUrl, 'wbraid'),
      fbclid: str(sourceContext.fbclid, 512) || str(props.fbclid, 512) || queryParamFromUrl(currentUrl, 'fbclid'),
      ttclid: str(sourceContext.ttclid, 512) || str(props.ttclid, 512) || queryParamFromUrl(currentUrl, 'ttclid'),
      client_ip:
        str(sourceContext.client_ip, 256) || str(userProps.client_ip, 256) || str(userDataProps.client_ip, 256),
      user_agent:
        str(sourceContext.user_agent, 1024) ||
        str(props.$raw_user_agent, 1024) ||
        str(props.user_agent, 1024) ||
        str(userProps.user_agent, 1024) ||
        str(userProps.userAgent, 1024) ||
        str(userDataProps.user_agent, 1024) ||
        str(userDataProps.userAgent, 1024),
      matched_v1: comparison.matched_v1,
    },
    context: {
      url: currentUrl,
      referrer: str(props.$referrer, 4096) || str(props.referrer, 4096),
      page_type: pageType,
      market: inferMarket(props, currentUrl),
      locale: str(props.$browser_language, 32) || str(props.locale, 32),
      utm: {
        source:
          str(props.utm_source, 160) ||
          str(props.$utm_source, 160) ||
          str(props.$initial_utm_source, 160) ||
          queryParamFromUrl(currentUrl, 'utm_source', 160),
        medium:
          str(props.utm_medium, 160) ||
          str(props.$utm_medium, 160) ||
          str(props.$initial_utm_medium, 160) ||
          queryParamFromUrl(currentUrl, 'utm_medium', 160),
        campaign:
          str(props.utm_campaign, 240) ||
          str(props.$utm_campaign, 240) ||
          str(props.$initial_utm_campaign, 240) ||
          queryParamFromUrl(currentUrl, 'utm_campaign', 240),
        term:
          str(props.utm_term, 240) ||
          str(props.$utm_term, 240) ||
          str(props.$initial_utm_term, 240) ||
          queryParamFromUrl(currentUrl, 'utm_term', 240),
        content:
          str(props.utm_content, 240) ||
          str(props.$utm_content, 240) ||
          str(props.$initial_utm_content, 240) ||
          queryParamFromUrl(currentUrl, 'utm_content', 240),
        id:
          str(props.utm_id, 160) ||
          str(props.$utm_id, 160) ||
          str(props.$initial_utm_id, 160) ||
          queryParamFromUrl(currentUrl, 'utm_id', 160),
        source_platform:
          str(props.utm_source_platform, 160) || queryParamFromUrl(currentUrl, 'utm_source_platform', 160),
        creative_format:
          str(props.utm_creative_format, 160) || queryParamFromUrl(currentUrl, 'utm_creative_format', 160),
        marketing_tactic:
          str(props.utm_marketing_tactic, 160) || queryParamFromUrl(currentUrl, 'utm_marketing_tactic', 160),
      },
      ads: {
        campaign_id:
          str(props.campaign_id, 160) ||
          str(props.google_ads_campaign_id, 160) ||
          queryParamFromUrl(currentUrl, 'campaign_id', 160),
        ad_group_id:
          str(props.ad_group_id, 160) ||
          str(props.adgroup_id, 160) ||
          str(props.google_ads_ad_group_id, 160) ||
          queryParamFromUrl(currentUrl, 'ad_group_id', 160) ||
          queryParamFromUrl(currentUrl, 'adgroup_id', 160),
        adset_id:
          str(props.adset_id, 160) ||
          str(props.facebook_adset_id, 160) ||
          queryParamFromUrl(currentUrl, 'adset_id', 160),
        ad_id:
          str(props.ad_id, 160) ||
          str(props.google_ads_ad_id, 160) ||
          str(props.facebook_ad_id, 160) ||
          queryParamFromUrl(currentUrl, 'ad_id', 160),
        creative_id: str(props.creative_id, 160) || queryParamFromUrl(currentUrl, 'creative_id', 160),
        campaign_name: str(props.campaign_name, 240) || queryParamFromUrl(currentUrl, 'campaign_name', 240),
        ad_group_name: str(props.ad_group_name, 240) || queryParamFromUrl(currentUrl, 'ad_group_name', 240),
        adset_name: str(props.adset_name, 240) || queryParamFromUrl(currentUrl, 'adset_name', 240),
        ad_name: str(props.ad_name, 240) || queryParamFromUrl(currentUrl, 'ad_name', 240),
        placement: str(props.placement, 160) || queryParamFromUrl(currentUrl, 'placement', 160),
        network: str(props.network, 160) || queryParamFromUrl(currentUrl, 'network', 160),
        matchtype: str(props.matchtype, 80) || queryParamFromUrl(currentUrl, 'matchtype', 80),
      },
    },
    ecommerce,
    cart: {
      token: cartEvent?.cart_token ?? signals.cart_token,
    },
    checkout: {
      token: cartEvent?.checkout_token ?? signals.checkout_token,
      shopify_order_id: cartEvent?.shopify_order_id ?? null,
      is_first_order: cartEvent?.is_first_order ?? null,
    },
    consent: consentFromPosthogProperties(props, sourceContext),
    dispatch: {
      posthog: {
        status:
          forward.forwarded === false ? 'unknown' : forward.status && forward.status >= 400 ? 'error' : 'forwarded',
        http_status: forward.status ?? null,
      },
      ga4: {
        ready: true,
        status: 'pending',
      },
    },
  }

  const validation = validateCanonicalEvent({
    eventName: canonicalName,
    eventId,
    eventTime: signals.observed_at,
    eventIdWasGenerated: !eventIdFromSignal,
    payload,
  })
  payload.validation = validation
  const errors = validationErrorsForSupportedDestinations(validation)
  obj(obj(payload.dispatch).ga4).ready = errors.length === 0

  return {
    event_id: eventId,
    event_name: canonicalName,
    raw_event_name: rawEventName,
    event_time: signals.observed_at,
    source: 'posthog_proxy',
    page_type: pageType,
    market: inferMarket(props, currentUrl),
    valid: errors.length === 0,
    validation_errors: errors,
    identity_email_sha256: emailSha256(comparison.v2.email),
    identity_muid: muid,
    distinct_id: signals.posthog_distinct_id,
    payload_normalized: payload,
  }
}
