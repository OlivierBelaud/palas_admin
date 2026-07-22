// Shopify webhook — `customers/create` + `customers/update` topics.
//
// URL: POST /api/cart-tracking/shopify-webhooks/customers
//
// Real-time capture of every Shopify customer create/update. Same fetch-back
// authenticity model as orders-paid: the inbound POST is untrusted; we
// re-fetch the customer via Admin REST and reject if Shopify doesn't confirm
// the id exists. A forged POST can't fabricate a real customer id.
//
// Shopify retries non-2xx for up to 48h → handler is idempotent
// (upsertShopifyCustomer is, via shopify_customer_id OR email match).

import { type RuntimeApp, resolveSql } from '../../../../../utils/manta-runtime'
import { type ShopifyCustomerPayload, upsertShopifyCustomer } from '../../../../contact/upsert-shopify-customer'

const SHOPIFY_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN ?? 'fancy-palas.myshopify.com'
const SHOPIFY_API_VERSION = '2024-10'

export async function OPTIONS(_req: Request): Promise<Response> {
  return new Response(null, { status: 204 })
}

async function fetchShopifyCustomer(customerId: string | number): Promise<ShopifyCustomerPayload | null> {
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ?? process.env.SHOPIFY_ADMIN_TOKEN
  if (!token) return null
  const url = `https://${SHOPIFY_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/customers/${customerId}.json`
  const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': token } })
  if (!res.ok) return null
  const body = (await res.json()) as { customer?: ShopifyCustomerPayload }
  return body.customer ?? null
}

export async function POST(req: Request): Promise<Response> {
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

  // Fetch-back verification: real Shopify customer id round-trips with our
  // Admin token. Forges can't fabricate an id that exists.
  const customer = await fetchShopifyCustomer(postedId)
  if (!customer) {
    console.warn(`[shopify-webhook customers] customer ${postedId} not found via Admin API — rejecting`)
    return new Response('Unauthorized', { status: 401 })
  }

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
    console.error(`[shopify-webhook customers] processing failed for customer ${customer.id}: ${(err as Error).message}`)
    return new Response('Internal Error', { status: 500 })
  }
}
