// Cart drawer email capture endpoint — called from the Shopify theme's
// "Une surprise t'attend sur ce panier" mini-form.
//
// Shape: POST /api/cart-email-capture/e
// Body:  { email, cartToken?, market?, phDistinctId? }
// Header: X-Palas-Test: '1'   (test mode — skips external side effects)
//
// Flow:
//   1. Insert row in email_captures (source of truth, drives the admin list).
//   2. In parallel (unless test): subscribe to Newsletter list in Klaviyo +
//      fire `cart:email_form_submitted` event to PostHog + Klaviyo.
//   3. Update sync timestamps on the row.
//   4. Return { ok: true, discountCode: 'SURPRISE10' } so the theme can
//      auto-apply it via /discount/SURPRISE10.
//
// Never throws — validation failures return 400, other errors 500 with a
// minimal body the theme can display as a toast.

import { sendKlaviyoEvent, subscribeKlaviyoProfile } from '../../../../utils/klaviyo'
import { sendPosthogEvent } from '../../../../utils/posthog-ingest'

interface SubmitBody {
  email?: unknown
  cartToken?: unknown
  market?: unknown
  phDistinctId?: unknown
}

interface CaptureRow {
  id: string
}

const DISCOUNT_CODE = 'SURPRISE10'
const KLAVIYO_LIST_ID = 'SUtgMh' // Newsletter
const SOURCE = 'cart_drawer_surprise'
const EVENT_NAME = 'cart:email_form_submitted'

// ── CORS (same policy as /api/cart-tracking/c) ──────────────────────

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
  const allowed = (process.env.ALLOWED_CORS_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Palas-Test',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    'Cache-Control': 'private, no-store',
  }
  if (origin && isOriginAllowed(origin, allowed)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}

// ── Validation ──────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function sanitize(v: unknown, max = 255): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (!trimmed || trimmed.length > max) return null
  return trimmed
}

// ── Handlers ────────────────────────────────────────────────────────

export async function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(req.headers.get('origin')),
  })
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin')
  const headers: Record<string, string> = {
    ...corsHeaders(origin),
    'Content-Type': 'application/json',
  }

  // Block requests from non-allowed origins early.
  if (!headers['Access-Control-Allow-Origin']) {
    return Response.json({ ok: false, error: 'FORBIDDEN' }, { status: 403, headers })
  }

  let body: SubmitBody
  try {
    body = (await req.json()) as SubmitBody
  } catch {
    return Response.json({ ok: false, error: 'INVALID_JSON' }, { status: 400, headers })
  }

  const email = sanitize(body.email)?.toLowerCase() ?? null
  if (!email || !EMAIL_RE.test(email)) {
    return Response.json({ ok: false, error: 'INVALID_EMAIL' }, { status: 400, headers })
  }

  const cartToken = sanitize(body.cartToken, 64)
  const market = sanitize(body.market, 8)
  const phDistinctId = sanitize(body.phDistinctId, 128)
  const isTest = req.headers.get('x-palas-test') === '1'
  const userAgent = sanitize(req.headers.get('user-agent'), 512)
  const remoteIp = sanitize(req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null, 64)

  // ── 1. Insert DB row ──────────────────────────────────────────────
  type RawDb = { raw: <T>(sql: string, params?: unknown[]) => Promise<T[]> }
  const mantaReq = req as Request & { app?: { infra?: { db?: RawDb } } }
  const db = mantaReq.app?.infra?.db

  let rowId: string | null = null
  if (db) {
    try {
      const rows = await db.raw<CaptureRow>(
        `INSERT INTO email_captures
          (email, cart_token, source, market, posthog_distinct_id, is_test, user_agent, remote_ip)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [email, cartToken, SOURCE, market, phDistinctId, isTest, userAgent, remoteIp],
      )
      rowId = rows[0]?.id ?? null
    } catch (err) {
      console.warn('[email-capture] DB insert failed:', (err as Error).message)
    }
  }

  // ── 2. Side effects (skipped in test mode) ────────────────────────
  if (!isTest) {
    const [subRes, klEventRes, phRes] = await Promise.allSettled([
      subscribeKlaviyoProfile({ email, listId: KLAVIYO_LIST_ID, customSource: SOURCE }),
      sendKlaviyoEvent({
        email,
        metric: EVENT_NAME,
        properties: { source: SOURCE, market, cart_token: cartToken, discount_code: DISCOUNT_CODE },
        unique_id: rowId ?? `${email}-${Date.now()}`,
      }),
      sendPosthogEvent({
        event: EVENT_NAME,
        distinctId: phDistinctId ?? email,
        email,
        ip: remoteIp,
        properties: { source: SOURCE, market, cart_token: cartToken, discount_code: DISCOUNT_CODE },
      }),
    ])

    const klOk = subRes.status === 'fulfilled' && subRes.value.ok
    const klEvOk = klEventRes.status === 'fulfilled' && klEventRes.value.ok
    const phOk = phRes.status === 'fulfilled' && phRes.value.ok

    // Update sync timestamps. Fire-and-forget — we don't block the response.
    if (db && rowId) {
      const now = new Date().toISOString()
      db.raw(
        `UPDATE email_captures
           SET klaviyo_synced_at = COALESCE(klaviyo_synced_at, CASE WHEN $1 THEN $3::timestamp ELSE NULL END),
               posthog_synced_at = COALESCE(posthog_synced_at, CASE WHEN $2 THEN $3::timestamp ELSE NULL END)
         WHERE id = $4`,
        [klOk || klEvOk, phOk, now, rowId],
      ).catch(() => {
        /* non-critical */
      })
    }
  }

  return Response.json({ ok: true, discountCode: DISCOUNT_CODE }, { headers })
}
