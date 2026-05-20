// Cron — daily Shopify paid-orders reconciliation safety net.
//
// Schedule: 6:30 UTC (≈ 7:30 / 8:30 Paris, hors heures de pic).
//
// Pulls every paid Shopify order over the last 48h and re-runs the same
// upsert as the live webhook. If the webhook missed a delivery (network
// blip, downtime, replay window expired), this catches it. The 48h window
// covers Shopify's own 48h retry window plus a margin.
//
// Direct postgres + Shopify REST inline — same rationale as the abandoned
// carts cron (300ms short-circuit on `defineCommand`). See
// `detect-abandoned-carts.ts` header for the long version.
//
// Production-only — local `manta dev` no-ops to avoid hitting prod data.

import postgres from 'postgres'
import { type RawDb, refreshCartSnapshot } from '../modules/cart-tracking/refresh-cart'
import { type ShopifyOrderPayload, upsertShopifyOrder } from '../modules/cart-tracking/upsert-shopify-order'

interface ReconcileResult {
  scanned: number
  upserted: number
  matched_cart_token: number
  matched_email: number
  inserted_new: number
  already_completed: number
  errors: number
  duration_ms: number
}

const EMPTY: ReconcileResult = {
  scanned: 0,
  upserted: 0,
  matched_cart_token: 0,
  matched_email: 0,
  inserted_new: 0,
  already_completed: 0,
  errors: 0,
  duration_ms: 0,
}

const WINDOW_HOURS = 48
const PAGE_LIMIT = 250

function parseNextLink(header: string | null): string | null {
  if (!header) return null
  for (const part of header.split(',')) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/)
    if (m) return m[1]
  }
  return null
}

interface ShopifyOrdersResponse {
  orders: ShopifyOrderPayload[]
}

export default defineJob('reconcile-shopify-daily', '30 6 * * *', async ({ log }) => {
  if (process.env.NODE_ENV !== 'production') {
    log.info(`[reconcile-shopify-daily] skipped (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}, prod-only)`)
    return EMPTY
  }
  const dbUrl = process.env.DATABASE_URL
  const shopifyToken =
    process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ?? process.env.SHOPIFY_ADMIN_TOKEN ?? process.env.SHOPIFY_ACCESS_TOKEN
  const shopifyDomain = process.env.SHOPIFY_SHOP_DOMAIN ?? 'fancy-palas.myshopify.com'
  const apiVersion = process.env.SHOPIFY_ADMIN_API_VERSION ?? '2025-10'

  if (!dbUrl || !shopifyToken) {
    log.error('[reconcile-shopify-daily] DATABASE_URL or SHOPIFY_ADMIN_ACCESS_TOKEN missing')
    return { ...EMPTY, errors: 1 }
  }

  const t0 = Date.now()
  const sql = postgres(dbUrl, { ssl: 'require', max: 1, prepare: false })
  const db: RawDb = {
    raw: async <T>(query: string, params?: unknown[]): Promise<T[]> =>
      (await sql.unsafe(query, (params ?? []) as never[])) as T[],
  }
  const result: ReconcileResult = { ...EMPTY }

  try {
    const sinceIso = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString()
    let url: string | null =
      `https://${shopifyDomain}/admin/api/${apiVersion}/orders.json` +
      `?status=any&financial_status=paid&created_at_min=${encodeURIComponent(sinceIso)}&limit=${PAGE_LIMIT}`

    while (url) {
      const res = await fetch(url, {
        headers: {
          'X-Shopify-Access-Token': shopifyToken,
          'Content-Type': 'application/json',
        },
      })
      if (!res.ok) {
        log.warn(`[reconcile-shopify-daily] Shopify HTTP ${res.status}`)
        result.errors++
        break
      }
      const body = (await res.json()) as ShopifyOrdersResponse
      const orders = body.orders ?? []
      result.scanned += orders.length

      for (const order of orders) {
        try {
          const outcome = await upsertShopifyOrder(sql, order)
          await refreshCartSnapshot(db, {
            cart_id: outcome.cart_id,
            cart_token: order.cart_token ?? null,
            checkout_token: order.checkout_token ?? null,
            shopify_order_id: String(order.id),
            email: order.email?.trim().toLowerCase() ?? null,
          })
          if (outcome.already_completed) {
            result.already_completed++
          } else {
            result.upserted++
            if (outcome.matched_via === 'cart_token') result.matched_cart_token++
            else if (outcome.matched_via === 'email') result.matched_email++
            else if (outcome.matched_via === 'inserted') result.inserted_new++
          }
        } catch (err) {
          result.errors++
          if (result.errors <= 5) log.warn(`[reconcile-shopify-daily] order ${order.id}: ${(err as Error).message}`)
        }
      }

      url = parseNextLink(res.headers.get('link'))
    }

    result.duration_ms = Date.now() - t0
    log.info(
      `[reconcile-shopify-daily] scanned=${result.scanned} upserted=${result.upserted} matched_cart_token=${result.matched_cart_token} matched_email=${result.matched_email} inserted_new=${result.inserted_new} already_completed=${result.already_completed} errors=${result.errors} duration_ms=${result.duration_ms}`,
    )
    return result
  } finally {
    await sql.end({ timeout: 1 })
  }
})
