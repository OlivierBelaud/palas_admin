// Build a recovery URL to send back to a customer whose cart went stale.
//
// Cascade (most to least useful):
//   1. checkout_token → Shopify checkout recovery URL (email + address + shipping prefilled)
//   2. items + cart_token → Shopify cart permalink (cart prefilled, but no checkout state)
//   3. nothing reliable → front base URL (better than broken link)
//
// Base URL comes from FRONT_BASE_URL (defaults to https://fancypalas.com).

export interface RecoveryCartItem {
  id?: string | number | null
  quantity?: number | null
}

export interface RecoveryCart {
  checkout_token?: string | null
  cart_token?: string | null
  items?: RecoveryCartItem[] | null
}

export function buildRecoveryUrl(cart: RecoveryCart): string {
  const base = (process.env.FRONT_BASE_URL ?? 'https://fancypalas.com').replace(/\/+$/, '')

  if (cart.checkout_token) {
    return `${base}/checkouts/cn/${encodeURIComponent(cart.checkout_token)}/recover`
  }

  const items = Array.isArray(cart.items) ? cart.items : []
  const pairs: string[] = []
  for (const it of items) {
    const id = it?.id
    const qty = Math.max(1, Math.floor(Number(it?.quantity ?? 1)) || 1)
    if (id === undefined || id === null || id === '') continue
    pairs.push(`${id}:${qty}`)
  }
  if (pairs.length > 0) {
    const ref = cart.cart_token ? `?ref=${encodeURIComponent(cart.cart_token)}` : ''
    return `${base}/cart/${pairs.join(',')}${ref}`
  }

  return `${base}/`
}
