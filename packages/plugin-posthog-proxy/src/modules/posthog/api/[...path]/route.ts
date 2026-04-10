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

  // Forward raw bytes to PostHog (gzip stays gzip)
  const resp = await fetch(targetUrl, { method: 'POST', headers, body: rawBytes })
  const responseBody = await resp.text()

  // ── Log all incoming events ────────────────────────────────────
  let parsed: unknown = null
  if (rawBytes.length > 0) {
    try {
      const jsonText = tryDecompress(rawBytes)
      if (jsonText) {
        parsed = JSON.parse(jsonText)
        const events = Array.isArray(parsed)
          ? parsed
          : (((parsed as Record<string, unknown>).batch as unknown[]) ?? [parsed])
        for (const evt of events as Record<string, unknown>[]) {
          const eventName = evt.event as string | undefined
          if (eventName === '$snapshot') continue // skip session recordings
          const props = evt.properties as Record<string, unknown> | undefined
          const distinctId = (evt.distinct_id ?? props?.distinct_id) as string | undefined
          console.log(
            `[posthog-proxy] ${path} ← event: ${eventName ?? '?'} | distinct_id: ${distinctId ?? '?'} | url: ${props?.$current_url ?? '-'}`,
          )
        }
      }
    } catch {
      // Not parseable (session recording binary, etc.) — skip
    }
  }

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
    const shopifyCustomerId = $set?.id as number | undefined

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

/** Try every known path where Shopify might put the email */
function extractEmailFromCheckout(event: Record<string, unknown>, props?: Record<string, unknown>): string | null {
  // Direct properties
  if (typeof props?.email === 'string') return props.email
  if (typeof props?.$email === 'string') return props.$email

  // Nested in $set
  const $set = props?.$set as Record<string, unknown> | undefined
  if (typeof $set?.email === 'string') return $set.email
  if (typeof $set?.$email === 'string') return $set.$email

  // Shopify checkout object (common in web pixel events)
  const checkout = (props?.checkout ?? event.checkout) as Record<string, unknown> | undefined
  if (typeof checkout?.email === 'string') return checkout.email

  // Shopify customer object
  const customer = (checkout?.customer ?? props?.customer ?? event.customer) as Record<string, unknown> | undefined
  if (typeof customer?.email === 'string') return customer.email

  // Billing/shipping address
  const billing = (checkout?.billingAddress ?? props?.billingAddress) as Record<string, unknown> | undefined
  if (typeof billing?.email === 'string') return billing.email

  // $user_email (PostHog convention)
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
