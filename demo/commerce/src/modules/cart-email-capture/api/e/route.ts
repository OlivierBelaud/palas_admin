// Cart drawer email capture endpoint — public, called from the Shopify
// theme's "Une surprise t'attend sur ce panier" mini-form.
//
// Shape: POST /api/cart-email-capture/e
// Body:  { email, cartToken?, market?, phDistinctId? }
// Header: X-Palas-Test: '1'   (test mode — skips Klaviyo/PostHog fan-out)
//
// This route is a thin adapter: it validates the HTTP shape + CORS and
// delegates all business logic (DB persistence + Klaviyo/PostHog dispatch)
// to the `submitCartEmail` command. Keeping writes behind the service layer
// means the adapter wiring stays the framework's job.

interface SubmitBody {
  email?: unknown
  cartToken?: unknown
  market?: unknown
  phDistinctId?: unknown
}

interface SubmitCartEmailResult {
  id: string
  discount_code: string
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
  },
  opts?: Record<string, unknown>,
) => Promise<SubmitCartEmailResult>

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

  try {
    const result = await cmd({
      email,
      cart_token: sanitize(body.cartToken, 64),
      market: sanitize(body.market, 8),
      posthog_distinct_id: sanitize(body.phDistinctId, 128),
      is_test: req.headers.get('x-palas-test') === '1',
      user_agent: sanitize(req.headers.get('user-agent'), 512),
      remote_ip: sanitize(req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null, 64),
    })
    return Response.json({ ok: true, discountCode: result.discount_code }, { headers })
  } catch (err) {
    const name = (err as { name?: string }).name
    if (name === 'ZodError') {
      return Response.json({ ok: false, error: 'INVALID_EMAIL' }, { status: 400, headers })
    }
    const message = (err as Error).message.slice(0, 200)
    console.error('[cart-email-capture] submitCartEmail failed:', message)
    return Response.json({ ok: false, error: 'INTERNAL' }, { status: 500, headers })
  }
}
