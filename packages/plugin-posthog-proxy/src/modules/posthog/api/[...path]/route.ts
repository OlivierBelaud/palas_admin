// PostHog Proxy — catch-all raw route (escape hatch, NOT CQRS)
// Forwards all requests from the PostHog JS SDK (/capture/, /decide/, /e/, /s/, etc.)
// + optional Klaviyo identity bridge.
//
// The PostHog client SDK hits: https://your-app.com/api/posthog/capture/, /api/posthog/decide/, ...
// This catch-all matches everything under /api/posthog/** and forwards to PostHog's real host.

import { gunzipSync } from 'node:zlib'

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
  const path = extractPath(req)
  const targetUrl = `${config.host}${path}`

  // Read body as raw bytes to preserve gzip encoding for forwarding
  const rawBytes = new Uint8Array(await req.arrayBuffer())
  console.log(`[posthog-proxy] POST ${path} → ${targetUrl} (body: ${rawBytes.length} bytes)`)

  const headers: Record<string, string> = {}
  const ct = req.headers.get('content-type')
  if (ct) headers['content-type'] = ct
  const ua = req.headers.get('user-agent')
  if (ua) headers['user-agent'] = ua

  // Forward raw bytes to PostHog (gzip stays gzip)
  const resp = await fetch(targetUrl, { method: 'POST', headers, body: rawBytes })
  const responseBody = await resp.text()

  // Klaviyo identity bridge (fire-and-forget)
  if (rawBytes.length > 0 && config.klaviyoApiKey) {
    try {
      // Try to get JSON: decompress gzip if needed, then parse
      const jsonText = tryDecompress(rawBytes)
      if (jsonText) {
        const parsed = JSON.parse(jsonText)
        processEvents(parsed, config).catch((err) => {
          console.error('[posthog-proxy] Klaviyo bridge error:', err)
        })
      }
    } catch (err) {
      console.log('[posthog-proxy] Body not parseable (session recording, etc.):', (err as Error).message)
    }
  } else if (!config.klaviyoApiKey) {
    console.warn('[posthog-proxy] KLAVIYO_API_KEY not set — identity bridge disabled')
  }

  return new Response(responseBody, {
    status: resp.status,
    headers: { ...CORS_HEADERS, 'Content-Type': resp.headers.get('Content-Type') ?? 'application/json' },
  })
}

/** Try to decompress gzip, fall back to raw text */
function tryDecompress(bytes: Uint8Array): string | null {
  // Check gzip magic bytes (1f 8b)
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      return gunzipSync(Buffer.from(bytes)).toString('utf-8')
    } catch {
      return null
    }
  }
  // Not gzip — try as plain text
  try {
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
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
  console.log(`[posthog-proxy] Processing ${(events as unknown[]).length} event(s) for Klaviyo bridge`)

  for (const event of events as Record<string, unknown>[]) {
    console.log(`[posthog-proxy] RAW EVENT: ${JSON.stringify(event)}`)

    const props = event.properties as Record<string, unknown> | undefined
    const distinctId = (event.distinct_id ?? props?.distinct_id) as string | undefined
    const kx = props?.$_kx as string | undefined

    console.log(`[posthog-proxy] Event: ${event.event}, distinct_id: ${distinctId}, $_kx: ${kx ? kx.slice(0, 30) + '...' : 'null'}`)

    if (!kx || !distinctId) continue
    if (identifiedIds.has(distinctId)) {
      console.log(`[posthog-proxy] Already identified: ${distinctId}`)
      continue
    }

    const email = await resolveKlaviyoEmail(kx, config)
    console.log(`[posthog-proxy] Klaviyo resolved: ${email ?? 'null'} for distinct_id: ${distinctId}`)
    if (email) {
      await identifyInPostHog(distinctId, email, config)
      identifiedIds.add(distinctId)
      console.log(`[posthog-proxy] ✓ Identified ${distinctId} as ${email} in PostHog`)
    }
  }
}

async function resolveKlaviyoEmail(kxCookie: string, config: PostHogProxyConfig): Promise<string | null> {
  if (identityCache.has(kxCookie)) return identityCache.get(kxCookie)!
  if (!config.klaviyoApiKey) return null

  try {
    const decoded = JSON.parse(Buffer.from(kxCookie, 'base64').toString())
    console.log('[posthog-proxy] $_kx decoded:', JSON.stringify(decoded))
    const exchangeValue = (decoded.$exchange_id ?? decoded.cid) as string | undefined
    if (!exchangeValue) {
      console.warn('[posthog-proxy] No $exchange_id or cid in $_kx cookie')
      return null
    }
    console.log(`[posthog-proxy] Querying Klaviyo for external_id: ${exchangeValue}`)

    const res = await fetch(`https://a.klaviyo.com/api/profiles/?filter=equals(external_id,"${exchangeValue}")`, {
      headers: {
        Authorization: `Klaviyo-API-Key ${config.klaviyoApiKey}`,
        accept: 'application/json',
        revision: '2024-10-15',
      },
    })

    if (!res.ok) {
      const errBody = await res.text()
      console.error(`[posthog-proxy] Klaviyo API error ${res.status}: ${errBody}`)
      return null
    }

    const data = (await res.json()) as { data?: Array<{ attributes?: { email?: string } }> }
    console.log(`[posthog-proxy] Klaviyo response: ${data.data?.length ?? 0} profile(s) found`)
    const email = data.data?.[0]?.attributes?.email
    if (email) identityCache.set(kxCookie, email)
    return email ?? null
  } catch (err) {
    console.error('[posthog-proxy] resolveKlaviyoEmail error:', err)
    return null
  }
}

async function identifyInPostHog(distinctId: string, email: string, config: PostHogProxyConfig) {
  if (!config.publicToken) {
    console.warn('[posthog-proxy] POSTHOG_TOKEN not set — cannot send $identify')
    return
  }
  try {
    const identifyBody = {
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
    }
    console.log(`[posthog-proxy] Sending $identify to PostHog: ${email} (anon: ${distinctId})`)
    const res = await fetch(`${config.host}/i/v0/e/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(identifyBody),
    })
    console.log(`[posthog-proxy] PostHog $identify response: ${res.status}`)
  } catch (err) {
    console.error('[posthog-proxy] identifyInPostHog error:', err)
  }
}
