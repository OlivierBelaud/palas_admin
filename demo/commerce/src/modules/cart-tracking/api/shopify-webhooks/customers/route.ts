// Shopify webhook — `customers/create` + `customers/update` topics.
//
// URL: POST /api/cart-tracking/shopify-webhooks/customers
//
// Real-time capture of every Shopify customer create/update. The HMAC over the
// exact request body is the trust boundary; fetch-back then provides fresh
// canonical customer data before projection.
//
// Shopify retries non-2xx for up to 48h → handler is idempotent
// (upsertShopifyCustomer is, via shopify_customer_id OR email match).

import { type RuntimeApp, resolveSql } from '../../../../../utils/manta-runtime'
import {
  ShopifyAdminTransportError,
  shopifyAdminJson,
} from '../../../../../../vercel-fast-functions/shopify-admin-transport.mjs'
import { verifyShopifyHmac } from '../../../shopify-webhook-hmac'
import { type ShopifyCustomerPayload, upsertShopifyCustomer } from '../../../../contact/upsert-shopify-customer'

export async function OPTIONS(_req: Request): Promise<Response> {
  return new Response(null, { status: 204 })
}

type ShopifyCustomerFetchResult =
  | { status: 'found'; customer: ShopifyCustomerPayload }
  | { status: 'not_found' }
  | { status: 'unavailable'; reason: string }

async function fetchShopifyCustomer(customerId: string | number): Promise<ShopifyCustomerFetchResult> {
  try {
    const { data } = await shopifyAdminJson<{ customer?: ShopifyCustomerPayload }>(
      `customers/${customerId}.json`,
      {},
      { maxAttempts: 1, timeoutMs: 4_000 },
    )
    return data.customer
      ? { status: 'found', customer: data.customer }
      : { status: 'unavailable', reason: 'Shopify response omitted customer' }
  } catch (error) {
    if (error instanceof ShopifyAdminTransportError && error.kind === 'not_found') {
      return { status: 'not_found' }
    }
    return { status: 'unavailable', reason: error instanceof Error ? error.message : String(error) }
  }
}

export async function POST(req: Request): Promise<Response> {
  const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('[shopify-webhook customers] SHOPIFY_WEBHOOK_SECRET missing')
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
    console.warn('[shopify-webhook customers] invalid Shopify HMAC — rejecting')
    return new Response('Unauthorized', { status: 401 })
  }

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

  // Fetch-back verification: real Shopify customer id round-trips with our
  // Admin token. Forges can't fabricate an id that exists.
  const fetched = await fetchShopifyCustomer(postedId)
  if (fetched.status === 'not_found') {
    console.warn(`[shopify-webhook customers] customer ${postedId} not found via Admin API — rejecting`)
    return new Response('Unauthorized', { status: 401 })
  }
  if (fetched.status === 'unavailable') {
    console.error(`[shopify-webhook customers] Shopify unavailable for customer ${postedId}: ${fetched.reason}`)
    return new Response('Shopify Unavailable', { status: 502 })
  }
  const customer = fetched.customer

  const app = (req as Request & { app?: RuntimeApp }).app
  const sql = resolveSql(app)
  if (!sql) {
    console.error('[shopify-webhook customers] IDatabasePort missing')
    return new Response('Server Misconfigured', { status: 500 })
  }
  const email = customer.email?.trim().toLowerCase()
  const emit = app?.emit?.bind(app)
  if (email && !emit) {
    console.error('[shopify-webhook customers] event transport missing')
    return new Response('Event Transport Misconfigured', { status: 500 })
  }
  try {
    const outcome = await upsertShopifyCustomer(sql, customer)
    if (outcome.matched_via === 'identity_conflict') {
      console.error(
        `[shopify-webhook customers] identity conflict for customer=${customer.id} contact_id=${outcome.contact_id ?? 'null'}`,
      )
      return new Response('Identity Conflict', { status: 409 })
    }
    if (email && emit) {
      const results = await Promise.allSettled([
        emit('contact.refresh-requested', {
          email,
          reason: 'shopify_customer_webhook',
          source: 'shopify-webhooks/customers',
          requested_at: new Date().toISOString(),
        }),
        emit('cart.refresh-requested', {
          email,
          reason: 'shopify_customer_webhook',
          source: 'shopify-webhooks/customers',
          requested_at: new Date().toISOString(),
        }),
      ])
      const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failure) throw failure.reason
    }
    console.log(
      `[shopify-webhook customers] customer=${customer.id} matched_via=${outcome.matched_via} contact_id=${outcome.contact_id ?? 'null'} created=${outcome.created} carts_reattached=${outcome.carts_reattached}`,
    )
    return new Response('OK', { status: 200 })
  } catch (err) {
    console.error(
      `[shopify-webhook customers] processing failed for customer ${customer.id}: ${(err as Error).message}`,
    )
    return new Response('Internal Error', { status: 500 })
  }
}
