import { createHash } from 'node:crypto'
import { verifyContactToken } from '../../utils/manta-uid'

export type IdentityResolutionStatus = 'anonymous' | 'identified' | 'diverged' | 'error'

export interface RawPosthogEvent {
  uuid?: string | null
  event?: string | null
  distinct_id?: string | null
  timestamp?: string | null
  properties?: Record<string, unknown> | null
}

export interface ContactIdentityRow {
  id: string
  email: string | null
  distinct_id: string | null
  shopify_customer_id: string | null
  klaviyo_profile_id: string | null
}

export interface KlaviyoExchangeRow {
  email: string | null
}

export interface IdentityServiceLike {
  contact: {
    list(filters: Record<string, unknown>, opts?: { take?: number }): Promise<ContactIdentityRow[]>
  }
  klaviyoExchangeResolved?: {
    list(filters: Record<string, unknown>, opts?: { take?: number }): Promise<KlaviyoExchangeRow[]>
  }
}

export interface ExtractedIdentitySignals {
  event_id: string | null
  event_name: string
  observed_at: string
  posthog_distinct_id: string | null
  session_id: string | null
  current_url: string | null
  email: string | null
  manta_uid_token: string | null
  klaviyo_exchange_id: string | null
  klaviyo_profile_id: string | null
  shopify_customer_id: string | null
  cart_token: string | null
  checkout_token: string | null
}

export interface IdentityResolutionResult {
  email: string | null
  contact_id: string | null
  source: string | null
}

export interface IdentityShadowComparison {
  signals: ExtractedIdentitySignals
  v1: IdentityResolutionResult
  v2: IdentityResolutionResult
  matched_v1: boolean
  status: IdentityResolutionStatus
  aliases_seen: Record<string, unknown>
  evidence: Record<string, unknown>
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function emailSha256(email: string | null): string | null {
  return email ? sha256(email.trim().toLowerCase()) : null
}

function str(value: unknown, max = 1024): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max) return null
  return trimmed
}

function normalizeEmail(value: unknown): string | null {
  const email = str(value, 320)?.toLowerCase() ?? null
  return email && email.includes('@') ? email : null
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function first<T>(...values: Array<T | null | undefined>): T | null {
  for (const value of values) {
    if (value != null) return value
  }
  return null
}

function extractQueryParam(url: string | null, key: string): string | null {
  if (!url) return null
  try {
    return str(new URL(url).searchParams.get(key), 4096)
  } catch {
    return null
  }
}

export function extractKlaviyoExchangeId(...tokens: Array<string | null | undefined>): string | null {
  for (const token of tokens) {
    if (!token) continue
    try {
      const decoded = JSON.parse(Buffer.from(token, 'base64').toString()) as { $exchange_id?: unknown }
      const exchangeId = str(decoded.$exchange_id, 4096)
      if (exchangeId) return exchangeId
    } catch {
      if (token.includes('.') && token.length > 10) return token
    }
  }
  return null
}

export function extractIdentitySignals(event: RawPosthogEvent): ExtractedIdentitySignals {
  const props = obj(event.properties)
  const $set = obj(props.$set)
  const checkout = obj(props.checkout)
  const cart = obj(props.cart)
  const currentUrl = str(props.$current_url) || str(props.current_url) || str(props.url)

  const email = first(
    normalizeEmail($set.email),
    normalizeEmail(checkout.email),
    normalizeEmail(props.email),
    normalizeEmail(props.$email),
    normalizeEmail($set.$email),
    normalizeEmail(obj(checkout.customer).email),
    normalizeEmail(obj(checkout.billingAddress).email),
    normalizeEmail(props.$user_email),
  )

  const klaviyoExchangeId = extractKlaviyoExchangeId(
    str(props.$_kx, 4096),
    str(props.$kla_id, 4096),
    str($set.$_kx, 4096),
    str($set._kx, 4096),
    extractQueryParam(currentUrl, '_kx'),
  )

  return {
    event_id: str(event.uuid, 160) || str(props.$insert_id, 160) || str(props.$event_uuid, 160),
    event_name: str(event.event, 160) || 'unknown',
    observed_at: str(event.timestamp, 80) || new Date().toISOString(),
    posthog_distinct_id: str(event.distinct_id, 180) || str(props.distinct_id, 180),
    session_id: str(props.$session_id, 180) || str(props.session_id, 180),
    current_url: currentUrl,
    email,
    manta_uid_token:
      extractQueryParam(currentUrl, 'u') || str(obj(props.user).manta_uid_token, 4096) || str(props.manta_uid_token, 4096),
    klaviyo_exchange_id: klaviyoExchangeId,
    klaviyo_profile_id: str($set.klaviyo_profile_id, 180) || str(props.klaviyo_profile_id, 180),
    shopify_customer_id:
      str(checkout.shopify_customer_id, 180) || str(props.shopify_customer_id, 180) || str($set.shopify_customer_id, 180) || str($set.id, 180),
    cart_token: str(cart.token, 180) || str(props.cart_token, 180),
    checkout_token: str(checkout.token, 180) || str(props.checkout_token, 180),
  }
}

async function findContactByEmail(services: IdentityServiceLike, email: string | null): Promise<ContactIdentityRow | null> {
  if (!email) return null
  const rows = await services.contact.list({ email: email.trim().toLowerCase() }, { take: 1 })
  return rows[0] ?? null
}

async function findContactByField(
  services: IdentityServiceLike,
  field: 'distinct_id' | 'shopify_customer_id' | 'klaviyo_profile_id',
  value: string | null,
): Promise<ContactIdentityRow | null> {
  if (!value) return null
  const rows = await services.contact.list({ [field]: value }, { take: 1 })
  return rows[0] ?? null
}

async function resolveTokenEmail(signals: ExtractedIdentitySignals): Promise<string | null> {
  if (!signals.manta_uid_token) return null
  const verified = verifyContactToken(signals.manta_uid_token)
  return verified?.email ?? null
}

async function resolveKlaviyoExchangeEmail(
  services: IdentityServiceLike,
  exchangeId: string | null,
): Promise<string | null> {
  if (!exchangeId || !services.klaviyoExchangeResolved) return null
  const rows = await services.klaviyoExchangeResolved.list({ exchange_id: exchangeId }, { take: 1 })
  return rows[0]?.email?.trim().toLowerCase() ?? null
}

export async function resolveIdentityV2(
  signals: ExtractedIdentitySignals,
  services: IdentityServiceLike,
): Promise<IdentityResolutionResult> {
  if (signals.email) {
    const contact = await findContactByEmail(services, signals.email)
    return { email: signals.email, contact_id: contact?.id ?? null, source: 'event_email' }
  }

  const tokenEmail = await resolveTokenEmail(signals)
  if (tokenEmail) {
    const contact = await findContactByEmail(services, tokenEmail)
    return { email: tokenEmail, contact_id: contact?.id ?? null, source: 'manta_uid_token' }
  }

  const byDistinct = await findContactByField(services, 'distinct_id', signals.posthog_distinct_id)
  if (byDistinct?.email) return { email: byDistinct.email, contact_id: byDistinct.id, source: 'contact_distinct_id' }

  const byShopify = await findContactByField(services, 'shopify_customer_id', signals.shopify_customer_id)
  if (byShopify?.email) return { email: byShopify.email, contact_id: byShopify.id, source: 'shopify_customer_id' }

  const exchangeEmail = await resolveKlaviyoExchangeEmail(services, signals.klaviyo_exchange_id)
  if (exchangeEmail) {
    const contact = await findContactByEmail(services, exchangeEmail)
    return { email: exchangeEmail, contact_id: contact?.id ?? null, source: 'klaviyo_exchange_cache' }
  }

  const byKlaviyo = await findContactByField(services, 'klaviyo_profile_id', signals.klaviyo_profile_id)
  if (byKlaviyo?.email) return { email: byKlaviyo.email, contact_id: byKlaviyo.id, source: 'klaviyo_profile_id' }

  return { email: null, contact_id: null, source: null }
}

export async function compareIdentityResolvers(
  event: RawPosthogEvent,
  services: IdentityServiceLike,
): Promise<IdentityShadowComparison> {
  const signals = extractIdentitySignals(event)

  const v1Email = signals.email
  const v1Contact = await findContactByEmail(services, v1Email)
  const v1: IdentityResolutionResult = {
    email: v1Email,
    contact_id: v1Contact?.id ?? null,
    source: v1Email ? 'event_or_proxy_email' : null,
  }

  const v2 = await resolveIdentityV2(signals, services)
  const v1Hash = emailSha256(v1.email)
  const v2Hash = emailSha256(v2.email)
  const matchedV1 = v1Hash === v2Hash && (v1.contact_id ?? null) === (v2.contact_id ?? null)
  const identified = Boolean(v2.email || v2.contact_id)

  return {
    signals,
    v1,
    v2,
    matched_v1: matchedV1,
    status: matchedV1 ? (identified ? 'identified' : 'anonymous') : 'diverged',
    aliases_seen: {
      has_email: Boolean(signals.email),
      has_manta_uid_token: Boolean(signals.manta_uid_token),
      has_posthog_distinct_id: Boolean(signals.posthog_distinct_id),
      has_session_id: Boolean(signals.session_id),
      has_klaviyo_exchange_id: Boolean(signals.klaviyo_exchange_id),
      has_klaviyo_profile_id: Boolean(signals.klaviyo_profile_id),
      has_shopify_customer_id: Boolean(signals.shopify_customer_id),
      has_cart_token: Boolean(signals.cart_token),
      has_checkout_token: Boolean(signals.checkout_token),
    },
    evidence: {
      current_url: signals.current_url,
      v1_source: v1.source,
      v2_source: v2.source,
    },
  }
}
