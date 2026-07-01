import { createHash, randomUUID } from 'node:crypto'
import { type RuntimeApp, resolveSql } from '../../../../utils/manta-runtime'
import { stableMuidForEmail, verifyContactToken } from '../../../../utils/manta-uid'
import {
  isGa4CanonicalEventName,
  validateCanonicalEvent,
  validationErrorsForSupportedDestinations,
} from '../../canonical-contract'
import { flushDispatchLogByEventDestinationKey, type RawDispatchDb } from '../../dispatch-runner'
import { ga4ContextFromHeaders, ga4DestinationConnector, mapCanonicalToGa4 } from '../../ga4-connector'
import { mapCanonicalToGoogleAds } from '../../google-ads-connector'
import { mapCanonicalToMetaCapi } from '../../meta-capi-connector'

const COOKIE_NAME = 'muid'
const COOKIE_MAX_AGE = 390 * 24 * 60 * 60
const MAX_BODY_BYTES = 64 * 1024
const ALLOWED_DIRECT_INGEST_SOURCES = new Set(['posthog_proxy', 'posthog_sync', 'posthog_replay', 'event_hub_replay'])

const EVENT_NAME_MAP: Record<string, string> = {
  $pageview: 'page_view',
  view_collection: 'view_item_list',
  collection_viewed: 'view_item_list',
  'cart:product_added': 'add_to_cart',
  'cart:product_removed': 'remove_from_cart',
  'cart:updated': 'cart:updated',
  'cart:cleared': 'cart:cleared',
  'cart:viewed': 'view_cart',
  'cart:closed': 'cart:closed',
  'cart:discount_applied': 'cart:discount_applied',
  'checkout:started': 'begin_checkout',
  'checkout:contact_info_submitted': 'add_contact_info',
  'checkout:address_info_submitted': 'checkout:address_info_submitted',
  'checkout:shipping_info_submitted': 'add_shipping_info',
  'checkout:payment_info_submitted': 'add_payment_info',
  'checkout:completed': 'purchase',
  checkout_started: 'begin_checkout',
  checkout_shipping_info_submitted: 'add_shipping_info',
  payment_info_submitted: 'add_payment_info',
  checkout_completed: 'purchase',
}

type JsonRecord = Record<string, unknown>
type RuntimeSql = {
  unsafe<T = JsonRecord>(query: string, params?: unknown[]): Promise<T[]>
}
type ConsentState = {
  analyticsStorage: boolean
  adStorage: boolean
  adUserData: boolean
  adPersonalization: boolean
  source: string
}

function isOriginAllowed(origin: string, patterns: string[]): boolean {
  for (const p of patterns) {
    if (p === origin) return true
    const m = p.match(/^(https?:\/\/)\*\.(.+)$/)
    if (!m) continue
    const [, scheme, rootHost] = m
    if (origin === `${scheme}${rootHost}`) return true
    if (origin.startsWith(scheme) && origin.slice(scheme.length).endsWith(`.${rootHost}`)) return true
  }
  return false
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = (
    process.env.ALLOWED_CORS_ORIGIN ?? 'https://fancypalas.com,https://www.fancypalas.com,https://*.fancypalas.com'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Palas-Test',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    'Cache-Control': 'private, no-store',
  }
  if (origin && isOriginAllowed(origin, allowed)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}

function parseCookie(header: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const key = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (key) out[key] = decodeURIComponent(value)
  }
  return out
}

function cookieDomain(req: Request): string | null {
  const host = new URL(req.url).hostname
  return host === 'fancypalas.com' || host.endsWith('.fancypalas.com') ? '.fancypalas.com' : null
}

function cookieHeader(req: Request, muid: string): string {
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(muid)}`,
    'Path=/',
    `Max-Age=${COOKIE_MAX_AGE}`,
    'HttpOnly',
    'SameSite=Lax',
  ]
  const domain = cookieDomain(req)
  if (domain) attrs.push(`Domain=${domain}`)
  if (new URL(req.url).protocol === 'https:' || process.env.NODE_ENV === 'production') attrs.push('Secure')
  return attrs.join('; ')
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email.includes('@') && email.length <= 320 ? email : null
}

function str(value: unknown, max = 512): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max) return null
  return trimmed
}

function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(n) ? n : null
}

function obj(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}
}

function dispatchDb(sql: RuntimeSql): RawDispatchDb {
  return {
    raw: (query, params) => sql.unsafe(query, params),
  }
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function compact(input: JsonRecord): JsonRecord {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value != null && value !== ''))
}

function normalizeItems(items: unknown[]): JsonRecord[] {
  return items.slice(0, 24).map((item, index) => {
    const row = obj(item)
    return compact({
      item_id:
        str(row.item_id, 160) ||
        str(row.variant_id, 160) ||
        str(row.product_id, 160) ||
        str(row.id, 160) ||
        str(row.sku, 160),
      item_name: str(row.item_name, 240) || str(row.title, 240) || str(row.name, 240),
      item_variant: str(row.item_variant, 160) || str(row.variant_title, 160) || str(row.variant, 160),
      item_brand: str(row.item_brand, 160) || str(row.vendor, 160),
      item_category: str(row.item_category, 160) || str(row.product_type, 160),
      price: num(row.price),
      quantity: num(row.quantity) ?? 1,
      index: num(row.index) ?? index,
    })
  })
}

function pickEventName(body: JsonRecord): string {
  const raw = str(body.event_name, 128) || str(body.event, 128) || str(body.raw_event_name, 128) || 'unknown'
  return EVENT_NAME_MAP[raw] || raw
}

function pickSource(body: JsonRecord): string {
  return str(body.source, 80) || str(obj(body.event_data).source, 80) || 'unknown'
}

function isAllowedDirectIngestSource(source: string): boolean {
  return ALLOWED_DIRECT_INGEST_SOURCES.has(source)
}

function pickEventId(body: JsonRecord, eventName: string): { value: string; generated: boolean } {
  const eventData = obj(body.event_data)
  const explicit = str(body.event_id, 160) || str(eventData.id, 160)
  if (explicit) return { value: explicit, generated: false }
  return { value: `palas_${eventName}_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`, generated: true }
}

function pickEventTime(body: JsonRecord): Date {
  const eventData = obj(body.event_data)
  const raw = str(body.event_time, 80) || str(eventData.timestamp, 80) || str(body.timestamp, 80)
  if (!raw) return new Date()
  const parsed = new Date(raw)
  return Number.isFinite(parsed.getTime()) ? parsed : new Date()
}

function deriveMuidFromToken(token: string): { muid: string; emailSha256: string | null } | null {
  try {
    const verified = verifyContactToken(token)
    if (!verified) return null
    const email = verified.email.trim().toLowerCase()
    return {
      muid: stableMuidForEmail(email),
      emailSha256: sha256(email),
    }
  } catch {
    return null
  }
}

function newMuid(): string {
  return `muid_${randomUUID().replace(/-/g, '')}`
}

function readConsent(body: JsonRecord): ConsentState {
  const consent = obj(body.consent)
  return {
    analyticsStorage: consent.analytics_storage === true,
    adStorage: consent.ad_storage === true,
    adUserData: consent.ad_user_data === true,
    adPersonalization: consent.ad_personalization === true,
    source: str(consent.source, 120) || 'unknown',
  }
}

function resolveIdentity(
  req: Request,
  body: JsonRecord,
): { muid: string | null; emailSha256: string | null; distinctId: string | null } {
  const url = new URL(req.url)
  const token = str(url.searchParams.get('u'), 4096) || str(obj(body.user).manta_uid_token, 4096)
  const tokenIdentity = token ? deriveMuidFromToken(token) : null
  const cookies = parseCookie(req.headers.get('cookie'))

  const user = obj(body.user)
  const userData = obj(body.user_data)
  const props = obj(body.properties)
  const checkout = obj(props.checkout)
  const explicitEmail =
    normalizeEmail(user.email) ||
    normalizeEmail(userData.email) ||
    normalizeEmail(props.email) ||
    normalizeEmail(checkout.email)
  const emailSha256 =
    tokenIdentity?.emailSha256 || str(user.email_sha256, 128) || (explicitEmail ? sha256(explicitEmail) : null)

  return {
    muid: tokenIdentity?.muid || str(cookies[COOKIE_NAME], 96) || str(user.muid, 96) || newMuid(),
    emailSha256,
    distinctId:
      str(user.distinct_id, 160) || str(userData.id, 160) || str(body.distinct_id, 160) || str(props.distinct_id, 160),
  }
}

function pageTypeFromUrl(url: string | null): string | null {
  if (!url) return null
  try {
    const path = new URL(url).pathname
    if (path === '/' || path === '') return 'home'
    if (path.includes('/collections/')) return 'collection'
    if (path.includes('/products/')) return 'product'
    if (path.includes('/search')) return 'search'
    if (path.includes('/cart')) return 'cart'
    if (path.includes('/checkout')) return 'checkout'
  } catch {
    return null
  }
  return 'other'
}

function queryParamFromUrl(url: string | null, key: string): string | null {
  if (!url) return null
  try {
    return str(new URL(url).searchParams.get(key), 512)
  } catch {
    return null
  }
}

function fbcFromClickId(url: string | null, eventTime: Date): string | null {
  const fbclid = queryParamFromUrl(url, 'fbclid')
  if (!fbclid) return null
  return `fb.1.${Math.floor(eventTime.getTime() / 1000)}.${fbclid}`
}

function hasAdsConsentError(errors: string[]): boolean {
  return errors.some((error) => error.includes('consent_not_granted'))
}

function pickGaClientId(
  eventHubClientId: string | null,
  body: JsonRecord,
  props: JsonRecord,
  context: JsonRecord,
  pageData: JsonRecord,
  user: JsonRecord,
  userData: JsonRecord,
  sourceContext: JsonRecord,
): string | null {
  return (
    eventHubClientId ||
    str(sourceContext.ga_client_id, 128) ||
    str(user.ga_client_id, 128) ||
    str(user.gaClientId, 128) ||
    str(userData.ga_client_id, 128) ||
    str(userData.gaClientId, 128) ||
    str(props.ga_client_id, 128) ||
    str(props.$ga_client_id, 128) ||
    str(context.ga_client_id, 128) ||
    str(pageData.ga_client_id, 128) ||
    str(body.ga_client_id, 128) ||
    null
  )
}

function summarizePayload(
  body: JsonRecord,
  eventName: string,
  identity: ReturnType<typeof resolveIdentity>,
  sourceContext: JsonRecord,
  consent: ConsentState,
): JsonRecord {
  const props = obj(body.properties)
  const context = obj(body.context)
  const pageData = obj(body.page_data)
  const cart = obj(props.cart)
  const checkout = obj(props.checkout)
  const ecommerce = obj(body.ecommerce || props.ecommerce)
  const cartState = obj(body.cart_state)
  const cartItems = arr(cart.items)
  const checkoutItems = arr(checkout.items)
  const ecommerceItems = arr(ecommerce.items)
  const changedItems = arr(props.changed_items)
  const eventItems = normalizeItems(
    ecommerceItems.length
      ? ecommerceItems
      : changedItems.length
        ? changedItems
        : cartItems.length
          ? cartItems
          : checkoutItems,
  )
  const url =
    str(obj(body.context).url) ||
    str(context.url) ||
    str(body.actual_url) ||
    str(pageData.url) ||
    str(body.url) ||
    str(props.url)
  const user = obj(body.user)
  const userData = obj(body.user_data)
  const itemCount =
    num(cart.total_items) ??
    num(cart.item_count) ??
    num(ecommerce.cart_quantity) ??
    (cartItems.length || checkoutItems.length || ecommerceItems.length)

  return {
    event_id: str(body.event_id, 180) || str(obj(body.event_data).id, 180),
    event_name: eventName,
    raw_event_name: str(body.raw_event_name, 128) || str(body.event, 128) || str(body.event_name, 128),
    event_time: pickEventTime(body).toISOString(),
    search_term: str(body.search_term, 300) || str(ecommerce.search_term, 300),
    user: {
      muid: identity.muid,
      distinct_id: identity.distinctId,
      email_sha256: identity.emailSha256,
      ga_client_id: pickGaClientId(identity.muid, body, props, context, pageData, user, userData, sourceContext),
      fbp: str(sourceContext.fbp, 256),
      fbc: str(sourceContext.fbc, 256) || fbcFromClickId(url, pickEventTime(body)),
      gclid:
        str(user.gclid, 512) ||
        str(userData.gclid, 512) ||
        queryParamFromUrl(url, 'gclid') ||
        str(sourceContext.gclid, 512),
      gbraid: str(user.gbraid, 512) || str(userData.gbraid, 512) || queryParamFromUrl(url, 'gbraid'),
      wbraid: str(user.wbraid, 512) || str(userData.wbraid, 512) || queryParamFromUrl(url, 'wbraid'),
      fbclid: str(user.fbclid, 512) || str(userData.fbclid, 512) || queryParamFromUrl(url, 'fbclid'),
      phone_sha256: str(user.phone_sha256, 128) || str(userData.phone_sha256, 128),
      user_agent: str(sourceContext.user_agent, 1024),
      client_ip: str(sourceContext.client_ip, 256),
    },
    consent: {
      analytics_storage: consent.analyticsStorage,
      ad_storage: consent.adStorage,
      ad_user_data: consent.adUserData,
      ad_personalization: consent.adPersonalization,
      source: consent.source,
    },
    context: {
      url,
      referrer: str(context.referrer) || str(pageData.referrer) || str(props.referrer),
      page_type: str(context.page_type, 64) || str(body.ecomm_pagetype, 64) || pageTypeFromUrl(url),
      market: str(context.market, 16) || str(props.market, 16),
      locale: str(context.locale, 16),
    },
    ecommerce: {
      currency: str(ecommerce.currency, 8) || str(cart.currency, 8) || str(checkout.currency, 8),
      value: num(ecommerce.value) ?? num(cart.total_price) ?? num(checkout.total_price),
      item_count: itemCount,
      transaction_id: str(ecommerce.transaction_id, 160) || str(checkout.shopify_order_id, 160),
      coupon: str(ecommerce.coupon, 160) || str(props.discount_code, 160),
      shipping: num(ecommerce.shipping) ?? num(checkout.shipping_price),
      tax: num(ecommerce.tax) ?? num(checkout.total_tax),
      item_list_id: str(ecommerce.item_list_id, 160),
      item_list_name: str(ecommerce.item_list_name, 240),
      items: eventItems,
    },
    cart: {
      token: str(cart.token, 160) || str(cartState.cart_id, 160),
    },
    checkout: {
      token: str(checkout.token, 160),
      shopify_order_id: str(checkout.shopify_order_id, 160) || str(ecommerce.transaction_id, 160),
      is_first_order: typeof checkout.is_first_order === 'boolean' ? checkout.is_first_order : null,
    },
  }
}

async function readJsonBody(req: Request): Promise<JsonRecord | null> {
  const raw = await req.text()
  if (raw.length > MAX_BODY_BYTES) return null
  try {
    return obj(JSON.parse(raw))
  } catch {
    return null
  }
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) })
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin')
  const headers: Record<string, string> = {
    ...corsHeaders(origin),
    'Content-Type': 'application/json',
  }

  if (!headers['Access-Control-Allow-Origin']) {
    return Response.json({ ok: false, error: 'FORBIDDEN' }, { status: 403, headers })
  }

  const body = await readJsonBody(req)
  if (!body) {
    return Response.json({ ok: false, error: 'INVALID_JSON' }, { status: 400, headers })
  }

  const source = pickSource(body)
  if (!isAllowedDirectIngestSource(source)) {
    return Response.json(
      {
        ok: false,
        error: 'DIRECT_EVENT_HUB_INGEST_DISABLED',
        source,
        message: 'Browser events must be sent through the Palas PostHog proxy before Event Hub normalization.',
      },
      { status: 410, headers },
    )
  }

  const app = (req as Request & { app?: RuntimeApp }).app
  const sql = resolveSql(app)
  if (!sql) {
    return Response.json({ ok: false, error: 'DB_UNAVAILABLE' }, { status: 503, headers })
  }

  const eventName = pickEventName(body)
  const pickedEventId = pickEventId(body, eventName)
  const eventId = pickedEventId.value
  const eventTime = pickEventTime(body)
  const consent = readConsent(body)
  const identity = resolveIdentity(req, body)
  const normalized = summarizePayload(body, eventName, identity, ga4ContextFromHeaders(req.headers), consent)
  const context = obj(normalized.context)
  const validation = validateCanonicalEvent({
    eventName,
    eventId,
    eventTime,
    eventIdWasGenerated: pickedEventId.generated,
    payload: normalized,
  })
  normalized.event_id = eventId
  normalized.validation = validation
  const ga4 = mapCanonicalToGa4(eventName, normalized)
  const googleAds = mapCanonicalToGoogleAds(eventName, normalized)
  const metaCapi = mapCanonicalToMetaCapi(eventName, normalized)
  const errors = Array.from(
    new Set([
      ...validationErrorsForSupportedDestinations(validation),
      ...(ga4.ok ? [] : ga4.errors),
      ...(metaCapi.supported && !metaCapi.ok && !hasAdsConsentError(metaCapi.errors) ? metaCapi.errors : []),
    ]),
  )
  const valid = errors.length === 0

  await sql.unsafe(
    `INSERT INTO event_logs (
       id, event_id, event_name, source, received_at, page_type, market,
       identity_muid, identity_email_sha256, distinct_id, valid,
       validation_errors, payload_normalized, created_at, updated_at
     ) VALUES (
       gen_random_uuid(), $1, $2, $3, NOW(), $4, $5,
       $6, $7, $8, $9,
       $10::jsonb, $11::jsonb, NOW(), NOW()
     )
     ON CONFLICT (event_id) DO UPDATE SET
       event_name = EXCLUDED.event_name,
       source = EXCLUDED.source,
       received_at = EXCLUDED.received_at,
       page_type = EXCLUDED.page_type,
       market = EXCLUDED.market,
       identity_muid = EXCLUDED.identity_muid,
       identity_email_sha256 = EXCLUDED.identity_email_sha256,
       distinct_id = EXCLUDED.distinct_id,
       valid = EXCLUDED.valid,
       validation_errors = EXCLUDED.validation_errors,
       payload_normalized = EXCLUDED.payload_normalized,
       updated_at = NOW()`,
    [
      eventId,
      eventName,
      source,
      str(context.page_type, 64),
      str(context.market, 16),
      identity.muid,
      identity.emailSha256,
      identity.distinctId,
      valid,
      JSON.stringify(errors),
      JSON.stringify(normalized),
    ],
  )

  if (isGa4CanonicalEventName(eventName)) {
    await sql.unsafe(
      `INSERT INTO dispatch_logs (
         id, event_destination_key, event_id, canonical_event_name, source_event_name,
         destination, status, event_received_at, first_attempt_at, last_attempt_at,
         next_attempt_at, sent_at, attempt_count, http_status, error_code,
         error_message, request_payload, response_payload, metadata, created_at, updated_at
       ) VALUES (
         gen_random_uuid(), $1, $2, $3, $4,
         'ga4', $5, $6, NULL, NULL,
         $7, NULL, 0, NULL, $8,
         $9, $10::jsonb, NULL, $11::jsonb, NOW(), NOW()
       )
       ON CONFLICT (event_destination_key) DO UPDATE SET
         canonical_event_name = EXCLUDED.canonical_event_name,
         source_event_name = EXCLUDED.source_event_name,
         status = EXCLUDED.status,
         event_received_at = EXCLUDED.event_received_at,
         next_attempt_at = EXCLUDED.next_attempt_at,
         error_code = EXCLUDED.error_code,
         error_message = EXCLUDED.error_message,
         request_payload = EXCLUDED.request_payload,
         metadata = EXCLUDED.metadata,
         updated_at = NOW()`,
      [
        `${eventId}:ga4`,
        eventId,
        eventName,
        str(body.raw_event_name, 128) || str(body.event, 128) || str(body.event_name, 128),
        ga4.ok ? 'pending' : 'invalid',
        eventTime,
        ga4.ok ? new Date() : null,
        ga4.ok ? null : (ga4.errors[0] ?? 'ga4_invalid_payload'),
        ga4.ok ? null : ga4.errors.join(', '),
        JSON.stringify(ga4.payload),
        JSON.stringify({ ...ga4.metadata, ready: ga4.ok, errors: ga4.ok ? [] : ga4.errors }),
      ],
    )
  }

  if (googleAds.supported) {
    await sql.unsafe(
      `INSERT INTO dispatch_logs (
         id, event_destination_key, event_id, canonical_event_name, source_event_name,
         destination, status, event_received_at, first_attempt_at, last_attempt_at,
         next_attempt_at, sent_at, attempt_count, http_status, error_code,
         error_message, request_payload, response_payload, metadata, created_at, updated_at
       ) VALUES (
         gen_random_uuid(), $1, $2, $3, $4,
         'google_ads', $5, $6, NULL, NULL,
         $7, NULL, 0, NULL, $8,
         $9, $10::jsonb, NULL, $11::jsonb, NOW(), NOW()
       )
       ON CONFLICT (event_destination_key) DO UPDATE SET
         canonical_event_name = EXCLUDED.canonical_event_name,
         source_event_name = EXCLUDED.source_event_name,
         status = EXCLUDED.status,
         event_received_at = EXCLUDED.event_received_at,
         next_attempt_at = EXCLUDED.next_attempt_at,
         error_code = EXCLUDED.error_code,
         error_message = EXCLUDED.error_message,
         request_payload = EXCLUDED.request_payload,
         metadata = EXCLUDED.metadata,
         updated_at = NOW()`,
      [
        `${eventId}:google_ads`,
        eventId,
        eventName,
        str(body.raw_event_name, 128) || str(body.event, 128) || str(body.event_name, 128),
        googleAds.ok ? 'pending' : 'invalid',
        eventTime,
        googleAds.ok ? new Date() : null,
        googleAds.ok ? null : (googleAds.errors[0] ?? 'google_ads_invalid_payload'),
        googleAds.ok ? null : googleAds.errors.join(', '),
        JSON.stringify(googleAds.payload),
        JSON.stringify({ ...googleAds.metadata, ready: googleAds.ok, errors: googleAds.ok ? [] : googleAds.errors }),
      ],
    )
  }

  if (metaCapi.supported) {
    await sql.unsafe(
      `INSERT INTO dispatch_logs (
         id, event_destination_key, event_id, canonical_event_name, source_event_name,
         destination, status, event_received_at, first_attempt_at, last_attempt_at,
         next_attempt_at, sent_at, attempt_count, http_status, error_code,
         error_message, request_payload, response_payload, metadata, created_at, updated_at
       ) VALUES (
         gen_random_uuid(), $1, $2, $3, $4,
         'meta_capi', $5, $6, NULL, NULL,
         $7, NULL, 0, NULL, $8,
         $9, $10::jsonb, NULL, $11::jsonb, NOW(), NOW()
       )
       ON CONFLICT (event_destination_key) DO UPDATE SET
         canonical_event_name = EXCLUDED.canonical_event_name,
         source_event_name = EXCLUDED.source_event_name,
         status = EXCLUDED.status,
         event_received_at = EXCLUDED.event_received_at,
         next_attempt_at = EXCLUDED.next_attempt_at,
         error_code = EXCLUDED.error_code,
         error_message = EXCLUDED.error_message,
         request_payload = EXCLUDED.request_payload,
         metadata = EXCLUDED.metadata,
         updated_at = NOW()`,
      [
        `${eventId}:meta_capi`,
        eventId,
        eventName,
        str(body.raw_event_name, 128) || str(body.event, 128) || str(body.event_name, 128),
        metaCapi.ok ? 'pending' : 'invalid',
        eventTime,
        metaCapi.ok ? new Date() : null,
        metaCapi.ok ? null : (metaCapi.errors[0] ?? 'meta_capi_invalid_payload'),
        metaCapi.ok ? null : metaCapi.errors.join(', '),
        JSON.stringify(metaCapi.payload),
        JSON.stringify({ ...metaCapi.metadata, ready: metaCapi.ok, errors: metaCapi.ok ? [] : metaCapi.errors }),
      ],
    )
  }

  const liveDispatch: Record<string, unknown> = {}
  if (ga4.ok && isGa4CanonicalEventName(eventName)) {
    liveDispatch.ga4 = await flushDispatchLogByEventDestinationKey({
      db: dispatchDb(sql),
      connector: ga4DestinationConnector,
      eventDestinationKey: `${eventId}:ga4`,
    })
  }

  if (identity.muid) {
    headers['Set-Cookie'] = cookieHeader(req, identity.muid)
  }
  return Response.json(
    {
      ok: true,
      event_id: eventId,
      event_name: eventName,
      received_at: eventTime.toISOString(),
      live_dispatch: liveDispatch,
    },
    { headers },
  )
}
