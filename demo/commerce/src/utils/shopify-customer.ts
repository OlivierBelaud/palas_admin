// Resolve a Shopify customer by email → returns order count + id.
//
// Fail-open: on API failure returns { number_of_orders: 0, customer_id: null }
// and logs a warning. Losing a feature flag (e.g. the cart-drawer "surprise"
// discount grant decision) to a transient Shopify outage is worse UX than
// granting one extra code to a repeat customer.

import { ShopifyAdminClient } from '../modules/shopify-admin/client'

export interface ShopifyCustomerLookup {
  number_of_orders: number
  customer_id: string | null
}

export async function lookupShopifyCustomer(
  email: string,
  log: { warn: (m: string) => void },
): Promise<ShopifyCustomerLookup> {
  try {
    const client = new ShopifyAdminClient()
    const data = await client.query<{
      customers: { edges: Array<{ node: { id: string; numberOfOrders: string | number | null } }> }
    }>(
      `query ($q: String!) {
        customers(first: 1, query: $q) {
          edges { node { id numberOfOrders } }
        }
      }`,
      { q: `email:"${email.replace(/"/g, '\\"')}"` },
    )
    const node = data.customers?.edges?.[0]?.node
    if (!node) return { number_of_orders: 0, customer_id: null }
    const raw = node.numberOfOrders
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : 0
    return { number_of_orders: Number.isFinite(n) ? n : 0, customer_id: node.id }
  } catch (err) {
    log.warn(`[shopify-customer] lookup failed for ${email}: ${(err as Error).message}`)
    return { number_of_orders: 0, customer_id: null }
  }
}
