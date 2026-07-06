import { describe, expect, it } from 'vitest'
import {
  type PalasCartMarketingCart,
  type PalasCartMarketingRule,
  resolvePalasCartMarketing,
} from './palas-cart-marketing'

const baseCart: PalasCartMarketingCart = {
  id: 'cart_1',
  subtotal: 160,
  currencyCode: 'EUR',
  discountCodes: [{ code: 'PUBLIC10', applicable: true }],
  lines: [
    {
      id: 'line_1',
      merchandiseId: 'gid://shopify/ProductVariant/paid_1',
      title: 'Bracelet Sol',
      variantTitle: null,
      quantity: 2,
      price: 80,
      attributes: [],
    },
  ],
}

function rule(overrides: Partial<PalasCartMarketingRule>): PalasCartMarketingRule {
  return {
    id: 'rule_1',
    title: 'Rule',
    rule_type: 'gift_threshold',
    status: 'active',
    starts_at: '2026-01-01T00:00:00.000Z',
    ends_at: null,
    execution_kind: 'local_cart_rule',
    market_key: null,
    currency_code: 'EUR',
    value_type: null,
    value: null,
    code: null,
    threshold: null,
    gift_product_id: null,
    gift_title: null,
    paid_rate: null,
    payload: null,
    ...overrides,
  }
}

describe('resolvePalasCartMarketing', () => {
  it('resolves local personal, shipping, and gift rules for a Storefront cart', () => {
    const result = resolvePalasCartMarketing({
      cart: baseCart,
      market: 'fr',
      now: '2026-07-06T12:00:00.000Z',
      selectedPersonalOffers: ['welcome'],
      rules: [
        rule({
          id: 'welcome_10',
          title: 'Offre de bienvenue',
          rule_type: 'first_order_discount',
          value_type: 'percentage',
          value: 10,
          payload: { personal_offer: 'welcome' },
        }),
        rule({
          id: 'shipping_fr',
          title: 'Livraison France',
          rule_type: 'shipping_threshold',
          execution_kind: 'shipping_profile',
          market_key: 'fr',
          threshold: 70,
          paid_rate: 6,
        }),
        rule({
          id: 'gift_150',
          title: 'Charm offert',
          rule_type: 'gift_threshold',
          market_key: 'fr',
          threshold: 150,
          gift_product_id: 'gid://shopify/ProductVariant/gift_1',
          gift_title: 'Charm mystere',
        }),
      ],
    })

    expect(result.experience.discountTotal).toBe(16)
    expect(result.experience.gifts).toEqual([
      {
        productId: 'gid://shopify/ProductVariant/gift_1',
        quantity: 1,
        sourceRuleId: 'gift_150',
        title: 'Charm mystere',
      },
    ])
    expect(result.benefits.reached.map((benefit) => benefit.id)).toEqual(['shipping_fr', 'gift_150'])
    expect(result.cartPlan.linesToAdd).toEqual([
      {
        merchandiseId: 'gid://shopify/ProductVariant/gift_1',
        quantity: 1,
        attributes: [
          { key: '_free_gift_rule_id', value: 'gift_150' },
          { key: '_free_gift_title', value: 'Charm mystere' },
        ],
      },
    ])
  })

  it('does not propose a duplicate gift line when the cart already contains the gift marker', () => {
    const result = resolvePalasCartMarketing({
      cart: {
        ...baseCart,
        lines: [
          ...baseCart.lines,
          {
            id: 'line_gift',
            merchandiseId: 'gid://shopify/ProductVariant/gift_1',
            title: 'Charm mystere',
            variantTitle: null,
            quantity: 1,
            price: 0,
            attributes: [{ key: '_free_gift_rule_id', value: 'gift_150' }],
          },
        ],
      },
      market: 'fr',
      now: '2026-07-06T12:00:00.000Z',
      rules: [
        rule({
          id: 'gift_150',
          title: 'Charm offert',
          rule_type: 'gift_threshold',
          market_key: 'fr',
          threshold: 150,
          gift_product_id: 'gid://shopify/ProductVariant/gift_1',
          gift_title: 'Charm mystere',
        }),
      ],
    })

    expect(result.experience.gifts).toHaveLength(1)
    expect(result.cartPlan.linesToAdd).toEqual([])
  })
})
