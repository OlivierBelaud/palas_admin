// Shopify webhook — `orders/paid` topic.
//
// URL: POST /api/cart-tracking/shopify-webhooks/orders-paid
//
// Real-time capture of every paid Shopify order. The HMAC over the exact
// request body is the trust boundary; fetch-back then provides fresh canonical
// order data before projection.
//
// Shopify guarantees retries for up to 48h on non-2xx responses → handler
// must be idempotent (upsertShopifyOrder is, via shopify_order_id match).

import { type RuntimeApp, resolveSql } from '../../../../../utils/manta-runtime'
import { verifyShopifyHmac } from '../../../shopify-webhook-hmac'
import type { ShopifyOrderPayload } from '../../../upsert-shopify-order'
import { upsertShopifyOrder } from '../../../upsert-shopify-order'

const SHOPIFY_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN ?? 'fancy-palas.myshopify.com'
const SHOPIFY_API_VERSION = '2024-10'
const SHOPIFY_FETCH_TIMEOUT_MS = 10_000

export async function OPTIONS(_req: Request): Promise<Response> {
  // Shopify never sends preflight (server-to-server), but reply correctly
  // if some debug proxy does.
  return new Response(null, { status: 204 })
}

type ShopifyOrderFetchResult =
  | { status: 'found'; order: ShopifyOrderPayload }
  | { status: 'not_found' }
  | { status: 'unavailable'; reason: string }

async function fetchShopifyOrder(orderId: string | number): Promise<ShopifyOrderFetchResult> {
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ?? process.env.SHOPIFY_ADMIN_TOKEN
  if (!token) return { status: 'unavailable', reason: 'Shopify Admin token missing' }
  const url = `https://${SHOPIFY_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/orders/${orderId}.json`
  try {
    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': token },
      signal: AbortSignal.timeout(SHOPIFY_FETCH_TIMEOUT_MS),
    })
    if (res.status === 404) return { status: 'not_found' }
    if (!res.ok) return { status: 'unavailable', reason: `Shopify HTTP ${res.status}` }
    const body = (await res.json()) as { order?: ShopifyOrderPayload }
    return body.order
      ? { status: 'found', order: body.order }
      : { status: 'unavailable', reason: 'Shopify response omitted order' }
  } catch (err) {
    return {
      status: 'unavailable',
      reason: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function POST(req: Request): Promise<Response> {
  const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('[shopify-webhook orders-paid] SHOPIFY_WEBHOOK_SECRET missing')
    return new Response('Webhook Secret Misconfigured', { status: 500 })
  }

  let rawBody: string
  try {
    rawBody = await req.text()
  } catch {
    return new Response('Bad Request', { status: 400 })
  }
  const signature = req.headers.get('x-shopify-hmac-sha256')
  if (!verifyShopifyHmac(rawBody, signature, webhookSecret)) {
    console.warn('[shopify-webhook orders-paid] invalid Shopify HMAC — rejecting')
    return new Response('Unauthorized', { status: 401 })
  }

  // 1) Parse only after authenticating the exact bytes Shopify signed.
  let posted: { id?: number | string } & Record<string, unknown>
  try {
    posted = JSON.parse(rawBody) as { id?: number | string } & Record<string, unknown>
  } catch {
    return new Response('Bad JSON', { status: 400 })
  }
  const postedId = posted?.id
  if (postedId == null) {
    return new Response('Bad Payload', { status: 400 })
  }

  // 2) Fetch-back verification. If Shopify returns the order with our access
  //    token, it's real. Forges can't fabricate an order id that exists.
  const fetched = await fetchShopifyOrder(postedId)
  if (fetched.status === 'not_found') {
    console.warn(`[shopify-webhook orders-paid] order ${postedId} not found via Admin API — rejecting`)
    return new Response('Unauthorized', { status: 401 })
  }
  if (fetched.status === 'unavailable') {
    console.error(`[shopify-webhook orders-paid] Shopify unavailable for order ${postedId}: ${fetched.reason}`)
    return new Response('Shopify Unavailable', { status: 502 })
  }
  const order = fetched.order

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
  if (!app?.emit) {
    console.error('[shopify-webhook orders-paid] event transport missing')
    return new Response('Event Transport Misconfigured', { status: 500 })
  }
  try {
    const outcome = await upsertShopifyOrder(sql, order)
    await app.emit('order.refresh-requested', {
      shopify_order_id: String(order.id),
      reason: 'shopify_order_paid_webhook',
      source: 'shopify-webhooks/orders-paid',
      requested_at: new Date().toISOString(),
    })
    const email = order.email?.trim().toLowerCase()
    if (email) {
      await app.emit('contact.refresh-requested', {
        email,
        reason: 'shopify_order_paid_webhook',
        source: 'shopify-webhooks/orders-paid',
        requested_at: new Date().toISOString(),
      })
    }
    await app.emit('cart.refresh-requested', {
      cart_id: outcome.cart_id,
      shopify_order_id: String(order.id),
      cart_token: order.cart_token ?? null,
      checkout_token: order.checkout_token ?? null,
      email: order.email?.trim().toLowerCase() ?? null,
      reason: 'shopify_order_paid_webhook',
      source: 'shopify-webhooks/orders-paid',
      requested_at: new Date().toISOString(),
    })
    console.log(
      `[shopify-webhook orders-paid] order=${order.id} matched_via=${outcome.matched_via} cart_id=${outcome.cart_id ?? 'null'} already=${outcome.already_completed}`,
    )
    return new Response('OK', { status: 200 })
  } catch (err) {
    console.error(`[shopify-webhook orders-paid] projection failed for order ${order.id}: ${(err as Error).message}`)
    return new Response('Internal Error', { status: 500 })
  }
}
