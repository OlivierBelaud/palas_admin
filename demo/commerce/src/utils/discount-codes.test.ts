import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createShopifyAbandonedCartDiscount,
  findWelcomeCouponInProperties,
  resolveAbandonedCartDiscountForEmail,
} from './discount-codes'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('findWelcomeCouponInProperties', () => {
  it('returns a coupon from common Klaviyo welcome property names', () => {
    expect(findWelcomeCouponInProperties({ welcome_coupon_code: 'PALAS10-ABC1234' })).toBe('PALAS10-ABC1234')
    expect(findWelcomeCouponInProperties({ 'Welcome Coupon Code': 'WELCOME-XYZ' })).toBe('WELCOME-XYZ')
    expect(findWelcomeCouponInProperties({ discount_code: 'SURPRISE10' })).toBe('SURPRISE10')
  })

  it('ignores invalid coupon-looking values', () => {
    expect(findWelcomeCouponInProperties({ welcome_coupon_code: '' })).toBeNull()
    expect(findWelcomeCouponInProperties({ welcome_coupon_code: 'https://example.com' })).toBeNull()
    expect(findWelcomeCouponInProperties({ welcome_coupon_code: 'x' })).toBeNull()
  })
})

describe('returning-customer abandoned-cart discount', () => {
  it('creates a PANIER10 code restricted to the matching Shopify customer', async () => {
    vi.stubEnv('SHOPIFY_ADMIN_ACCESS_TOKEN', 'test_token')
    vi.stubEnv('SHOPIFY_SHOP_DOMAIN', 'fancy-palas.myshopify.com')
    vi.stubEnv('ABANDONED_CART_RECOVERY_DISCOUNT_PREFIX', 'PANIER10')
    const requests: Array<{ query: string; variables?: Record<string, unknown> }> = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          query: string
          variables?: Record<string, unknown>
        }
        requests.push(body)
        if (body.query.includes('CodeDiscountByCode')) {
          return {
            ok: true,
            json: async () => ({ data: { codeDiscountNodeByCode: null } }),
          }
        }
        return {
          ok: true,
          json: async () => ({
            data: {
              discountCodeBasicCreate: {
                codeDiscountNode: {
                  id: 'gid://shopify/DiscountCodeNode/recovery',
                  codeDiscount: { codes: { nodes: [{ code: 'PANIER10-TEST123' }] } },
                },
                userErrors: [],
              },
            },
          }),
        }
      }),
    )

    const result = await createShopifyAbandonedCartDiscount(
      'client@example.com',
      'gid://shopify/Customer/123',
      'cart-token-123',
    )
    const createRequest = requests.find((request) => request.query.includes('CreateAbandonedCartDiscount'))
    const input = createRequest?.variables?.basicCodeDiscount as Record<string, unknown>

    expect(result).toEqual({
      code: 'PANIER10-TEST123',
      id: 'gid://shopify/DiscountCodeNode/recovery',
    })
    expect(input.code).toMatch(/^PANIER10-[A-Z0-9]{7}$/)
    expect(input.customerSelection).toEqual({
      customers: { add: ['gid://shopify/Customer/123'] },
    })
    expect(input.customerGets).toEqual({
      value: { percentage: 0.1 },
      items: { all: true },
    })
    expect(input.usageLimit).toBe(1)
    expect(input.appliesOncePerCustomer).toBe(true)
  })

  it('refuses a recovery discount when Shopify does not confirm a prior order', async () => {
    vi.stubEnv('SHOPIFY_ADMIN_ACCESS_TOKEN', 'test_token')
    vi.stubEnv('SHOPIFY_SHOP_DOMAIN', 'fancy-palas.myshopify.com')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: {
            customers: {
              edges: [{ node: { id: 'gid://shopify/Customer/123', numberOfOrders: '0' } }],
            },
          },
        }),
      })),
    )

    const grant = await resolveAbandonedCartDiscountForEmail({
      email: 'client@example.com',
      numberOfOrders: 2,
      log: { warn: () => {} },
    })

    expect(grant).toBeNull()
  })
})
