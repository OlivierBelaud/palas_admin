// Unit tests — posthog-adapter helpers.
// These are the pure functions behind the posthog-cart-tracker subscriber.
// We test them in isolation (no framework globals) via the adapter module.
//
// Coverage matrix:
// - v2 unified schema (current) — everything nested under properties.cart / properties.checkout
// - v1 legacy schema (backwards compat) — fields at root of properties
// - Mixed payloads — checkout events carry BOTH cart + checkout under properties

import { describe, expect, it } from 'vitest'
import { extractPosthogEvents, normalizeCartEvent, toIngestInput } from '../src/modules/cart-tracking/posthog-adapter'

describe('extractPosthogEvents', () => {
  it('returns [] for empty body', () => {
    expect(extractPosthogEvents(null)).toEqual([])
    expect(extractPosthogEvents(undefined)).toEqual([])
  })

  it('wraps a single event object in an array', () => {
    const evt = { event: 'cart:viewed', properties: { cart: { token: 'abc' } } }
    expect(extractPosthogEvents(evt)).toEqual([evt])
  })

  it('returns arrays as-is', () => {
    const events = [{ event: 'cart:viewed' }, { event: 'cart:updated' }]
    expect(extractPosthogEvents(events)).toEqual(events)
  })

  it('unwraps the `batch` property', () => {
    const batch = [{ event: 'cart:viewed' }, { event: 'cart:updated' }]
    expect(extractPosthogEvents({ batch })).toEqual(batch)
  })
})

describe('normalizeCartEvent — v2 unified schema (current)', () => {
  it('reads cart.token from properties.cart', () => {
    const n = normalizeCartEvent({
      event: 'cart:product_added',
      properties: { cart: { token: 'cart-abc', items: [], total_price: 0, currency: 'EUR' } },
    })
    expect(n?.cart_token).toBe('cart-abc')
  })

  it('reads items/total_price/currency from properties.cart', () => {
    const items = [{ id: '1', product_id: 'p1', title: 'Shoe', quantity: 2, price: 50 }]
    const n = normalizeCartEvent({
      event: 'cart:product_added',
      properties: { cart: { token: 't', items, total_price: 100, currency: 'USD' } },
    })
    expect(n?.items).toEqual(items)
    expect(n?.total_price).toBe(100)
    expect(n?.currency).toBe('USD')
    expect(n?.item_count).toBe(1)
    expect(n?.cart_has_payload).toBe(true)
  })

  it('extracts cart-level discounts (total_discount + cart_level_discounts)', () => {
    const n = normalizeCartEvent({
      event: 'cart:discount_applied',
      properties: {
        cart: {
          token: 't',
          items: [],
          total_price: 100,
          currency: 'EUR',
          total_discount: 15,
          cart_level_discounts: [{ title: 'SUMMER20', amount: 15 }],
        },
        discount_code: 'SUMMER20',
      },
    })
    expect(n?.total_discount).toBe(15)
    expect(n?.cart_level_discounts).toEqual([{ title: 'SUMMER20', amount: 15 }])
    expect(n?.discount_code).toBe('SUMMER20')
  })

  it('reads checkout fields from properties.checkout on checkout events', () => {
    const n = normalizeCartEvent({
      event: 'checkout:completed',
      properties: {
        cart: { token: 't', items: [], total_price: 100, currency: 'EUR' },
        checkout: {
          token: 'chk-123',
          total_price: 120,
          currency: 'EUR',
          email: 'buyer@example.com',
          shopify_order_id: 'order_42',
          shopify_customer_id: '999',
          is_first_order: true,
          shipping_method: 'Standard',
          shipping_price: 8,
          discounts_amount: 10,
          discounts: [{ title: 'SUMMER20', type: 'DISCOUNT_CODE', value: 10 }],
          total_tax: 4,
          items: [],
        },
      },
    })
    expect(n?.checkout_token).toBe('chk-123')
    expect(n?.shopify_order_id).toBe('order_42')
    expect(n?.shopify_customer_id).toBe('999')
    expect(n?.is_first_order).toBe(true)
    expect(n?.shipping_method).toBe('Standard')
    expect(n?.shipping_price).toBe(8)
    expect(n?.discounts_amount).toBe(10)
    expect(n?.total_tax).toBe(4)
    expect(n?.email).toBe('buyer@example.com')
  })

  it('prefers checkout.total_price over cart.total_price on checkout events', () => {
    // checkout total includes shipping + taxes, so it's the right number to
    // show as "what the customer paid / will pay".
    const n = normalizeCartEvent({
      event: 'checkout:completed',
      properties: {
        cart: { token: 't', items: [], total_price: 100, currency: 'EUR' },
        checkout: { token: 'c', total_price: 128, currency: 'EUR', items: [] },
      },
    })
    expect(n?.total_price).toBe(128)
  })

  it('prefers cart.items over checkout.items (cart items are richer)', () => {
    const cartItems = [{ id: '1', product_id: 'p1', title: 'Rich', quantity: 1, price: 50, image_url: '/x.jpg' }]
    const checkoutItems = [{ id: '1', product_id: 'p1', title: 'Sparse', quantity: 1, price: 50 }]
    const n = normalizeCartEvent({
      event: 'checkout:completed',
      properties: {
        cart: { token: 't', items: cartItems, total_price: 50, currency: 'EUR' },
        checkout: { token: 'c', total_price: 50, currency: 'EUR', items: checkoutItems },
      },
    })
    expect(n?.items).toEqual(cartItems)
  })
})

describe('normalizeCartEvent — v1 legacy schema (backwards compat)', () => {
  // These tests exercise the @legacy-schema-v1 fallback paths. Remove when
  // we drop v1 support (see BACKLOG.md).

  it('falls back to properties.cart_token at root', () => {
    const n = normalizeCartEvent({
      event: 'cart:viewed',
      properties: { cart_token: 'legacy-root' },
    })
    expect(n?.cart_token).toBe('legacy-root')
  })

  it('falls back to nested cart.cart_token (intermediate format)', () => {
    const n = normalizeCartEvent({
      event: 'cart:viewed',
      properties: { cart: { cart_token: 'intermediate' } },
    })
    expect(n?.cart_token).toBe('intermediate')
  })

  it('falls back to root-level items/total_price/currency', () => {
    const items = [{ id: '1', product_id: 'p1', title: 'X', quantity: 1, price: 50 }]
    const n = normalizeCartEvent({
      event: 'cart:product_added',
      properties: { cart_token: 't', items, total_price: 50, currency: 'USD' },
    })
    expect(n?.items).toEqual(items)
    expect(n?.total_price).toBe(50)
    expect(n?.currency).toBe('USD')
  })

  it('falls back to root-level checkout fields', () => {
    const n = normalizeCartEvent({
      event: 'checkout:completed',
      properties: {
        cart_token: 't',
        shopify_order_id: 'legacy-order',
        shopify_customer_id: 42,
        is_first_order: false,
        shipping_method: 'Express',
        shipping_price: 10,
        discounts_amount: 5,
        total_tax: 2,
      },
    })
    expect(n?.shopify_order_id).toBe('legacy-order')
    expect(n?.shopify_customer_id).toBe('42')
    expect(n?.is_first_order).toBe(false)
    expect(n?.shipping_method).toBe('Express')
    expect(n?.shipping_price).toBe(10)
    expect(n?.discounts_amount).toBe(5)
    expect(n?.total_tax).toBe(2)
  })

  it('prioritizes v2 paths over v1 when both are present', () => {
    // Defensive: if an event somehow has both, v2 wins.
    const n = normalizeCartEvent({
      event: 'checkout:completed',
      properties: {
        cart: { token: 'v2', items: [], total_price: 100, currency: 'EUR' },
        checkout: { token: 'chk', total_price: 120, currency: 'EUR', shopify_order_id: 'v2-order', items: [] },
        // v1 legacy — should be ignored
        cart_token: 'v1',
        total_price: 999,
        shopify_order_id: 'v1-order',
      },
    })
    expect(n?.cart_token).toBe('v2')
    expect(n?.total_price).toBe(120)
    expect(n?.shopify_order_id).toBe('v2-order')
  })
})

describe('normalizeCartEvent — identity + filtering', () => {
  it('returns null for non-cart events', () => {
    expect(normalizeCartEvent({ event: '$pageview', properties: { cart: { token: 'x' } } })).toBeNull()
    expect(normalizeCartEvent({ event: 'unknown:event', properties: { cart: { token: 'x' } } })).toBeNull()
  })

  it('returns null when cart_token is missing', () => {
    expect(normalizeCartEvent({ event: 'cart:viewed', properties: {} })).toBeNull()
    expect(normalizeCartEvent({ event: 'cart:viewed', properties: { cart: {} } })).toBeNull()
  })

  it('extracts identity from $set', () => {
    const n = normalizeCartEvent({
      event: 'checkout:contact_info_submitted',
      distinct_id: 'd1',
      properties: {
        cart: { token: 't' },
        checkout: { token: 'c', email: null, items: [] },
        $set: { email: 'a@b.com', first_name: 'Jane', last_name: 'Doe', phone: '+123', city: 'Paris', country: 'FR' },
      },
    })
    expect(n?.email).toBe('a@b.com')
    expect(n?.first_name).toBe('Jane')
    expect(n?.last_name).toBe('Doe')
    expect(n?.phone).toBe('+123')
    expect(n?.city).toBe('Paris')
    expect(n?.country_code).toBe('FR')
    expect(n?.distinct_id).toBe('d1')
  })

  it('falls back to checkout.email when $set.email is absent', () => {
    const n = normalizeCartEvent({
      event: 'checkout:contact_info_submitted',
      properties: {
        cart: { token: 't' },
        checkout: { token: 'c', email: 'from-checkout@example.com', items: [] },
      },
    })
    expect(n?.email).toBe('from-checkout@example.com')
  })

  it('defaults currency to EUR and total_price to 0 when no payload', () => {
    const n = normalizeCartEvent({ event: 'cart:viewed', properties: { cart: { token: 't' } } })
    expect(n?.currency).toBe('EUR')
    expect(n?.total_price).toBe(0)
    expect(n?.cart_has_payload).toBe(false)
  })

  it('captures raw_properties for downstream snapshot storage', () => {
    const props = { cart: { token: 't' }, $set: { email: 'x@y.z' }, custom: 'value' }
    const n = normalizeCartEvent({ event: 'cart:viewed', properties: props })
    expect(n?.raw_properties).toBe(props)
  })
})

describe('toIngestInput — thin wrapper on normalizeCartEvent', () => {
  it('returns null for non-cart events', () => {
    expect(toIngestInput({ event: '$pageview', properties: { cart: { token: 'x' } } })).toBeNull()
  })

  it('accepts all 13 cart/checkout event names', () => {
    const names = [
      'cart:product_added',
      'cart:product_removed',
      'cart:updated',
      'cart:cleared',
      'cart:viewed',
      'cart:closed',
      'cart:discount_applied',
      'checkout:started',
      'checkout:contact_info_submitted',
      'checkout:address_info_submitted',
      'checkout:shipping_info_submitted',
      'checkout:payment_info_submitted',
      'checkout:completed',
    ]
    for (const name of names) {
      const result = toIngestInput({ event: name, properties: { cart: { token: 't' } } })
      expect(result?.action).toBe(name)
      expect(result?.cart_token).toBe('t')
    }
  })

  it('passes new v2 fields through to the ingest input', () => {
    const result = toIngestInput({
      event: 'checkout:completed',
      properties: {
        cart: {
          token: 't',
          items: [],
          total_price: 100,
          currency: 'EUR',
          total_discount: 10,
          cart_level_discounts: [{ title: 'SUMMER20', amount: 10 }],
        },
        checkout: { token: 'chk-1', total_price: 120, currency: 'EUR', items: [] },
      },
    })
    expect(result?.checkout_token).toBe('chk-1')
    expect(result?.total_discount).toBe(10)
    expect(result?.cart_level_discounts).toEqual([{ title: 'SUMMER20', amount: 10 }])
  })
})

describe('subscriber routing (simulated)', () => {
  // Simulate what the subscriber does: iterate a batch, convert each event,
  // and dispatch to command.ingestCartEvent.
  async function simulateSubscriber(body: unknown, mockIngestCartEvent: (input: unknown) => Promise<void>) {
    const events = extractPosthogEvents(body)
    for (const evt of events) {
      const input = toIngestInput(evt)
      if (!input) continue
      await mockIngestCartEvent(input)
    }
  }

  it('calls ingestCartEvent once per cart/checkout event in a v2 batch', async () => {
    const calls: unknown[] = []
    const mockIngest = async (input: unknown) => {
      calls.push(input)
    }
    const batch = {
      batch: [
        {
          event: 'cart:product_added',
          properties: { cart: { token: 't1', items: [], total_price: 0, currency: 'EUR' } },
        },
        { event: 'cart:cleared', properties: { cart: { token: 't1', items: [], total_price: 0, currency: 'EUR' } } },
        {
          event: 'checkout:completed',
          properties: {
            cart: { token: 't1', items: [], total_price: 100, currency: 'EUR' },
            checkout: { token: 'c1', total_price: 100, currency: 'EUR', items: [] },
          },
        },
        { event: '$pageview', properties: { cart: { token: 't1' } } }, // skipped — not a cart event
        { event: 'cart:viewed', properties: {} }, // skipped — no cart token
      ],
    }
    await simulateSubscriber(batch, mockIngest)
    expect(calls).toHaveLength(3)
    expect((calls[0] as { action: string }).action).toBe('cart:product_added')
    expect((calls[1] as { action: string }).action).toBe('cart:cleared')
    expect((calls[2] as { action: string }).action).toBe('checkout:completed')
  })
})
