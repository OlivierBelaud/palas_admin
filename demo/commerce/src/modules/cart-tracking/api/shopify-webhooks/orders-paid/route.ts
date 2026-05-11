// Shopify webhook — `orders/paid` topic.
//
// URL: POST /api/cart-tracking/shopify-webhooks/orders-paid
//
// Real-time capture of every paid Shopify order, server-to-server. Together
// with the daily reconcile cron + the historical backfill script, this is the
// 100%-guaranteed funnel-completion source. The Web Pixel stays in place for
// the rest of the funnel (cart, checkout_started, …) but no longer needs to
// catch checkout:completed reliably (it plateaus at ~80% client-side due to
// adblock + admin/POS orders with no pixel).
//
// Shopify guarantees:
//   - HMAC-SHA256 signed via SHOPIFY_WEBHOOK_SECRET, base64 in header
//     X-Shopify-Hmac-Sha256
//   - Retries for up to 48h on non-2xx responses → handler must be idempotent
//   - 5s timeout → we return 200 as soon as the upsert is done
//
// On invalid HMAC we return 401 and do NOT log the body (security).
// On any internal error we return 500 to let Shopify retry.

import postgres from 'postgres'
import type { ShopifyOrderPayload } from '../../../upsert-shopify-order'
import { upsertShopifyOrder, verifyShopifyHmac } from '../../../upsert-shopify-order'

// Re-use a single postgres pool across invocations on long-running hosts.
// On Vercel serverless this module is reloaded per cold start anyway, so
// the pool is bounded by max:1.
let sqlSingleton: ReturnType<typeof postgres> | null = null

function getSql(): ReturnType<typeof postgres> | null {
  if (sqlSingleton) return sqlSingleton
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) return null
  const needsSsl = /neon\.tech|amazonaws\.com|render\.com|railway\.app/.test(dbUrl)
  sqlSingleton = postgres(dbUrl, { ssl: needsSsl ? 'require' : undefined, max: 1, prepare: false })
  return sqlSingleton
}

export async function OPTIONS(_req: Request): Promise<Response> {
  // Shopify never sends preflight (server-to-server), but reply correctly
  // if some debug proxy does.
  return new Response(null, { status: 204 })
}

export async function POST(req: Request): Promise<Response> {
  // 1) Read the RAW body BEFORE any parsing — HMAC is computed on the
  //    exact bytes Shopify sent.
  let rawBody: string
  try {
    rawBody = await req.text()
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  // 2) Verify HMAC. Do NOT log the body on failure.
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET
  if (!secret) {
    // Misconfiguration: refuse to silently accept anything. Surface a 500
    // so the operator notices in the Shopify webhook activity log.
    console.error('[shopify-webhook orders-paid] SHOPIFY_WEBHOOK_SECRET not set')
    return new Response('Server Misconfigured', { status: 500 })
  }
  const headerSig = req.headers.get('x-shopify-hmac-sha256')
  if (!verifyShopifyHmac(rawBody, headerSig, secret)) {
    return new Response('Unauthorized', { status: 401 })
  }

  // 3) Parse JSON only after the signature is verified.
  let order: ShopifyOrderPayload
  try {
    order = JSON.parse(rawBody) as ShopifyOrderPayload
  } catch {
    return new Response('Bad JSON', { status: 400 })
  }

  if (!order || order.id == null) {
    return new Response('Bad Payload', { status: 400 })
  }

  // 4) Upsert. Errors → 500 so Shopify retries.
  const sql = getSql()
  if (!sql) {
    console.error('[shopify-webhook orders-paid] DATABASE_URL missing')
    return new Response('Server Misconfigured', { status: 500 })
  }
  try {
    const outcome = await upsertShopifyOrder(sql, order)
    // Lightweight log — keeps the Shopify webhook activity page useful when
    // tailing prod logs. No PII beyond the order id (already Shopify-public).
    console.log(
      `[shopify-webhook orders-paid] order=${order.id} matched_via=${outcome.matched_via} cart_id=${outcome.cart_id ?? 'null'} already=${outcome.already_completed}`,
    )
    return new Response('OK', { status: 200 })
  } catch (err) {
    console.error(`[shopify-webhook orders-paid] upsert failed for order ${order.id}: ${(err as Error).message}`)
    return new Response('Internal Error', { status: 500 })
  }
}
