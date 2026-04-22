// Source-of-truth for the visitor identification codes.
//
// The payload returned by /api/_/c uses short opaque keys/values to keep the
// cookie/sessionStorage compact and to avoid leaking the segmentation logic
// in clear text. Mappings are documented here only — the theme code matches
// on codes directly, no runtime decoding is needed client-side.
//
// Payload shape:
//   { t: Tier, n?: number, o?: YYYYMMDD, v: epochSeconds }
// The theme merges `s: Source` from URL/referrer detection, client-side.

export const TIER = {
  c: 'customer',
  l: 'lead',
  a: 'anonymous',
} as const

export type Tier = keyof typeof TIER

export const SOURCE = {
  ps: 'paid_social',
  pq: 'paid_search',
  o: 'organic',
  d: 'direct',
  e: 'email',
  r: 'referral',
  u: 'unknown',
} as const

export type Source = keyof typeof SOURCE

export function codifyTier(hasOrders: boolean, identified: boolean): Tier {
  if (hasOrders) return 'c'
  if (identified) return 'l'
  return 'a'
}

/** ISO date string → YYYYMMDD as integer. Returns null on parse failure. */
export function codifyDate(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ymd = iso.slice(0, 10).replace(/-/g, '')
  const n = Number.parseInt(ymd, 10)
  return Number.isFinite(n) && n > 19000000 ? n : null
}

export function nowEpochSec(): number {
  return Math.floor(Date.now() / 1000)
}
