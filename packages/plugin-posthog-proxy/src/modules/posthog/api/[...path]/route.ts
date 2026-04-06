// PostHog Proxy — catch-all raw route (escape hatch, NOT CQRS)
// Forwards all requests from the PostHog JS SDK (/capture/, /decide/, /e/, /s/, etc.)
// + optional Klaviyo identity bridge.
//
// The PostHog client SDK hits: https://your-app.com/api/posthog/capture/, /api/posthog/decide/, ...
// This catch-all matches everything under /api/posthog/** and forwards to PostHog's real host.

interface PostHogProxyConfig {
  host: string
  publicToken?: string
  klaviyoApiKey?: string
}

// ── In-memory caches ────────────────────────────────────────────────
const identityCache = new Map<string, string>()
const identifiedIds = new Set<string>()

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function getConfig(): PostHogProxyConfig {
  return {
    host: process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com',
    publicToken: process.env.POSTHOG_TOKEN,
    klaviyoApiKey: process.env.KLAVIYO_API_KEY,
  }
}

// ── Route handlers ──────────────────────────────────────────────────

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(req: Request) {
  const config = getConfig()
  const targetUrl = `${config.host}${extractPath(req)}`

  const headers: Record<string, string> = {}
  const ua = req.headers.get('user-agent')
  if (ua) headers['user-agent'] = ua

  const resp = await fetch(targetUrl, { headers })
  return new Response(await resp.text(), {
    status: resp.status,
    headers: { ...CORS_HEADERS, 'Content-Type': resp.headers.get('Content-Type') ?? 'application/json' },
  })
}

export async function POST(req: Request) {
  const config = getConfig()
  const targetUrl = `${config.host}${extractPath(req)}`

  const rawBody = await req.text()

  const headers: Record<string, string> = {}
  const ct = req.headers.get('content-type')
  if (ct) headers['content-type'] = ct
  const ua = req.headers.get('user-agent')
  if (ua) headers['user-agent'] = ua

  const resp = await fetch(targetUrl, { method: 'POST', headers, body: rawBody })
  const responseBody = await resp.text()

  // Klaviyo identity bridge (fire-and-forget)
  if (rawBody && config.klaviyoApiKey) {
    try {
      const parsed = JSON.parse(rawBody)
      processEvents(parsed, config).catch(() => {
        /* best effort */
      })
    } catch {
      // Not JSON (session recording, etc.) — ignore
    }
  }

  return new Response(responseBody, {
    status: resp.status,
    headers: { ...CORS_HEADERS, 'Content-Type': resp.headers.get('Content-Type') ?? 'application/json' },
  })
}

// ── Helpers ─────────────────────────────────────────────────────────

function extractPath(req: Request): string {
  const url = new URL(req.url)
  // The route is mounted at /api/posthog/**, so strip that prefix
  return url.pathname.replace(/^\/api\/posthog/, '') || '/'
}

// ── Klaviyo identity bridge ─────────────────────────────────────────

async function processEvents(body: unknown, config: PostHogProxyConfig) {
  const events = Array.isArray(body) ? body : ((body as Record<string, unknown>).batch ?? [body])

  for (const event of events as Record<string, unknown>[]) {
    const distinctId = (event.distinct_id ?? (event.properties as Record<string, unknown>)?.distinct_id) as
      | string
      | undefined
    const kx = (event.properties as Record<string, unknown>)?.$_kx as string | undefined

    if (!kx || !distinctId) continue
    if (identifiedIds.has(distinctId)) continue

    const email = await resolveKlaviyoEmail(kx, config)
    if (email) {
      await identifyInPostHog(distinctId, email, config)
      identifiedIds.add(distinctId)
    }
  }
}

async function resolveKlaviyoEmail(kxCookie: string, config: PostHogProxyConfig): Promise<string | null> {
  if (identityCache.has(kxCookie)) return identityCache.get(kxCookie)!
  if (!config.klaviyoApiKey) return null

  try {
    const decoded = JSON.parse(Buffer.from(kxCookie, 'base64').toString())
    const exchangeValue = (decoded.$exchange_id ?? decoded.cid) as string | undefined
    if (!exchangeValue) return null

    const res = await fetch(`https://a.klaviyo.com/api/profiles/?filter=equals(external_id,"${exchangeValue}")`, {
      headers: {
        Authorization: `Klaviyo-API-Key ${config.klaviyoApiKey}`,
        accept: 'application/json',
        revision: '2024-10-15',
      },
    })

    if (!res.ok) return null

    const data = (await res.json()) as { data?: Array<{ attributes?: { email?: string } }> }
    const email = data.data?.[0]?.attributes?.email
    if (email) identityCache.set(kxCookie, email)
    return email ?? null
  } catch {
    return null
  }
}

async function identifyInPostHog(distinctId: string, email: string, config: PostHogProxyConfig) {
  if (!config.publicToken) return
  try {
    await fetch(`${config.host}/i/v0/e/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: config.publicToken,
        distinct_id: email,
        event: '$identify',
        properties: {
          $anon_distinct_id: distinctId,
          $set: {
            email,
            klaviyo_identified: true,
            identified_at: new Date().toISOString(),
          },
        },
      }),
    })
  } catch {
    // Best effort
  }
}
