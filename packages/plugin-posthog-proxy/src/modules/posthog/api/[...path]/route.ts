// PostHog Proxy — catch-all raw route (escape hatch, NOT CQRS)
// Forwards all requests from the PostHog JS SDK (/capture/, /decide/, /e/, /s/, etc.)
// + optional Klaviyo identity bridge + inflight identity enrichment.
//
// Identity bridge: extracts $_kx (newsletter click) or $kla_id (__kla_id cookie)
// from event properties, resolves the email via Klaviyo API, and sends $identify to PostHog.
//
// Inflight identity enrichment (added 2026-04-21):
//   Before forwarding any batch to PostHog, we decompress → parse → and for
//   every event carrying a distinct_id but no $set.email, we look up the
//   email (cache first, HogQL fallback) and inject `$set.email`. This way
//   PostHog stores the event WITH the identity on it, so downstream
//   consumers (our cart tracker, analytics queries, etc.) don't have to
//   join against person.properties.email.
//   The cache is populated from three sources:
//     1. Events that already carry $set.email (pass-through seeding)
//     2. Klaviyo / checkout identity bridges resolving an email
//     3. HogQL fallback `person.properties.email` lookup (5 min TTL)

import { gunzipSync, gzipSync } from 'node:zlib'

interface PostHogProxyConfig {
  host: string
  publicToken?: string
  klaviyoApiKey?: string
  apiKey?: string
}

// ── In-memory caches ────────────────────────────────────────────────
const identityCache = new Map<string, string>()
const identifiedIds = new Set<string>()

// distinct_id → { email, expires_at }. Null email is cached too so we don't
// keep re-querying PostHog for ids with no known identity. Process-local;
// a cold start just re-populates from HogQL on demand.
interface EmailCacheEntry {
  email: string | null
  expires_at: number
}
const EMAIL_CACHE_TTL_MS = 5 * 60 * 1000
const distinctIdToEmail = new Map<string, EmailCacheEntry>()

function cacheEmail(distinctId: string, email: string | null): void {
  distinctIdToEmail.set(distinctId, { email, expires_at: Date.now() + EMAIL_CACHE_TTL_MS })
}

function getCachedEmail(distinctId: string): string | null | undefined {
  const entry = distinctIdToEmail.get(distinctId)
  if (!entry) return undefined
  if (entry.expires_at < Date.now()) {
    distinctIdToEmail.delete(distinctId)
    return undefined
  }
  return entry.email
}

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
    apiKey: process.env.POSTHOG_API_KEY,
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

export async function POST(req: Request & { app?: any }) {
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

  // ── Parse body once (used for log + enrichment + identity bridges) ─
  // Session recordings arrive as binary bytes — tryDecompress or JSON.parse
  // fail, we fall through to forward as-is.
  let parsed: unknown = null
  const isGzipped = rawBytes.length > 1 && rawBytes[0] === 0x1f && rawBytes[1] === 0x8b
  if (rawBytes.length > 0) {
    try {
      const jsonText = tryDecompress(rawBytes)
      if (jsonText) parsed = JSON.parse(jsonText)
    } catch {
      // Not parseable (binary session recording, etc.) — parsed stays null
    }
  }

  // ── Inflight identity enrichment ───────────────────────────────
  // Inject $set.email on events whose distinct_id we already know an
  // email for. Cache first, HogQL fallback for unknown ids. Blocks the
  // forward briefly on cold cache (single lookup per distinct_id per TTL).
  let forwardBytes: Uint8Array = rawBytes
  if (parsed) {
    const events = extractEventList(parsed)
    for (const evt of events) logEvent(path, evt)
    const modified = await enrichEventsWithEmail(events, config)
    if (modified) {
      try {
        const patchedJson = JSON.stringify(parsed)
        forwardBytes = isGzipped
          ? new Uint8Array(gzipSync(Buffer.from(patchedJson)))
          : new Uint8Array(Buffer.from(patchedJson, 'utf-8'))
      } catch (err) {
        console.error('[posthog-proxy] Re-serialize failed — forwarding original:', err)
        forwardBytes = rawBytes
      }
    }
  }

  // Forward (potentially enriched) bytes to PostHog
  const resp = await fetch(targetUrl, { method: 'POST', headers, body: forwardBytes as BodyInit })
  const responseBody = await resp.text()

  // ── Identity bridges (fire-and-forget) ──────────────────────────
  if (parsed) {
    // Checkout identity: resolve email from checkout:contact_info_submitted
    processCheckoutIdentity(parsed, config, clientIp).catch((err) => {
      console.error('[posthog-proxy] Checkout identity error:', err)
    })

    // Klaviyo identity: resolve email from $_kx / $kla_id tokens
    if (config.klaviyoApiKey) {
      processEvents(parsed, config, clientIp).catch((err) => {
        console.error('[posthog-proxy] Klaviyo bridge error:', err)
      })
    }

    // Publish an internal framework event. Any subscriber listening to
    // 'posthog.events.received' (e.g. a demo-side subscriber that routes to
    // ingestCartEvent) can react. The plugin stays pure — no DB writes,
    // no command coupling, no demo schema knowledge.
    //
    // If the app or event bus is not available, skip silently — the plugin
    // must work in environments that don't register a Manta app.
    const app = req.app as { emit?: (event: string, data: unknown) => Promise<void> } | undefined
    if (app?.emit) {
      app.emit('posthog.events.received', { body: parsed }).catch((err) => {
        console.error('[posthog-proxy] emit posthog.events.received error:', err)
      })
    }
  }

  return new Response(responseBody, {
    status: resp.status,
    headers: { ...CORS_HEADERS, 'Content-Type': resp.headers.get('Content-Type') ?? 'application/json' },
  })
}

/** Normalize a PostHog batch body into an array of event objects. */
function extractEventList(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[]
  const obj = body as Record<string, unknown>
  if (Array.isArray(obj.batch)) return obj.batch as Record<string, unknown>[]
  return [obj]
}

function logEvent(path: string, evt: Record<string, unknown>): void {
  const eventName = evt.event as string | undefined
  if (eventName === '$snapshot') return
  const props = evt.properties as Record<string, unknown> | undefined
  const distinctId = (evt.distinct_id ?? props?.distinct_id) as string | undefined
  console.log(
    `[posthog-proxy] ${path} ← event: ${eventName ?? '?'} | distinct_id: ${distinctId ?? '?'} | url: ${props?.$current_url ?? '-'}`,
  )
}

/** Known paths where an email could be on a raw event (same spread as extractEmailFromCheckout). */
function getEventKnownEmail(evt: Record<string, unknown>): string | null {
  const props = evt.properties as Record<string, unknown> | undefined
  if (!props) return null
  const $set = props.$set as Record<string, unknown> | undefined
  if (typeof $set?.email === 'string') return $set.email
  const checkout = props.checkout as Record<string, unknown> | undefined
  if (typeof checkout?.email === 'string') return checkout.email
  // @legacy-schema-v1 — root-level email paths from pre-unified pixel
  if (typeof props.email === 'string') return props.email
  if (typeof props.$email === 'string') return props.$email
  return null
}

/**
 * Enrich events in place: for each event missing $set.email, inject the
 * known email (cache or HogQL lookup) for its distinct_id. Returns true
 * if at least one event was modified (= the body must be re-serialized
 * before forwarding).
 */
async function enrichEventsWithEmail(events: Record<string, unknown>[], config: PostHogProxyConfig): Promise<boolean> {
  // Pass 1: seed the cache from every event that already has an email.
  // This lets a same-batch cart event without $set.email benefit from the
  // $identify event sitting right next to it.
  for (const evt of events) {
    const props = evt.properties as Record<string, unknown> | undefined
    const distinctId = (evt.distinct_id ?? props?.distinct_id) as string | undefined
    if (!distinctId) continue
    const email = getEventKnownEmail(evt)
    if (email) cacheEmail(distinctId, email)
  }

  // Pass 2: collect events that still need enrichment, deduplicate by
  // distinct_id so a burst of cart events for the same user triggers at
  // most ONE HogQL lookup.
  const eventsToEnrich: { evt: Record<string, unknown>; distinctId: string }[] = []
  const lookupsNeeded = new Set<string>()
  for (const evt of events) {
    const eventName = evt.event as string | undefined
    if (eventName === '$snapshot') continue
    const props = evt.properties as Record<string, unknown> | undefined
    const distinctId = (evt.distinct_id ?? props?.distinct_id) as string | undefined
    if (!distinctId) continue
    if (getEventKnownEmail(evt)) continue

    eventsToEnrich.push({ evt, distinctId })
    const cached = getCachedEmail(distinctId)
    if (cached === undefined) lookupsNeeded.add(distinctId)
  }

  if (eventsToEnrich.length === 0) return false

  // Parallel HogQL lookups for cold-cache distinct_ids. Cache null results
  // too to prevent re-querying for ids with no identity.
  if (lookupsNeeded.size > 0) {
    await Promise.all(
      Array.from(lookupsNeeded).map(async (id) => {
        const email = await lookupEmailFromPostHog(id, config)
        cacheEmail(id, email)
      }),
    )
  }

  // Apply enrichment
  let modified = false
  for (const { evt, distinctId } of eventsToEnrich) {
    const email = getCachedEmail(distinctId)
    if (!email) continue
    if (!evt.properties) evt.properties = {}
    const props = evt.properties as Record<string, unknown>
    const $set = (props.$set as Record<string, unknown> | undefined) ?? {}
    props.$set = { ...$set, email }
    modified = true
  }
  return modified
}

/**
 * HogQL lookup for `person.properties.email` by distinct_id. Returns null
 * when the api key is missing, the request fails, or the person has no
 * known email.
 */
async function lookupEmailFromPostHog(distinctId: string, config: PostHogProxyConfig): Promise<string | null> {
  if (!config.apiKey) return null
  const safe = distinctId.replace(/'/g, "''")
  try {
    const res = await fetch(`${config.host}/api/projects/@current/query/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: {
          kind: 'HogQLQuery',
          query: `SELECT person.properties.email FROM events WHERE distinct_id = '${safe}' AND person.properties.email IS NOT NULL AND person.properties.email != '' ORDER BY timestamp DESC LIMIT 1`,
        },
      }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { results?: unknown[][] }
    return (data.results?.[0]?.[0] as string | null | undefined) ?? null
  } catch {
    return null
  }
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

// ── Checkout identity bridge ────────────────────────────────────
// When checkout:contact_info_submitted arrives, extract the email
// and $identify the anonymous checkout distinct_id.

const CHECKOUT_EVENTS_WITH_EMAIL = new Set([
  'checkout:contact_info_submitted',
  'checkout:completed',
  'checkout:shipping_info_submitted',
])

async function processCheckoutIdentity(body: unknown, config: PostHogProxyConfig, clientIp?: string | null) {
  const events = Array.isArray(body) ? body : (((body as Record<string, unknown>).batch as unknown[]) ?? [body])

  for (const event of events as Record<string, unknown>[]) {
    const eventName = event.event as string | undefined
    if (!eventName) continue

    // Log full properties for ALL checkout:* events (debug)
    if (eventName.startsWith('checkout:')) {
      console.log(`[posthog-proxy] CHECKOUT EVENT DUMP: ${eventName}`, JSON.stringify(event, null, 2))
    }

    // Only try to identify on events that carry email
    if (!CHECKOUT_EVENTS_WITH_EMAIL.has(eventName)) continue

    const props = event.properties as Record<string, unknown> | undefined
    const distinctId = (event.distinct_id ?? props?.distinct_id) as string | undefined
    if (!distinctId) continue
    if (identifiedIds.has(distinctId)) continue

    const $set = props?.$set as Record<string, unknown> | undefined

    // Extract email from $set (confirmed Shopify structure)
    const email = extractEmailFromCheckout(event, props)
    if (!email) {
      console.log(`[posthog-proxy] ${eventName}: no email found for ${distinctId}`)
      continue
    }

    const firstName = $set?.first_name as string | undefined
    const lastName = $set?.last_name as string | undefined
    // v2 unified schema: shopify_customer_id lives on CheckoutPayload.
    // @legacy-schema-v1 fallback: v1 put the Shopify customer ID as `$set.id`.
    const checkout = props?.checkout as Record<string, unknown> | undefined
    const shopifyCustomerId = (checkout?.shopify_customer_id ?? $set?.id) as string | number | undefined

    // 1. Send $identify — keep the original distinct_id, put person data in $set
    console.log(`[posthog-proxy] ${eventName}: found email ${email} for ${distinctId} — sending $identify`)
    await sendPostHogEvent(config, clientIp, {
      api_key: config.publicToken!,
      event: '$identify',
      distinct_id: distinctId,
      properties: {
        $set: {
          email,
          ...(firstName && { first_name: firstName }),
          ...(lastName && { last_name: lastName }),
          ...(shopifyCustomerId && { shopify_customer_id: shopifyCustomerId }),
          checkout_identified: true,
          identified_at: new Date().toISOString(),
        },
      },
    })
    // Warm the email cache so the inflight enrichment on subsequent
    // cart/checkout events hits without needing a HogQL roundtrip.
    cacheEmail(distinctId, email)

    // 2. Merge store distinct_id → checkout distinct_id (same person)
    const storeDistinctId = (props?._distinct_id ?? props?._store_distinct_id) as string | undefined
    if (storeDistinctId && storeDistinctId !== distinctId) {
      console.log(
        `[posthog-proxy] ${eventName}: merging store ${storeDistinctId} → checkout ${distinctId} via $identify`,
      )
      // Identify the STORE distinct_id with the same email — PostHog merges both into one person
      await sendPostHogEvent(config, clientIp, {
        api_key: config.publicToken!,
        event: '$identify',
        distinct_id: storeDistinctId,
        properties: {
          $set: {
            email,
            ...(firstName && { first_name: firstName }),
            ...(lastName && { last_name: lastName }),
            checkout_identified: true,
            identified_at: new Date().toISOString(),
          },
        },
      })
      identifiedIds.add(storeDistinctId)
      cacheEmail(storeDistinctId, email)
    }

    // 3. Send $create_alias — link Shopify customer ID to this distinct_id
    if (shopifyCustomerId) {
      console.log(`[posthog-proxy] ${eventName}: aliasing shopify_customer_id ${shopifyCustomerId} → ${distinctId}`)
      await sendPostHogEvent(config, clientIp, {
        api_key: config.publicToken!,
        event: '$create_alias',
        distinct_id: distinctId,
        properties: {
          alias: String(shopifyCustomerId),
        },
      })
    }

    identifiedIds.add(distinctId)
  }
}

/**
 * Resolve an email from a checkout event across supported schemas.
 *
 * v2 (unified schema): email is at `properties.checkout.email` (canonical)
 *                      or `properties.$set.email` (after identify)
 *
 * Other paths are `@legacy-schema-v1` fallbacks for old events still in
 * PostHog storage. Safe to remove once retention rolls past the v2 cutover.
 * → BACKLOG.md: "Remove PostHog legacy schema v1"
 */
function extractEmailFromCheckout(_event: Record<string, unknown>, props?: Record<string, unknown>): string | null {
  // v2 canonical: $set.email (from identify) and checkout.email (Shopify pixel)
  const $set = props?.$set as Record<string, unknown> | undefined
  if (typeof $set?.email === 'string') return $set.email

  const checkout = props?.checkout as Record<string, unknown> | undefined
  if (typeof checkout?.email === 'string') return checkout.email

  // @legacy-schema-v1 — root-level email + misc Shopify paths from v1 pixel
  if (typeof props?.email === 'string') return props.email
  if (typeof props?.$email === 'string') return props.$email
  if (typeof $set?.$email === 'string') return $set.$email
  const customer = (checkout?.customer ?? props?.customer) as Record<string, unknown> | undefined
  if (typeof customer?.email === 'string') return customer.email
  const billing = (checkout?.billingAddress ?? props?.billingAddress) as Record<string, unknown> | undefined
  if (typeof billing?.email === 'string') return billing.email
  if (typeof props?.$user_email === 'string') return props.$user_email

  return null
}

// ── Klaviyo identity bridge ─────────────────────────────────────────

async function processEvents(body: unknown, config: PostHogProxyConfig, clientIp?: string | null) {
  const events = Array.isArray(body) ? body : ((body as Record<string, unknown>).batch ?? [body])

  for (const event of events as Record<string, unknown>[]) {
    // Skip session recording snapshots (no user properties)
    if (event.event === '$snapshot') continue

    const props = event.properties as Record<string, unknown> | undefined
    const distinctId = (event.distinct_id ?? props?.distinct_id) as string | undefined
    if (!distinctId) continue
    if (identifiedIds.has(distinctId)) continue

    // Try to extract a Klaviyo exchange token from multiple sources:
    // 1. $_kx in properties (PostHog SDK cookie)
    // 2. $kla_id from __kla_id cookie (registered via posthog.register)
    // 3. $_kx or _kx in $set (PostHog SDK puts URL params in $set)
    // 4. _kx from $current_url query param (newsletter link)
    const $set = props?.$set as Record<string, unknown> | undefined
    const kxFromUrl = extractKxFromUrl(props?.$current_url as string | undefined)
    const exchangeId = extractExchangeId(
      props?.$_kx as string | null,
      props?.$kla_id as string | null,
      ($set?.$_kx as string | null) ?? ($set?._kx as string | null),
      kxFromUrl,
    )
    if (!exchangeId) continue

    console.log(
      `[posthog-proxy] Resolving Klaviyo identity for distinct_id: ${distinctId}, exchangeId: ${exchangeId.slice(0, 30)}...`,
    )
    try {
      const email = await resolveKlaviyoEmail(exchangeId, config)
      console.log(`[posthog-proxy] Klaviyo result: ${email ?? 'null'}`)
      if (email) {
        await identifyInPostHog(distinctId, email, config, clientIp)
        identifiedIds.add(distinctId)
        cacheEmail(distinctId, email)
        console.log(`[posthog-proxy] ✓ Identified ${distinctId} as ${email}`)
      }
    } catch (err) {
      console.log(`[posthog-proxy] ERROR resolving: ${(err as Error).message}`)
    }
  }
}

/**
 * Extract the $exchange_id from either $_kx or $kla_id.
 *
 * $_kx: raw exchange_id from newsletter URL param (e.g. "g8yDA5d2_J7Ub...")
 *       OR base64 JSON from PostHog SDK cookie reading.
 * $kla_id: base64 JSON from __kla_id cookie: {"cid":"...", "$exchange_id":"..."}
 *          If only cid exists (no $exchange_id), the user is anonymous — skip.
 */
function extractExchangeId(...tokens: (string | null | undefined)[]): string | null {
  for (const token of tokens) {
    if (!token) continue
    // Try base64 JSON first (cookie format)
    try {
      const decoded = JSON.parse(Buffer.from(token, 'base64').toString())
      if (decoded.$exchange_id) return decoded.$exchange_id as string
    } catch {
      // Not base64 JSON — could be raw exchange_id from URL
      // Raw exchange_ids contain dots (e.g. "g8yDA5d2_J7Ub...VeFGwD")
      if (token.includes('.') && token.length > 10) return token
    }
  }
  return null
}

function extractKxFromUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.searchParams.get('_kx')
  } catch {
    return null
  }
}

/**
 * Resolve a Klaviyo $exchange_id to an email using the profile-import endpoint.
 * This is the correct API for exchange tokens (not GET /profiles/?filter=...).
 */
async function resolveKlaviyoEmail(exchangeId: string, config: PostHogProxyConfig): Promise<string | null> {
  if (identityCache.has(exchangeId)) return identityCache.get(exchangeId)!
  if (!config.klaviyoApiKey) return null

  const MAX_RETRIES = 3
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
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
      if (attempt < MAX_RETRIES) {
        console.warn(`[posthog-proxy] Klaviyo fetch failed (attempt ${attempt}/${MAX_RETRIES}), retrying...`)
        await new Promise((r) => setTimeout(r, 200 * attempt))
        continue
      }
      console.error(`[posthog-proxy] Klaviyo failed after ${MAX_RETRIES} attempts:`, (err as Error).message)
      return null
    }
  }
  return null
}

/** Low-level: send a single event to PostHog ingest API */
async function sendPostHogEvent(
  config: PostHogProxyConfig,
  clientIp?: string | null,
  payload?: Record<string, unknown>,
) {
  if (!config.publicToken) {
    console.warn('[posthog-proxy] POSTHOG_TOKEN not set — cannot send event')
    return
  }
  try {
    const fetchHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
    if (clientIp) fetchHeaders['x-forwarded-for'] = clientIp
    const res = await fetch(`${config.host}/i/v0/e/`, {
      method: 'POST',
      headers: fetchHeaders,
      body: JSON.stringify(payload),
    })
    console.log(`[posthog-proxy] PostHog ${payload?.event} response: ${res.status}`)
  } catch (err) {
    console.error(`[posthog-proxy] sendPostHogEvent error (${payload?.event}):`, err)
  }
}

/** Klaviyo identity bridge: identify anonymous distinct_id with resolved email */
async function identifyInPostHog(
  distinctId: string,
  email: string,
  config: PostHogProxyConfig,
  clientIp?: string | null,
) {
  await sendPostHogEvent(config, clientIp, {
    api_key: config.publicToken,
    event: '$identify',
    distinct_id: distinctId,
    properties: {
      $set: {
        email,
        klaviyo_identified: true,
        identified_at: new Date().toISOString(),
      },
    },
  })
}
