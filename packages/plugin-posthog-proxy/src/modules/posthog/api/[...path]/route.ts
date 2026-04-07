// PostHog Proxy — catch-all raw route (escape hatch, NOT CQRS)
// Forwards all requests from the PostHog JS SDK (/capture/, /decide/, /e/, /s/, etc.)
// + optional Klaviyo identity bridge.
//
// Identity bridge: extracts $_kx (newsletter click) or $kla_id (__kla_id cookie)
// from event properties, resolves the email via Klaviyo API, and sends $identify to PostHog.

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
  const clientIp = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip')
  if (clientIp) headers['x-forwarded-for'] = clientIp

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
  const ct = req.headers.get('content-type')

  const headers: Record<string, string> = {}
  if (ct) headers['content-type'] = ct
  const ua = req.headers.get('user-agent')
  if (ua) headers['user-agent'] = ua
  // Forward client IP so PostHog GeoIP resolves the real user location, not the proxy's
  const clientIp = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip')
  if (clientIp) headers['x-forwarded-for'] = clientIp

  // Forward raw bytes to PostHog (gzip stays gzip)
  const resp = await fetch(targetUrl, { method: 'POST', headers, body: rawBytes })
  const responseBody = await resp.text()

  // Klaviyo identity bridge (fire-and-forget)
  if (rawBytes.length > 0 && config.klaviyoApiKey) {
    try {
      const jsonText = tryDecompress(rawBytes)
      if (jsonText) {
        const parsed = JSON.parse(jsonText)
        processEvents(parsed, config).catch((err) => {
          console.error('[posthog-proxy] Klaviyo bridge error:', err)
        })
      }
    } catch {
      // Not parseable (session recording binary, etc.) — skip
    }
  }

  return new Response(responseBody, {
    status: resp.status,
    headers: { ...CORS_HEADERS, 'Content-Type': resp.headers.get('Content-Type') ?? 'application/json' },
  })
}

/** Try to decompress gzip, fall back to raw text */
function tryDecompress(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      return gunzipSync(Buffer.from(bytes)).toString('utf-8')
    } catch {
      return null
    }
  }
  try {
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function extractPath(req: Request): string {
  const url = new URL(req.url)
  return url.pathname.replace(/^\/api\/posthog/, '') || '/'
}

// ── Klaviyo identity bridge ─────────────────────────────────────────

async function processEvents(body: unknown, config: PostHogProxyConfig) {
  const events = Array.isArray(body) ? body : ((body as Record<string, unknown>).batch ?? [body])

  for (const event of events as Record<string, unknown>[]) {
    // Skip session recording snapshots (no user properties)
    if (event.event === '$snapshot') continue

    const props = event.properties as Record<string, unknown> | undefined
    const distinctId = (event.distinct_id ?? props?.distinct_id) as string | undefined
    if (!distinctId) continue
    if (identifiedIds.has(distinctId)) continue

    // Try to extract a Klaviyo exchange token from two sources:
    // 1. $_kx — set by PostHog SDK when visitor clicked a Klaviyo email link
    // 2. $kla_id — __kla_id cookie registered via posthog.register() on the frontend
    const exchangeId = extractExchangeId(props?.$_kx as string | null, props?.$kla_id as string | null)
    if (!exchangeId) continue

    console.log(`[posthog-proxy] Resolving Klaviyo identity for distinct_id: ${distinctId}, exchangeId: ${exchangeId.slice(0, 30)}...`)
    try {
      const email = await resolveKlaviyoEmail(exchangeId, config)
      console.log(`[posthog-proxy] Klaviyo result: ${email ?? 'null'}`)
      if (email) {
        await identifyInPostHog(distinctId, email, config)
        identifiedIds.add(distinctId)
        console.log(`[posthog-proxy] ✓ Identified ${distinctId} as ${email}`)
      }
    } catch (err) {
      console.log(`[posthog-proxy] ERROR resolving: ${(err as Error).message}`)
    }
  }
}

/**
 * Extract the $exchange_id from either $_kx or $kla_id.
 * Both are base64-encoded JSON: {"cid":"...", "$exchange_id":"..."}
 * If $exchange_id is present, the user is identified in Klaviyo.
 * If only cid exists, the user is anonymous — skip.
 */
function extractExchangeId(kx: string | null | undefined, klaId: string | null | undefined): string | null {
  for (const token of [kx, klaId]) {
    if (!token) continue
    try {
      const decoded = JSON.parse(Buffer.from(token, 'base64').toString())
      if (decoded.$exchange_id) return decoded.$exchange_id as string
    } catch {
      // Not valid base64/JSON — skip
    }
  }
  return null
}

/**
 * Resolve a Klaviyo $exchange_id to an email using the profile-import endpoint.
 * This is the correct API for exchange tokens (not GET /profiles/?filter=...).
 */
async function resolveKlaviyoEmail(exchangeId: string, config: PostHogProxyConfig): Promise<string | null> {
  if (identityCache.has(exchangeId)) return identityCache.get(exchangeId)!
  if (!config.klaviyoApiKey) return null

  try {
    const res = await fetch('https://a.klaviyo.com/api/profile-import/', {
      method: 'POST',
      headers: {
        Authorization: `Klaviyo-API-Key ${config.klaviyoApiKey}`,
        'Content-Type': 'application/json',
        accept: 'application/json',
        revision: '2024-10-15',
      },
      body: JSON.stringify({
        data: {
          type: 'profile',
          attributes: { _kx: exchangeId },
        },
      }),
    })

    if (!res.ok) {
      console.error(`[posthog-proxy] Klaviyo API error ${res.status}: ${await res.text()}`)
      return null
    }

    const data = (await res.json()) as { data?: { attributes?: { email?: string } } }
    const email = data.data?.attributes?.email
    if (email) {
      identityCache.set(exchangeId, email)
      console.log(`[posthog-proxy] Klaviyo resolved: ${email}`)
    }
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
    const res = await fetch(`${config.host}/i/v0/e/`, {
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
    console.log(`[posthog-proxy] PostHog $identify response: ${res.status}`)
  } catch (err) {
    console.error('[posthog-proxy] identifyInPostHog error:', err)
  }
}
