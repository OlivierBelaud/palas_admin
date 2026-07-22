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

import { posthogHost, posthogPrivateKey, runPosthogHogQL } from '../../utils/posthog-query'

interface CacheEntry {
  email: string | null
  expires_at: number
}

const TTL_MS = 5 * 60 * 1000
const LOOKUP_TIMEOUT_MS = 10_000
const MAX_CACHE_ENTRIES = 1_000
const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<string | null>>()

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
  inFlight.clear()
}

function identityKey(distinctId: string, host: string, apiKey: string): string {
  return `${host}\0${apiKey}\0${distinctId}`
}

function pruneExpiredCache(now: number): void {
  for (const [key, entry] of cache) {
    if (entry.expires_at <= now) cache.delete(key)
  }
}

function cacheIdentity(key: string, email: string | null, now = Date.now()): void {
  cache.delete(key)
  cache.set(key, { email, expires_at: now + TTL_MS })
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
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
  const host = opts.host ?? posthogHost()
  const key = opts.apiKey ?? posthogPrivateKey()
  if (!key) return null

  pruneExpiredCache(now)
  const cacheKey = identityKey(distinctId, host, key)
  const cached = cache.get(cacheKey)
  if (cached && cached.expires_at > now) {
    metrics.hits += 1
    return cached.email
  }
  const pending = inFlight.get(cacheKey)
  if (pending) return pending

  const current = (async () => {
    metrics.lookups += 1
    const safe = distinctId.replace(/'/g, "''")
    try {
      const rows = await runPosthogHogQL(
        `SELECT person.properties.email FROM events WHERE distinct_id = '${safe}' AND person.properties.email IS NOT NULL AND person.properties.email != '' ORDER BY timestamp DESC LIMIT 1`,
        {
          host,
          privateKey: key,
          // Bypass PostHog's server-side query cache — our single-user lookup
          // must reflect the latest $identify, otherwise newly-identified users
          // stay anonymous in our DB for up to the cache TTL.
          refresh: 'force_blocking',
          signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
        },
      )
      const email = (rows?.[0]?.[0] as string | null | undefined) ?? null
      cacheIdentity(cacheKey, email, now)
      if (email) metrics.recoveries += 1
      else metrics.misses += 1
      return email
    } catch {
      metrics.misses += 1
      return null
    }
  })()
  inFlight.set(cacheKey, current)
  current.finally(() => {
    if (inFlight.get(cacheKey) === current) inFlight.delete(cacheKey)
  })
  return current
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

  const host = opts.host ?? posthogHost()
  const key = opts.apiKey ?? posthogPrivateKey()
  if (!key) return map

  try {
    const now = Date.now()
    pruneExpiredCache(now)
    const rows = await runPosthogHogQL(
      // LIMIT 100000: PostHog HogQL defaults to 100 rows when no explicit
      // LIMIT is set, which silently drops 90% of distinct_ids on a real
      // store. Blow the ceiling high enough that we only have to worry
      // about pagination once we genuinely cross this count.
      `SELECT DISTINCT distinct_id, person.properties.email FROM events WHERE (event LIKE 'cart:%' OR event LIKE 'checkout:%') AND person.properties.email IS NOT NULL AND person.properties.email != '' LIMIT 100000`,
      {
        host,
        privateKey: key,
        // Bypass PostHog's server-side query cache. rebuildCarts is meant to
        // produce the authoritative snapshot; cached identity maps would
        // silently miss users who were identified since the last rebuild.
        refresh: 'force_blocking',
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      },
    )
    for (const row of rows ?? []) {
      const id = row[0] as string | null
      const email = row[1] as string | null
      if (id && email) {
        map.set(id, email)
        cacheIdentity(identityKey(id, host, key), email, now)
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
