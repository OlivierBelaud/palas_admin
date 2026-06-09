import { describe, expect, it } from 'vitest'
import { buildRecoveryUrl } from './recovery-url'

describe('buildRecoveryUrl', () => {
  it('uses a cart permalink instead of fabricating checkout recovery URLs', () => {
    expect(
      buildRecoveryUrl(
        {
          checkout_token: 'co_123',
          cart_token: 'cart_123',
          items: [
            { id: 50920212595035, quantity: 1 },
            { id: 48627205046619, quantity: 2 },
          ],
        },
        { discountCode: 'PALAS10-ABC1234' },
      ),
    ).toBe('https://fancypalas.com/cart/50920212595035:1,48627205046619:2?ref=cart_123&discount=PALAS10-ABC1234')
  })

  it('attaches discount code to cart permalinks while preserving ref', () => {
    expect(
      buildRecoveryUrl(
        {
          cart_token: 'cart_123',
          items: [{ id: 123, quantity: 2 }],
        },
        { discountCode: 'PALAS10-ABC1234' },
      ),
    ).toBe('https://fancypalas.com/cart/123:2?ref=cart_123&discount=PALAS10-ABC1234')
  })
})
