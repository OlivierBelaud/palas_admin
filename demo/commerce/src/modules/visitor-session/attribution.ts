// Pure helpers for first-touch attribution + paid-source detection.
//
// Kept separate from the upsert planner so unit tests can hammer the
// edge cases of paid-source detection without touching the larger
// `planSessionUpsert` surface. No framework globals — easy to import
// and run in isolation.

/**
 * PostHog event shape we care about for attribution. Compatible with both
 * the live subscriber's normalized event and the cron rattrapage row.
 */
export interface AttributionEventInput {
  properties?: Record<string, unknown>
}

/**
 * D2 (locked): `is_paid_session` evaluates to `true` when any of the
 * following holds:
 *   - `utm_medium` is one of `cpc`, `paid`, `ppc`
 *   - `utm_source` is one of `google_ads`, `meta_ads`, `tiktok_ads`,
 *     `facebook_ads`, `bing_ads`, `klaviyo`
 *   - `current_url` carries `gclid|fbclid|ttclid` as a query parameter
 *     (any value).
 *
 * Comparisons are case-insensitive on utm_* (PostHog normalises these
 * to lowercase but we tolerate vendors that don't).
 */
export function isPaidSession(props: {
  current_url?: string | null
  utm_source?: string | null
  utm_medium?: string | null
}): boolean {
  const medium = props.utm_medium?.toLowerCase() ?? null
  if (medium === 'cpc' || medium === 'paid' || medium === 'ppc') return true

  const source = props.utm_source?.toLowerCase() ?? null
  if (
    source === 'google_ads' ||
    source === 'meta_ads' ||
    source === 'tiktok_ads' ||
    source === 'facebook_ads' ||
    source === 'bing_ads' ||
    source === 'klaviyo'
  ) {
    return true
  }

  const url = props.current_url ?? null
  if (url) {
    // Match `?gclid=...`, `&fbclid=...`, etc. Bare `gclid` substring is
    // not enough — we require a `?` or `&` boundary + `=`.
    if (/[?&](gclid|fbclid|ttclid)=/i.test(url)) return true
  }

  return false
}

export interface ExtractedAttribution {
  first_url: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  referring_domain: string | null
  is_paid_session: boolean
}

/**
 * Extract first-touch attribution fields from a PostHog event. Reads from
 * `properties.$current_url`, `properties.utm_*`, `properties.$referring_domain`.
 * All fields default to `null` when missing. `is_paid_session` is computed
 * from the extracted utm_* + current_url.
 */
export function extractAttribution(evt: AttributionEventInput): ExtractedAttribution {
  const props = evt.properties ?? {}
  const first_url = readStr(props.$current_url) ?? readStr(props.current_url) ?? null
  const utm_source = readStr(props.utm_source) ?? null
  const utm_medium = readStr(props.utm_medium) ?? null
  const utm_campaign = readStr(props.utm_campaign) ?? null
  const referring_domain = readStr(props.$referring_domain) ?? readStr(props.referring_domain) ?? null

  return {
    first_url,
    utm_source,
    utm_medium,
    utm_campaign,
    referring_domain,
    is_paid_session: isPaidSession({ current_url: first_url, utm_source, utm_medium }),
  }
}

/**
 * Extract the PostHog `$session_id` from an event. Returns `null` if not
 * present (some events — e.g. server-side `$identify` — don't carry one).
 */
export function extractSessionId(evt: AttributionEventInput): string | null {
  return readStr(evt.properties?.$session_id) ?? null
}

function readStr(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  return trimmed.length > 0 ? trimmed : null
}
