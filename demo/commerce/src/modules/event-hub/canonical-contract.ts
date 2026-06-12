export type CanonicalDestination = 'posthog' | 'ga4' | 'meta_capi' | 'google_ads' | 'tiktok'

export type CanonicalEventName =
  | 'page_view'
  | 'view_item_list'
  | 'view_item'
  | 'search'
  | 'add_to_cart'
  | 'remove_from_cart'
  | 'view_cart'
  | 'begin_checkout'
  | 'add_contact_info'
  | 'add_shipping_info'
  | 'add_payment_info'
  | 'purchase'
  | 'cart:updated'
  | 'cart:cleared'
  | 'cart:closed'
  | 'cart:discount_applied'
  | 'checkout:address_info_submitted'

export type DestinationContractResult = {
  supported: boolean
  event_name: string | null
  ready: boolean
  blockers: string[]
}

export type CanonicalValidationResult = {
  contract_version: string
  event_name: string
  valid: boolean
  errors: string[]
  destinations: Record<CanonicalDestination, DestinationContractResult>
}

type CanonicalEventContract = {
  crmOnly?: boolean
  destinations: Partial<Record<CanonicalDestination, string>>
  requires?: {
    url?: boolean
    searchTerm?: boolean
    items?: boolean
    valueCurrency?: boolean
    transactionId?: boolean
  }
}

type ValidateInput = {
  eventName: string
  eventId: string | null
  eventTime?: string | Date | null
  eventIdWasGenerated?: boolean
  payload: Record<string, unknown>
}

export const CANONICAL_CONTRACT_VERSION = 'event-hub-contract-2026-06-11'

export const CANONICAL_EVENT_CONTRACTS: Record<CanonicalEventName, CanonicalEventContract> = {
  page_view: {
    destinations: { posthog: 'page_view', ga4: 'page_view', meta_capi: 'PageView', tiktok: 'Pageview' },
    requires: { url: true },
  },
  view_item_list: {
    destinations: { posthog: 'view_item_list', ga4: 'view_item_list' },
    requires: { url: true, items: true },
  },
  view_item: {
    destinations: { posthog: 'view_item', ga4: 'view_item', meta_capi: 'ViewContent', tiktok: 'ViewContent' },
    requires: { url: true, items: true },
  },
  search: {
    destinations: { posthog: 'search', ga4: 'search', meta_capi: 'Search', tiktok: 'Search' },
    requires: { url: true, searchTerm: true },
  },
  add_to_cart: {
    destinations: { posthog: 'add_to_cart', ga4: 'add_to_cart', meta_capi: 'AddToCart', tiktok: 'AddToCart' },
    requires: { items: true, valueCurrency: true },
  },
  remove_from_cart: {
    destinations: { posthog: 'remove_from_cart', ga4: 'remove_from_cart' },
    requires: { items: true },
  },
  view_cart: {
    destinations: { posthog: 'view_cart', ga4: 'view_cart' },
  },
  begin_checkout: {
    destinations: {
      posthog: 'begin_checkout',
      ga4: 'begin_checkout',
      meta_capi: 'InitiateCheckout',
      tiktok: 'InitiateCheckout',
    },
    requires: { valueCurrency: true },
  },
  add_contact_info: {
    destinations: { posthog: 'add_contact_info', meta_capi: 'Lead' },
  },
  add_shipping_info: {
    destinations: { posthog: 'add_shipping_info', ga4: 'add_shipping_info' },
    requires: { valueCurrency: true },
  },
  add_payment_info: {
    destinations: { posthog: 'add_payment_info', ga4: 'add_payment_info' },
    requires: { valueCurrency: true },
  },
  purchase: {
    destinations: {
      posthog: 'purchase',
      ga4: 'purchase',
      meta_capi: 'Purchase',
      google_ads: 'purchase',
      tiktok: 'CompletePayment',
    },
    requires: { valueCurrency: true, transactionId: true },
  },
  'cart:updated': { crmOnly: true, destinations: { posthog: 'cart:updated' } },
  'cart:cleared': { crmOnly: true, destinations: { posthog: 'cart:cleared' } },
  'cart:closed': { crmOnly: true, destinations: { posthog: 'cart:closed' } },
  'cart:discount_applied': { crmOnly: true, destinations: { posthog: 'cart:discount_applied' } },
  'checkout:address_info_submitted': {
    crmOnly: true,
    destinations: { posthog: 'checkout:address_info_submitted' },
  },
}

export const GA4_CANONICAL_EVENT_NAMES = new Set(
  Object.entries(CANONICAL_EVENT_CONTRACTS)
    .filter(([, contract]) => Boolean(contract.destinations.ga4))
    .map(([eventName]) => eventName),
)

export function isCanonicalEventName(value: string): value is CanonicalEventName {
  return Object.hasOwn(CANONICAL_EVENT_CONTRACTS, value)
}

export function validateCanonicalEvent(input: ValidateInput): CanonicalValidationResult {
  const payload = input.payload
  const contract = isCanonicalEventName(input.eventName) ? CANONICAL_EVENT_CONTRACTS[input.eventName] : null
  const errors: string[] = []

  if (!contract) errors.push('canonical_event_not_supported')
  if (!str(input.eventId, 180)) errors.push('event_id_missing')
  if (input.eventIdWasGenerated) errors.push('event_id_server_generated')
  if (!validEventTime(input.eventTime)) errors.push('event_time_missing_or_invalid')
  if (contract?.crmOnly) errors.push('non_dispatchable_internal_event')

  const context = obj(payload.context)
  const ecommerce = obj(payload.ecommerce)
  const checkout = obj(payload.checkout)
  const items = Array.isArray(ecommerce.items) ? ecommerce.items : []

  if (contract?.requires?.url && !str(context.url, 4096)) errors.push('url_missing')
  if (contract?.requires?.searchTerm && !str(payload.search_term, 300)) errors.push('search_term_missing')
  if (contract?.requires?.items && items.length === 0) errors.push('items_missing')
  if (contract?.requires?.valueCurrency) {
    if (num(ecommerce.value) == null) errors.push('value_missing')
    if (!str(ecommerce.currency, 8)) errors.push('currency_missing')
  }
  if (contract?.requires?.transactionId) {
    if (!str(ecommerce.transaction_id, 180) && !str(checkout.shopify_order_id, 180)) {
      errors.push('transaction_id_missing')
    }
  }

  const destinations = buildDestinationResults(input.eventName, contract, payload)

  return {
    contract_version: CANONICAL_CONTRACT_VERSION,
    event_name: input.eventName,
    valid: errors.length === 0,
    errors,
    destinations,
  }
}

export function validationErrorsForSupportedDestinations(validation: CanonicalValidationResult): string[] {
  const errors: string[] = [...validation.errors]
  for (const [destination, result] of Object.entries(validation.destinations)) {
    if (!result.supported || result.ready) continue
    for (const blocker of result.blockers) {
      if (isConsentBlocker(blocker)) continue
      errors.push(`${destination}:${blocker}`)
    }
  }
  return unique(errors)
}

function isConsentBlocker(blocker: string): boolean {
  return (
    blocker === 'analytics_consent_not_granted' ||
    blocker === 'ad_storage_consent_not_granted' ||
    blocker === 'ad_user_data_consent_not_granted' ||
    blocker === 'ad_personalization_consent_not_granted'
  )
}

function buildDestinationResults(
  eventName: string,
  contract: CanonicalEventContract | null,
  payload: Record<string, unknown>,
): Record<CanonicalDestination, DestinationContractResult> {
  return {
    posthog: destinationResult('posthog', eventName, contract, payload),
    ga4: destinationResult('ga4', eventName, contract, payload),
    meta_capi: destinationResult('meta_capi', eventName, contract, payload),
    google_ads: destinationResult('google_ads', eventName, contract, payload),
    tiktok: destinationResult('tiktok', eventName, contract, payload),
  }
}

function destinationResult(
  destination: CanonicalDestination,
  eventName: string,
  contract: CanonicalEventContract | null,
  payload: Record<string, unknown>,
): DestinationContractResult {
  const mappedName = contract?.destinations[destination] ?? null
  if (!mappedName) return { supported: false, event_name: null, ready: false, blockers: ['destination_not_supported'] }

  const blockers: string[] = []
  const user = obj(payload.user)
  const context = obj(payload.context)
  const ecommerce = obj(payload.ecommerce)
  const checkout = obj(payload.checkout)
  const consent = obj(payload.consent)

  if (destination === 'posthog') {
    return { supported: true, event_name: mappedName, ready: true, blockers }
  }

  if (destination === 'ga4') {
    if (!str(user.ga_client_id, 128)) blockers.push('ga4_client_id_missing')
    if (consent.analytics_storage !== true) blockers.push('analytics_consent_not_granted')
  }

  if (destination === 'meta_capi') {
    if (!str(context.url, 4096)) blockers.push('event_source_url_missing')
    if (!str(user.client_ip, 256)) blockers.push('client_ip_missing')
    if (!str(user.user_agent, 1024)) blockers.push('user_agent_missing')
    if (!hasAny(user, ['email_sha256', 'phone_sha256', 'fbp', 'fbc', 'external_id', 'shopify_customer_id'])) {
      blockers.push('meta_user_data_missing')
    }
    addAdsConsentBlockers(blockers, consent)
  }

  if (destination === 'google_ads') {
    if (eventName !== 'purchase') blockers.push('google_ads_conversion_not_supported')
    if (!str(ecommerce.transaction_id, 180) && !str(checkout.shopify_order_id, 180)) {
      blockers.push('order_id_missing')
    }
    if (num(ecommerce.value) == null) blockers.push('conversion_value_missing')
    if (!str(ecommerce.currency, 8)) blockers.push('conversion_currency_missing')
    if (!hasAny(user, ['gclid', 'email_sha256', 'phone_sha256'])) blockers.push('google_ads_identifier_missing')
    addAdsConsentBlockers(blockers, consent)
  }

  if (destination === 'tiktok') {
    if (!str(context.url, 4096)) blockers.push('event_source_url_missing')
    if (!hasAny(user, ['ttclid', 'email_sha256', 'phone_sha256', 'client_ip', 'user_agent'])) {
      blockers.push('tiktok_match_key_missing')
    }
    addAdsConsentBlockers(blockers, consent)
  }

  if (
    ['view_item', 'view_item_list', 'add_to_cart', 'remove_from_cart'].includes(eventName) &&
    Array.isArray(ecommerce.items) &&
    ecommerce.items.length === 0
  ) {
    blockers.push('items_missing')
  }
  if (['add_to_cart', 'begin_checkout', 'add_shipping_info', 'add_payment_info', 'purchase'].includes(eventName)) {
    if (num(ecommerce.value) == null) blockers.push('value_missing')
    if (!str(ecommerce.currency, 8)) blockers.push('currency_missing')
  }
  if (eventName === 'purchase' && !str(ecommerce.transaction_id, 180) && !str(checkout.shopify_order_id, 180)) {
    blockers.push('transaction_id_missing')
  }

  return { supported: true, event_name: mappedName, ready: blockers.length === 0, blockers: unique(blockers) }
}

function addAdsConsentBlockers(blockers: string[], consent: Record<string, unknown>) {
  if (consent.ad_storage !== true) blockers.push('ad_storage_consent_not_granted')
  if (consent.ad_user_data !== true) blockers.push('ad_user_data_consent_not_granted')
  if (consent.ad_personalization !== true) blockers.push('ad_personalization_consent_not_granted')
}

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

function validEventTime(value: string | Date | null | undefined): boolean {
  if (!value) return false
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime())
}

function hasAny(source: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => Boolean(str(source[key], 2048)))
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}
