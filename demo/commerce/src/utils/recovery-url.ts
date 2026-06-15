// Build a recovery URL to send back to a customer whose cart went stale.
//
// Cascade (most to least useful):
//   1. items + cart_token → Shopify cart permalink (cart prefilled, valid storefront route)
//   2. nothing reliable → front base URL (better than broken link)
//
// Base URL comes from FRONT_BASE_URL (defaults to https://fancypalas.com).
//
// Do not fabricate `/checkouts/cn/<token>/recover` from `checkout_token`.
// Shopify recovery links are only safe when Shopify gives us the full recovery
// URL; a bare checkout token can 404 on the storefront domain.

export interface RecoveryCartItem {
  id?: string | number | null
  quantity?: number | null
}

export interface RecoveryCart {
  checkout_token?: string | null
  cart_token?: string | null
  items?: RecoveryCartItem[] | null
}

export interface RecoveryUrlOptions {
  discountCode?: string | null
  trackingParams?: Record<string, string | number | null | undefined> | null
}

function appendQuery(url: string, params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue
    const normalized = String(value).trim()
    if (!normalized) continue
    search.set(key, normalized)
  }
  const query = search.toString()
  if (!query) return url
  const joiner = url.includes('?') ? '&' : '?'
  return `${url}${joiner}${query}`
}

export function buildRecoveryUrl(cart: RecoveryCart, opts?: RecoveryUrlOptions): string {
  const base = (process.env.FRONT_BASE_URL ?? 'https://fancypalas.com').replace(/\/+$/, '')

  const items = Array.isArray(cart.items) ? cart.items : []
  const pairs: string[] = []
  for (const it of items) {
    const id = it?.id
    const qty = Math.max(1, Math.floor(Number(it?.quantity ?? 1)) || 1)
    if (id === undefined || id === null || id === '') continue
    pairs.push(`${id}:${qty}`)
  }
  if (pairs.length > 0) {
    return appendQuery(`${base}/cart/${pairs.join(',')}`, {
      ref: cart.cart_token,
      discount: opts?.discountCode,
      ...(opts?.trackingParams ?? {}),
    })
  }

  return appendQuery(`${base}/`, {
    discount: opts?.discountCode,
    ...(opts?.trackingParams ?? {}),
  })
}
