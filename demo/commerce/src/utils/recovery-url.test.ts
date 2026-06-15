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

  it('adds CRM email tracking params after cart and discount params', () => {
    const url = buildRecoveryUrl(
      {
        cart_token: 'cart_123',
        items: [{ id: 123, quantity: 2 }],
      },
      {
        discountCode: 'PALAS10-ABC1234',
        trackingParams: {
          utm_source: 'palas_crm',
          utm_medium: 'email',
          utm_campaign: 'abandoned_cart',
          utm_content: 'abandoned_cart_2',
          utm_id: 'acm_123',
          palas_email_sequence_version: 2,
          palas_email_sequence_step: 2,
        },
      },
    )

    const parsed = new URL(url)
    expect(parsed.pathname).toBe('/cart/123:2')
    expect(parsed.searchParams.get('ref')).toBe('cart_123')
    expect(parsed.searchParams.get('discount')).toBe('PALAS10-ABC1234')
    expect(parsed.searchParams.get('utm_source')).toBe('palas_crm')
    expect(parsed.searchParams.get('utm_medium')).toBe('email')
    expect(parsed.searchParams.get('utm_campaign')).toBe('abandoned_cart')
    expect(parsed.searchParams.get('utm_content')).toBe('abandoned_cart_2')
    expect(parsed.searchParams.get('utm_id')).toBe('acm_123')
    expect(parsed.searchParams.get('palas_email_sequence_version')).toBe('2')
    expect(parsed.searchParams.get('palas_email_sequence_step')).toBe('2')
  })
})
