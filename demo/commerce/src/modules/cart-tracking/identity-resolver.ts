// Resolves an email for a PostHog distinct_id by querying person.properties.email.
//
// Why this exists: PostHog DOES receive $identify events (via the checkout
// identity bridge in the proxy, and via Klaviyo cookie decryption), but the
// mode `person_id_override_properties_on_events` is best-effort — cart events
// often land in PostHog BEFORE the person merge has propagated, and the
// `$set` bag on the event itself is empty on cart:* events (theme doesn't
// attach email on cart interactions). Result: we have the email at Person
// level in PostHog but our cart snapshot has `email = null`.
//
// Fix: on ingest (live + rebuild), if an event has a distinct_id but no
// email, query PostHog for `person.properties.email` and backfill.
//
// Two modes:
//   - `resolveEmailByDistinctId(id)` — single lookup for the live subscriber,
//     cached for 5 min to avoid hitting PostHog for every cart event of the
//     same session.
//   - `resolveEmailsBatch()` — one HogQL query that returns the full
//     distinct_id → email map for all cart/checkout events in PostHog.
//     Used by rebuildCarts so we do ONE extra roundtrip, not N.
//
// Metrics are collected per process and surfaced via `getIdentityMetrics()`.

interface CacheEntry {
  email: string | null
  expires_at: number
}

const TTL_MS = 5 * 60 * 1000
const cache = new Map<string, CacheEntry>()

let metrics = { lookups: 0, hits: 0, misses: 0, recoveries: 0 }

export interface IdentityResolverOptions {
  host?: string
  apiKey?: string
}

export function getIdentityMetrics(): {
  lookups: number
  hits: number
  misses: number
  recoveries: number
  cacheSize: number
} {
  return { ...metrics, cacheSize: cache.size }
}

export function resetIdentityMetrics(): void {
  metrics = { lookups: 0, hits: 0, misses: 0, recoveries: 0 }
}

export function clearIdentityCache(): void {
  cache.clear()
}

/**
 * Resolve email for a single distinct_id. Returns cached value if still
 * fresh, otherwise issues a HogQL query against `person.properties.email`.
 * Null results are cached too, to avoid re-querying missing identities.
 */
export async function resolveEmailByDistinctId(
  distinctId: string,
  opts: IdentityResolverOptions = {},
): Promise<string | null> {
  const now = Date.now()
  const cached = cache.get(distinctId)
  if (cached && cached.expires_at > now) {
    metrics.hits += 1
    return cached.email
  }

  const host = opts.host ?? process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
  const key = opts.apiKey ?? process.env.POSTHOG_API_KEY
  if (!key) return null

  metrics.lookups += 1
  const safe = distinctId.replace(/'/g, "''")
  try {
    const res = await fetch(`${host}/api/projects/@current/query/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: {
          kind: 'HogQLQuery',
          query: `SELECT person.properties.email FROM events WHERE distinct_id = '${safe}' AND person.properties.email IS NOT NULL AND person.properties.email != '' ORDER BY timestamp DESC LIMIT 1`,
        },
      }),
    })
    if (!res.ok) {
      cache.set(distinctId, { email: null, expires_at: now + TTL_MS })
      metrics.misses += 1
      return null
    }
    const data = (await res.json()) as { results?: unknown[][] }
    const email = (data.results?.[0]?.[0] as string | null | undefined) ?? null
    cache.set(distinctId, { email, expires_at: now + TTL_MS })
    if (email) metrics.recoveries += 1
    else metrics.misses += 1
    return email
  } catch {
    return null
  }
}

/**
 * Batch resolver used by rebuildCarts. One HogQL query returning every
 * distinct_id ↔ email pair known to PostHog for cart/checkout events.
 * The caller supplies the set of ids we care about for logging purposes;
 * the query itself scans the cart/checkout event population directly so
 * we don't have to shove thousands of ids into an IN(...) clause.
 */
export async function resolveEmailsBatch(opts: IdentityResolverOptions = {}): Promise<Map<string, string>> {
  const map = new Map<string, string>()

  const host = opts.host ?? process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
  const key = opts.apiKey ?? process.env.POSTHOG_API_KEY
  if (!key) return map

  try {
    const res = await fetch(`${host}/api/projects/@current/query/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: {
          kind: 'HogQLQuery',
          // LIMIT 100000: PostHog HogQL defaults to 100 rows when no explicit
          // LIMIT is set, which silently drops 90% of distinct_ids on a real
          // store. Blow the ceiling high enough that we only have to worry
          // about pagination once we genuinely cross this count.
          query: `SELECT DISTINCT distinct_id, person.properties.email FROM events WHERE (event LIKE 'cart:%' OR event LIKE 'checkout:%') AND person.properties.email IS NOT NULL AND person.properties.email != '' LIMIT 100000`,
        },
      }),
    })
    if (!res.ok) return map
    const data = (await res.json()) as { results?: unknown[][] }
    for (const row of data.results ?? []) {
      const id = row[0] as string | null
      const email = row[1] as string | null
      if (id && email) {
        map.set(id, email)
        cache.set(id, { email, expires_at: Date.now() + TTL_MS })
      }
    }
    return map
  } catch {
    return map
  }
}

/**
 * Enrich an event payload in place by injecting `$set.email` when we have
 * a recovered email for the event's distinct_id and the event doesn't
 * already carry one. Returns true if enrichment was applied (used for
 * metrics).
 */
export function enrichEventWithEmail(
  evt: { distinct_id?: string | null; properties?: Record<string, unknown> },
  emailMap: Map<string, string>,
): boolean {
  const id = evt.distinct_id
  if (!id) return false
  const email = emailMap.get(id)
  if (!email) return false
  if (!evt.properties) evt.properties = {}
  const props = evt.properties
  const $set = (props.$set as Record<string, unknown> | undefined) ?? {}
  if ($set.email) return false
  props.$set = { ...$set, email }
  return true
}
