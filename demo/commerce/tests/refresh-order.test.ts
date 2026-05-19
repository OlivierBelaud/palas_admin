import { describe, expect, it } from 'vitest'
import { mapShopifyOrderNodeToSnapshot, normalizeShopifyOrderId } from '../src/modules/order/refresh-order'

describe('normalizeShopifyOrderId', () => {
  it('extracts the numeric id from a Shopify gid', () => {
    expect(normalizeShopifyOrderId('gid://shopify/Order/123456')).toBe('123456')
  })
})

describe('mapShopifyOrderNodeToSnapshot', () => {
  it('maps Shopify order and line items into the local snapshot shape', () => {
    const snapshot = mapShopifyOrderNodeToSnapshot(
      {
        id: 'gid://shopify/Order/123456',
        name: '#1042',
        email: ' Jane@Example.COM ',
        displayFinancialStatus: 'PAID',
        displayFulfillmentStatus: 'FULFILLED',
        cancelledAt: null,
        createdAt: '2026-05-19T10:00:00Z',
        currentTotalPriceSet: { shopMoney: { amount: '42.50', currencyCode: 'EUR' } },
        customer: { email: null },
        lineItems: {
          edges: [
            {
              node: {
                id: 'gid://shopify/LineItem/555',
                title: 'Bracelet',
                quantity: 2,
                sku: 'BR-1',
                variantTitle: 'Gold',
                variant: {
                  id: 'gid://shopify/ProductVariant/789',
                  title: 'Gold',
                  product: { id: 'gid://shopify/Product/456' },
                },
                originalUnitPriceSet: { shopMoney: { amount: '20.00' } },
                discountedTotalSet: { shopMoney: { amount: '40.00' } },
              },
            },
          ],
        },
      },
      new Date('2026-05-19T11:00:00Z'),
    )

    expect(snapshot.shopify_order_id).toBe('123456')
    expect(snapshot.email).toBe('jane@example.com')
    expect(snapshot.status).toBe('fulfilled')
    expect(snapshot.total_price).toBe(42.5)
    expect(snapshot.items).toEqual([
      expect.objectContaining({
        id: '789',
        product_id: '456',
        sku: 'BR-1',
        title: 'Bracelet',
        quantity: 2,
        price: 20,
        line_price: 40,
      }),
    ])
  })
})
