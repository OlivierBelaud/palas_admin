// Visitor identification endpoint — called from the Shopify theme.
//
// Shape: GET /api/cart-tracking/c?<one of>
//   k=<klaviyo_exchange_id>   — historical Klaviyo $exchange_id
//   u=<manta_uid_token>       — symmetric HMAC token issued by signContactToken
//   d=<distinct_id>           — direct PostHog distinct_id lookup
// Returns a short codified JSON payload { t, n?, o?, v } that the theme
// stores in sessionStorage. See src/utils/visitor-codes.ts for the mapping.
//
// Lives inside `cart-tracking` because v1 personalization targets the cart
// drawer, and Manta's build manifest only collects api routes from modules
// that have at least one entity (see BACKLOG VIS-04).
//
// Identity comes from `contacts`; purchase state comes from live `orders`.
// Klaviyo API is only consulted when ?k= misses the local
// klaviyo_exchange_resolved cache.
//
// Never throws — every failure path falls back to { t: 'a', v } so the theme
// UX degrades gracefully.

import { createHash } from 'node:crypto'
import { UpstashCacheAdapter } from '@mantajs/adapter-cache-upstash'
import { nowEpochSec } from '../../../../utils/visitor-codes'
import {
  type ContactModuleLike,
  resolveByDistinctId,
  resolveByKlaviyoExchangeId,
  resolveByMantaUidToken,
  type VisitorPayload,
} from '../../../../utils/visitor-resolver'

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

function hashShort(value: string): string {
  // Cache-key fingerprint only — no secret material, no need for HMAC. Keep
  // it short to bound the Redis key length.
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function getContactModule(req: Request): ContactModuleLike | null {
  const mantaReq = req as Request & {
    app?: { modules?: { contact?: unknown; order?: unknown } }
  }
  const contact = mantaReq.app?.modules?.contact as Omit<ContactModuleLike, 'listOrders'> | undefined
  const order = mantaReq.app?.modules?.order as { listOrders?: ContactModuleLike['listOrders'] } | undefined
  if (!contact || typeof order?.listOrders !== 'function') return null
  return {
    ...contact,
    listOrders: order.listOrders.bind(order),
  } as ContactModuleLike
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
  const u = (url.searchParams.get('u') ?? '').trim()
  const d = (url.searchParams.get('d') ?? '').trim()

  if (!k && !u && !d) {
    return Response.json({ t: 'a', v: nowEpochSec() } satisfies VisitorPayload, { headers })
  }

  const contactModule = getContactModule(req)
  if (!contactModule) {
    // Bootstrap race or misconfiguration — degrade to anonymous, do not cache.
    return Response.json({ t: 'a', v: nowEpochSec() } satisfies VisitorPayload, { headers })
  }

  // Priority order: k (live Shopify theme contract) > u (manta token) > d (distinct id).
  // The current production traffic only sends `k`, so its branch must be hit first
  // and return identical output to the previous implementation for the same input.

  if (k) {
    const cacheKey = `visitor:k:${k}`
    const cached = await cacheGet(cacheKey)
    if (cached) return Response.json(cached, { headers })

    const { payload, transient } = await resolveByKlaviyoExchangeId(contactModule, k)
    await cacheSet(cacheKey, payload, transient ? CACHE_TTL_TRANSIENT : CACHE_TTL_OK)
    return Response.json(payload, { headers })
  }

  if (u) {
    const cacheKey = `visitor:u:${hashShort(u)}`
    const cached = await cacheGet(cacheKey)
    if (cached) return Response.json(cached, { headers })

    const payload = await resolveByMantaUidToken(contactModule, u)
    await cacheSet(cacheKey, payload, CACHE_TTL_OK)
    return Response.json(payload, { headers })
  }

  // d branch — distinct_id direct lookup.
  const cacheKey = `visitor:d:${hashShort(d)}`
  const cached = await cacheGet(cacheKey)
  if (cached) return Response.json(cached, { headers })

  const payload = await resolveByDistinctId(contactModule, d)
  await cacheSet(cacheKey, payload, CACHE_TTL_OK)
  return Response.json(payload, { headers })
}
