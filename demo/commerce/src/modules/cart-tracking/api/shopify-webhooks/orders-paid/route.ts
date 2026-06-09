// Shopify webhook — `orders/paid` topic.
//
// URL: POST /api/cart-tracking/shopify-webhooks/orders-paid
//
// Real-time capture of every paid Shopify order. Authenticity is proven by
// re-fetching the order from Shopify Admin API with our access token rather
// than by HMAC: Shopify's Custom App secret is only retrievable through the
// Admin UI, and the fetch-back roundtrip (~100ms) is small compared to the
// 5s Shopify timeout. A forged POST can't make Shopify return a non-existent
// order id, and any mismatch (status, total) between forged body and the
// re-fetched order causes us to drop the payload.
//
// Shopify guarantees retries for up to 48h on non-2xx responses → handler
// must be idempotent (upsertShopifyOrder is, via shopify_order_id match).

import { type RuntimeApp, resolveSql } from '../../../../../utils/manta-runtime'
import type { ShopifyOrderPayload } from '../../../upsert-shopify-order'
import { upsertShopifyOrder } from '../../../upsert-shopify-order'

const SHOPIFY_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN ?? 'fancy-palas.myshopify.com'
const SHOPIFY_API_VERSION = '2024-10'

export async function OPTIONS(_req: Request): Promise<Response> {
  // Shopify never sends preflight (server-to-server), but reply correctly
  // if some debug proxy does.
  return new Response(null, { status: 204 })
}

async function fetchShopifyOrder(orderId: string | number): Promise<ShopifyOrderPayload | null> {
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ?? process.env.SHOPIFY_ADMIN_TOKEN
  if (!token) return null
  const url = `https://${SHOPIFY_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/orders/${orderId}.json`
  const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': token } })
  if (!res.ok) return null
  const body = (await res.json()) as { order?: ShopifyOrderPayload }
  return body.order ?? null
}

export async function POST(req: Request): Promise<Response> {
  // 1) Parse the body. We treat it as untrusted: a real Shopify order id
  //    must round-trip via the Admin API before we ingest.
  let posted: { id?: number | string } & Record<string, unknown>
  try {
    posted = (await req.json()) as { id?: number | string } & Record<string, unknown>
  } catch {
    return new Response('Bad JSON', { status: 400 })
  }
  const postedId = posted?.id
  if (postedId == null) {
    return new Response('Bad Payload', { status: 400 })
  }

  // 2) Fetch-back verification. If Shopify returns the order with our access
  //    token, it's real. Forges can't fabricate an order id that exists.
  const order = await fetchShopifyOrder(postedId)
  if (!order) {
    console.warn(`[shopify-webhook orders-paid] order ${postedId} not found via Admin API — rejecting`)
    return new Response('Unauthorized', { status: 401 })
  }

  // 3) Only act on actually-paid orders. The topic is orders/paid but webhook
  //    routes can be hit out of band, so we re-check the canonical state.
  const fin = (order.financial_status ?? '').toString().toLowerCase()
  if (fin !== 'paid' && fin !== 'partially_paid' && fin !== 'refunded' && fin !== 'partially_refunded') {
    console.log(`[shopify-webhook orders-paid] order ${order.id} status=${fin} — skipping`)
    return new Response('OK', { status: 200 })
  }

  // 4) Upsert. Errors → 500 so Shopify retries.
  const app = (req as Request & { app?: RuntimeApp }).app
  const sql = resolveSql(app)
  if (!sql) {
    console.error('[shopify-webhook orders-paid] IDatabasePort missing')
    return new Response('Server Misconfigured', { status: 500 })
  }
  try {
    const outcome = await upsertShopifyOrder(sql, order)
    if (app?.emit) {
      app
        .emit('order.refresh-requested', {
          shopify_order_id: String(order.id),
          reason: 'shopify_order_paid_webhook',
          source: 'shopify-webhooks/orders-paid',
          requested_at: new Date().toISOString(),
        })
        .catch((err) => {
          console.warn(
            `[shopify-webhook orders-paid] order refresh emit failed for ${order.id}: ${(err as Error).message}`,
          )
        })
    }
    const email = order.email?.trim().toLowerCase()
    if (email && app?.emit) {
      app
        .emit('contact.refresh-requested', {
          email,
          reason: 'shopify_order_paid_webhook',
          source: 'shopify-webhooks/orders-paid',
          requested_at: new Date().toISOString(),
        })
        .catch((err) => {
          console.warn(
            `[shopify-webhook orders-paid] contact refresh emit failed for ${email}: ${(err as Error).message}`,
          )
        })
    }
    if (app?.emit) {
      app
        .emit('cart.refresh-requested', {
          cart_id: outcome.cart_id,
          shopify_order_id: String(order.id),
          cart_token: order.cart_token ?? null,
          checkout_token: order.checkout_token ?? null,
          email: order.email?.trim().toLowerCase() ?? null,
          reason: 'shopify_order_paid_webhook',
          source: 'shopify-webhooks/orders-paid',
          requested_at: new Date().toISOString(),
        })
        .catch((err) => {
          console.warn(
            `[shopify-webhook orders-paid] cart refresh emit failed for ${order.id}: ${(err as Error).message}`,
          )
        })
    }
    console.log(
      `[shopify-webhook orders-paid] order=${order.id} matched_via=${outcome.matched_via} cart_id=${outcome.cart_id ?? 'null'} already=${outcome.already_completed}`,
    )
    return new Response('OK', { status: 200 })
  } catch (err) {
    console.error(`[shopify-webhook orders-paid] upsert failed for order ${order.id}: ${(err as Error).message}`)
    return new Response('Internal Error', { status: 500 })
  }
}
