// Cart drawer email capture endpoint — public, called from the Shopify
// theme's "Une surprise t'attend sur ce panier" mini-form.
//
// Shape: POST /api/cart-email-capture/e
// Body:  { email, cartToken?, market?, phDistinctId? }
// Header: X-Palas-Test: '1'   (test mode — skips Klaviyo/PostHog fan-out)
//
// Architecture: the HTTP response MUST carry the correct discountCode
// within the Vercel serverless function's SLA (~2s felt). The business
// decision (grant SURPRISE10 yes/no) depends on a Shopify customer
// lookup — we do that lookup RIGHT HERE in the route, synchronously,
// and build the response from it. The `submitCartEmail` command handles
// DB persistence + Klaviyo/PostHog fan-out and can freely exceed the
// framework's 300ms inline-response window (wire-commands.ts) without
// affecting the theme's UX.

import { lookupShopifyCustomer } from '../../../../utils/shopify-customer'

const DISCOUNT_CODE = 'SURPRISE10'

interface SubmitBody {
  email?: unknown
  cartToken?: unknown
  market?: unknown
  phDistinctId?: unknown
}

type SubmitCommand = (
  input: {
    email: string
    cart_token: string | null
    market: string | null
    posthog_distinct_id: string | null
    is_test: boolean
    user_agent: string | null
    remote_ip: string | null
    shopify_number_of_orders: number
    shopify_customer_id: string | null
  },
  opts?: Record<string, unknown>,
) => Promise<unknown>

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
  if (!email) {
    return Response.json({ ok: false, error: 'INVALID_EMAIL' }, { status: 400, headers })
  }

  const mantaReq = req as Request & { app?: { commands?: Record<string, SubmitCommand | undefined> } }
  const cmd = mantaReq.app?.commands?.submitCartEmail
  if (!cmd) {
    return Response.json({ ok: false, error: 'COMMAND_UNAVAILABLE' }, { status: 500, headers })
  }

  // Shopify lookup → decision. ~200-500ms on cache miss; the Klaviyo +
  // PostHog fan-out (happening inside the command) is what easily takes
  // 1-2s, and that's why we keep the lookup on THIS side of the 300ms
  // framework race. Fail-open: any Shopify API failure → treat as new
  // visitor (discount granted) with a log warn.
  const log = { warn: (m: string) => console.warn(m) }
  const shop = await lookupShopifyCustomer(email, log)
  const isExistingCustomer = shop.number_of_orders > 0
  const discountCode = isExistingCustomer ? null : DISCOUNT_CODE

  const cmdInput = {
    email,
    cart_token: sanitize(body.cartToken, 64),
    market: sanitize(body.market, 8),
    posthog_distinct_id: sanitize(body.phDistinctId, 128),
    is_test: req.headers.get('x-palas-test') === '1',
    user_agent: sanitize(req.headers.get('user-agent'), 512),
    remote_ip: sanitize(req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null, 64),
    shopify_number_of_orders: shop.number_of_orders,
    shopify_customer_id: shop.customer_id,
  }

  // Fire the command. We await it so the framework keeps the serverless
  // function alive for fan-out work, but we IGNORE its return value —
  // the HTTP response is already decided from the route's Shopify lookup.
  // If the command goes past 300ms the framework returns a `{runId,
  // status:'running'}` envelope and the work continues in background.
  // Either way the response below is correct.
  try {
    await cmd(cmdInput)
  } catch (err) {
    // Persistence / fan-out failed. The user's submission is lost, but
    // the Shopify decision is still valid — we've already determined
    // whether to grant the discount. Log and continue.
    const message = (err as Error).message.slice(0, 200)
    console.error('[cart-email-capture] submitCartEmail failed:', message)
  }

  return Response.json(
    {
      ok: true,
      discountCode,
      isExistingCustomer,
      numberOfOrders: shop.number_of_orders,
    },
    { headers },
  )
}
