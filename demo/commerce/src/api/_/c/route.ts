// Visitor identification endpoint — called from the Shopify theme.
//
// Shape: GET /api/_/c?k=<klaviyo_exchange_id>
// Returns a short codified JSON payload { t, n?, o?, v } that the theme
// stores in sessionStorage. See src/utils/visitor-codes.ts for the mapping.
//
// Never throws — every failure path falls back to { t: 'a', v } so the theme
// UX degrades gracefully.

import { UpstashCacheAdapter } from '@manta/adapter-cache-upstash'
import { resolveKlaviyoProfile } from '../../../utils/klaviyo-resolve'
import { codifyDate, codifyTier, nowEpochSec, type Tier } from '../../../utils/visitor-codes'

interface VisitorPayload {
  t: Tier
  n?: number
  o?: number
  v: number
}

interface OrderStats {
  count: number
  lastAt: string | null
}

const CACHE_TTL_OK = 600
const CACHE_TTL_TRANSIENT = 60

/**
 * Origin allow-list with subdomain wildcard support.
 * Each entry is either an exact origin (`https://fancypalas.com`) or a subdomain
 * wildcard (`https://*.fancypalas.com`). A wildcard matches both the apex host
 * and any single subdomain: `https://fancypalas.com`, `https://uk.fancypalas.com`,
 * `https://www.fancypalas.com`. It does NOT match `https://evilfancypalas.com`.
 */
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
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    'Cache-Control': 'private, no-store',
  }
  if (origin && isOriginAllowed(origin, allowed)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}

let cacheSingleton: UpstashCacheAdapter | null | undefined

function getCache(): UpstashCacheAdapter | null {
  if (cacheSingleton !== undefined) return cacheSingleton
  // Accept both naming conventions:
  //   - adapter-native: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
  //   - Vercel KV integration: UPSTASH_REDIS_KV_REST_API_URL / UPSTASH_REDIS_KV_REST_API_TOKEN
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.UPSTASH_REDIS_KV_REST_API_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.UPSTASH_REDIS_KV_REST_API_TOKEN
  if (!url || !token) {
    cacheSingleton = null
    return null
  }
  try {
    cacheSingleton = new UpstashCacheAdapter({ url, token })
  } catch {
    cacheSingleton = null
  }
  return cacheSingleton
}

async function cacheGet(key: string): Promise<VisitorPayload | null> {
  const cache = getCache()
  if (!cache) return null
  try {
    const value = await cache.get(key)
    if (!value) return null
    return typeof value === 'string' ? (JSON.parse(value) as VisitorPayload) : (value as VisitorPayload)
  } catch {
    return null
  }
}

async function cacheSet(key: string, payload: VisitorPayload, ttl: number): Promise<void> {
  const cache = getCache()
  if (!cache) return
  try {
    await cache.set(key, payload, ttl)
  } catch {
    /* noop */
  }
}

async function fetchOrderStats(email: string): Promise<OrderStats> {
  const host = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
  const key = process.env.POSTHOG_API_KEY
  if (!key) return { count: 0, lastAt: null }

  try {
    const res = await fetch(`${host}/api/projects/@current/query/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: {
          kind: 'HogQLQuery',
          query: `SELECT count() AS n, max(created_at) AS last_at FROM shopify_orders WHERE email = '${email.replace(/'/g, "''")}'`,
        },
      }),
    })
    if (!res.ok) return { count: 0, lastAt: null }
    const data = (await res.json()) as { results?: Array<Array<unknown>> }
    const row = data.results?.[0]
    if (!row) return { count: 0, lastAt: null }
    const count = Number(row[0] ?? 0)
    const lastAt = typeof row[1] === 'string' ? row[1] : null
    return { count: Number.isFinite(count) ? count : 0, lastAt }
  } catch {
    return { count: 0, lastAt: null }
  }
}

export async function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(req.headers.get('origin')),
  })
}

export async function GET(req: Request) {
  const headers: Record<string, string> = {
    ...corsHeaders(req.headers.get('origin')),
    'Content-Type': 'application/json',
  }

  const url = new URL(req.url)
  const k = (url.searchParams.get('k') ?? '').trim()

  if (!k) {
    return Response.json({ t: 'a', v: nowEpochSec() } satisfies VisitorPayload, { headers })
  }

  const cacheKey = `visitor:${k}`
  const cached = await cacheGet(cacheKey)
  if (cached) {
    return Response.json(cached, { headers })
  }

  const profile = await resolveKlaviyoProfile(k)

  if (!profile) {
    const payload: VisitorPayload = { t: 'a', v: nowEpochSec() }
    await cacheSet(cacheKey, payload, CACHE_TTL_TRANSIENT)
    return Response.json(payload, { headers })
  }

  if (!profile.identified || !profile.email) {
    const payload: VisitorPayload = { t: 'a', v: nowEpochSec() }
    await cacheSet(cacheKey, payload, CACHE_TTL_OK)
    return Response.json(payload, { headers })
  }

  const orderStats = await fetchOrderStats(profile.email)
  const payload: VisitorPayload = {
    t: codifyTier(orderStats.count > 0, true),
    v: nowEpochSec(),
  }
  if (orderStats.count > 0) {
    payload.n = orderStats.count
    const last = codifyDate(orderStats.lastAt)
    if (last !== null) payload.o = last
  }

  await cacheSet(cacheKey, payload, CACHE_TTL_OK)
  return Response.json(payload, { headers })
}
