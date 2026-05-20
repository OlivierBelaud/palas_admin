import { ShopifyAdminClient } from '../shopify-admin/client'

export interface OrderSnapshot {
  shopify_order_id: string
  shopify_customer_id: string | null
  email: string | null
  order_number: string | null
  status: 'pending' | 'paid' | 'fulfilled' | 'cancelled' | 'refunded'
  financial_status: string | null
  fulfillment_status: string | null
  total_price: number
  currency: string
  items: Array<Record<string, unknown>>
  placed_at: Date | null
  cancelled_at: Date | null
  shopify_synced_at: Date
}

type ShopifyOrderNode = {
  id: string
  name: string | null
  email: string | null
  displayFinancialStatus: string | null
  displayFulfillmentStatus: string | null
  cancelledAt: string | null
  createdAt: string | null
  currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } } | null
  customer: { id: string | null; email: string | null } | null
  lineItems: {
    edges: Array<{
      node: {
        id: string
        title: string | null
        quantity: number | null
        sku: string | null
        variantTitle: string | null
        variant: { id: string; title: string | null; product: { id: string } | null } | null
        originalUnitPriceSet: { shopMoney: { amount: string } } | null
        discountedTotalSet: { shopMoney: { amount: string } } | null
      }
    }>
  }
}

export function normalizeShopifyOrderId(raw: string | number): string {
  const value = String(raw).trim()
  const match = value.match(/(\d+)$/)
  return match ? match[1] : value
}

export function mapShopifyOrderNodeToSnapshot(node: ShopifyOrderNode, syncedAt = new Date()): OrderSnapshot {
  const orderId = normalizeShopifyOrderId(node.id)
  const email = ((node.email ?? node.customer?.email ?? '').trim() || null)?.toLowerCase() ?? null
  const cancelledAt = toDate(node.cancelledAt)
  const financial = node.displayFinancialStatus
  const fulfillment = node.displayFulfillmentStatus
  const total = node.currentTotalPriceSet?.shopMoney

  return {
    shopify_order_id: orderId,
    shopify_customer_id: node.customer?.id ? normalizeShopifyOrderId(node.customer.id) : null,
    email,
    order_number: node.name,
    status: deriveOrderStatus({ cancelledAt, financial, fulfillment }),
    financial_status: financial,
    fulfillment_status: fulfillment,
    total_price: toNumber(total?.amount, 0),
    currency: total?.currencyCode ?? 'EUR',
    items: node.lineItems.edges.map((edge) => mapLineItem(edge.node)),
    placed_at: toDate(node.createdAt),
    cancelled_at: cancelledAt,
    shopify_synced_at: syncedAt,
  }
}

export async function fetchShopifyOrderSnapshot(shopifyOrderId: string | number): Promise<OrderSnapshot | null> {
  const id = normalizeShopifyOrderId(shopifyOrderId)
  const client = new ShopifyAdminClient({ domain: process.env.SHOPIFY_SHOP_DOMAIN ?? 'fancy-palas.myshopify.com' })
  const data = await client.query<{
    node: ShopifyOrderNode | null
  }>(
    `query Order($id: ID!) {
      node(id: $id) {
        ... on Order {
          id
          name
          email
          displayFinancialStatus
          displayFulfillmentStatus
          cancelledAt
          createdAt
          currentTotalPriceSet { shopMoney { amount currencyCode } }
          customer { id email }
          lineItems(first: 100) {
            edges {
              node {
                id
                title
                quantity
                sku
                variantTitle
                variant { id title product { id } }
                originalUnitPriceSet { shopMoney { amount } }
                discountedTotalSet { shopMoney { amount } }
              }
            }
          }
        }
      }
    }`,
    { id: `gid://shopify/Order/${id}` },
  )
  if (!data.node) return null
  return mapShopifyOrderNodeToSnapshot(data.node)
}

function mapLineItem(item: ShopifyOrderNode['lineItems']['edges'][number]['node']): Record<string, unknown> {
  const quantity = typeof item.quantity === 'number' && Number.isFinite(item.quantity) ? item.quantity : 1
  const unitPrice = toNumber(item.originalUnitPriceSet?.shopMoney.amount, 0)
  const linePrice = toNumber(item.discountedTotalSet?.shopMoney.amount, unitPrice * quantity)
  return {
    id: item.variant?.id ? normalizeShopifyOrderId(item.variant.id) : normalizeShopifyOrderId(item.id),
    product_id: item.variant?.product?.id ? normalizeShopifyOrderId(item.variant.product.id) : '',
    sku: item.sku ?? '',
    title: item.title ?? '',
    variant_title: item.variantTitle ?? item.variant?.title ?? '',
    quantity,
    price: unitPrice,
    line_price: linePrice,
    image_url: null,
    url: null,
  }
}

function deriveOrderStatus(args: {
  cancelledAt: Date | null
  financial: string | null
  fulfillment: string | null
}): OrderSnapshot['status'] {
  if (args.cancelledAt) return 'cancelled'
  const financial = (args.financial ?? '').toUpperCase()
  const fulfillment = (args.fulfillment ?? '').toUpperCase()
  if (financial === 'REFUNDED') return 'refunded'
  if (fulfillment === 'FULFILLED') return 'fulfilled'
  if (financial === 'PAID' || financial === 'PARTIALLY_PAID' || financial === 'PARTIALLY_REFUNDED') return 'paid'
  return 'pending'
}

function toDate(value: unknown): Date | null {
  if (!value || typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}
