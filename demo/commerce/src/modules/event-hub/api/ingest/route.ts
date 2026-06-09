import { createHash, randomUUID } from 'node:crypto'
import { type RuntimeApp, resolveSql } from '../../../../utils/manta-runtime'
import { verifyContactToken } from '../../../../utils/manta-uid'

const COOKIE_NAME = 'muid'
const COOKIE_MAX_AGE = 390 * 24 * 60 * 60
const MAX_BODY_BYTES = 64 * 1024

const EVENT_NAME_MAP: Record<string, string> = {
  $pageview: 'page_view',
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

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function pickEventName(body: JsonRecord): string {
  const raw = str(body.event_name, 128) || str(body.event, 128) || str(body.raw_event_name, 128) || 'unknown'
  return EVENT_NAME_MAP[raw] || raw
}

function pickEventId(body: JsonRecord, eventName: string): string {
  const eventData = obj(body.event_data)
  return (
    str(body.event_id, 160) ||
    str(eventData.id, 160) ||
    `palas_${eventName}_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`
  )
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
    return {
      muid: `muid_${sha256(token).slice(0, 32)}`,
      emailSha256: sha256(verified.email.trim().toLowerCase()),
    }
  } catch {
    return null
  }
}

function newMuid(): string {
  return `muid_${randomUUID().replace(/-/g, '')}`
}

function resolveIdentity(
  req: Request,
  body: JsonRecord,
): { muid: string; emailSha256: string | null; distinctId: string | null } {
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

  return {
    muid: tokenIdentity?.muid || str(cookies[COOKIE_NAME], 96) || str(user.muid, 96) || newMuid(),
    emailSha256:
      tokenIdentity?.emailSha256 || str(user.email_sha256, 128) || (explicitEmail ? sha256(explicitEmail) : null),
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

function summarizePayload(body: JsonRecord, eventName: string, identity: ReturnType<typeof resolveIdentity>) {
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
  const url =
    str(obj(body.context).url) ||
    str(context.url) ||
    str(body.actual_url) ||
    str(pageData.url) ||
    str(body.url) ||
    str(props.url)
  const itemCount =
    num(cart.total_items) ??
    num(cart.item_count) ??
    num(ecommerce.cart_quantity) ??
    (cartItems.length || checkoutItems.length || ecommerceItems.length)

  return {
    event_name: eventName,
    raw_event_name: str(body.raw_event_name, 128) || str(body.event, 128) || str(body.event_name, 128),
    event_time: pickEventTime(body).toISOString(),
    user: {
      muid: identity.muid,
      distinct_id: identity.distinctId,
      email_sha256: identity.emailSha256,
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

function validate(eventName: string, eventId: string): string[] {
  const errors: string[] = []
  if (!eventId) errors.push('event_id_missing')
  if (!eventName || eventName === 'unknown') errors.push('event_name_missing')
  return errors
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

  const app = (req as Request & { app?: RuntimeApp }).app
  const sql = resolveSql(app)
  if (!sql) {
    return Response.json({ ok: false, error: 'DB_UNAVAILABLE' }, { status: 503, headers })
  }

  const eventName = pickEventName(body)
  const eventId = pickEventId(body, eventName)
  const eventTime = pickEventTime(body)
  const identity = resolveIdentity(req, body)
  const normalized = summarizePayload(body, eventName, identity)
  const context = obj(normalized.context)
  const errors = validate(eventName, eventId)
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
      str(body.source, 80) || str(obj(body.event_data).source, 80) || 'unknown',
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

  headers['Set-Cookie'] = cookieHeader(req, identity.muid)
  return Response.json(
    { ok: true, event_id: eventId, event_name: eventName, received_at: eventTime.toISOString() },
    { headers },
  )
}
