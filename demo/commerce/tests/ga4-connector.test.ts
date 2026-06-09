import { describe, expect, it } from 'vitest'
import { gaClientIdFromCookie, mapCanonicalToGa4 } from '../src/modules/event-hub/ga4-connector'

describe('GA4 connector mapping', () => {
  it('extracts GA4 client_id from the _ga cookie value', () => {
    expect(gaClientIdFromCookie('GA1.1.123456789.987654321')).toBe('123456789.987654321')
    expect(gaClientIdFromCookie('123456789.987654321')).toBe('123456789.987654321')
    expect(gaClientIdFromCookie('bad-cookie')).toBeNull()
  })

  it('marks events invalid when client_id is missing', () => {
    const mapped = mapCanonicalToGa4('add_to_cart', {
      user: {},
      context: { url: 'https://fancypalas.com/products/bague' },
      ecommerce: {
        currency: 'EUR',
        value: 120,
        items: [{ item_id: 'v1', item_name: 'Bague', price: 120, quantity: 1 }],
      },
    })

    expect(mapped.ok).toBe(false)
    expect(mapped.errors).toContain('ga4_client_id_missing')
  })

  it('maps purchase payloads to GA4 Measurement Protocol shape', () => {
    const mapped = mapCanonicalToGa4('purchase', {
      user: {
        ga_client_id: '123456789.987654321',
        contact_id: 'contact_1',
        email_sha256: 'a'.repeat(64),
        identity_source: 'event_email',
      },
      context: {
        url: 'https://fancypalas.com/checkouts/cn/thank-you',
        referrer: 'https://fancypalas.com/cart',
        utm: { source: 'google', medium: 'cpc', campaign: 'brand' },
      },
      ecommerce: {
        currency: 'EUR',
        value: 150,
        transaction_id: 'order_1',
        shipping: 5,
        tax: 20,
        items: [{ item_id: 'v1', item_name: 'Bague', item_variant: 'Or', price: 125, quantity: 1 }],
      },
      checkout: { shopify_order_id: 'order_1' },
    })

    expect(mapped.ok).toBe(true)
    expect(mapped.payload).toMatchObject({
      client_id: '123456789.987654321',
      user_id: 'contact_1',
      events: [
        {
          name: 'purchase',
          params: {
            page_location: 'https://fancypalas.com/checkouts/cn/thank-you',
            transaction_id: 'order_1',
            currency: 'EUR',
            value: 150,
            items: [{ item_id: 'v1', item_name: 'Bague', item_variant: 'Or', price: 125, quantity: 1 }],
          },
        },
      ],
    })
  })
})
