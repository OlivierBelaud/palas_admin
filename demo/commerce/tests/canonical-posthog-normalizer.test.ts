import { describe, expect, it } from 'vitest'
import { inferPageType, normalizePosthogEventToCanonical } from '../src/modules/event-hub/canonical-posthog'
import type { IdentityShadowComparison } from '../src/modules/identity/resolve-event-identity'

function comparison(overrides: Partial<IdentityShadowComparison> = {}): IdentityShadowComparison {
  return {
    signals: {
      event_id: 'evt_1',
      event_name: '$pageview',
      observed_at: '2026-06-09T10:00:00.000Z',
      posthog_distinct_id: 'ph_1',
      session_id: 'sess_1',
      current_url: 'https://fancypalas.com/products/bague-test',
      email: null,
      manta_uid_token: null,
      klaviyo_exchange_id: null,
      klaviyo_profile_id: null,
      shopify_customer_id: null,
      cart_token: null,
      checkout_token: null,
    },
    v1: { email: null, contact_id: null, source: null },
    v2: { email: null, contact_id: null, source: null },
    matched_v1: true,
    status: 'anonymous',
    aliases_seen: {},
    evidence: {},
    ...overrides,
  }
}

describe('canonical PostHog normalizer', () => {
  it('infers Shopify page types from URLs', () => {
    expect(inferPageType('https://fancypalas.com/')).toBe('home')
    expect(inferPageType('https://fancypalas.com/collections/bagues')).toBe('collection')
    expect(inferPageType('https://fancypalas.com/collections/bagues/products/bague-test')).toBe('product')
    expect(inferPageType('https://fancypalas.com/search?q=or')).toBe('search')
  })

  it('derives a product pageview into canonical view_item and marks missing item payload for GA4', () => {
    const event = normalizePosthogEventToCanonical(
      {
        uuid: 'evt_product',
        event: '$pageview',
        distinct_id: 'ph_1',
        timestamp: '2026-06-09T10:00:00.000Z',
        properties: { $current_url: 'https://fancypalas.com/products/bague-test' },
      },
      comparison({ signals: { ...comparison().signals, event_id: 'evt_product' } }),
      { forwarded: true, status: 200 },
    )

    expect(event?.event_name).toBe('view_item')
    expect(event?.raw_event_name).toBe('$pageview')
    expect(event?.page_type).toBe('product')
    expect(event?.valid).toBe(false)
    expect(event?.validation_errors).toContain('items_missing_for_ga4')
    expect(event?.payload_normalized.dispatch).toMatchObject({ posthog: { status: 'forwarded', http_status: 200 } })
  })

  it('maps cart product additions to add_to_cart with ecommerce fields', () => {
    const event = normalizePosthogEventToCanonical(
      {
        uuid: 'evt_cart',
        event: 'cart:product_added',
        distinct_id: 'ph_1',
        timestamp: '2026-06-09T10:00:00.000Z',
        properties: {
          cart: {
            token: 'cart_1',
            total_price: 120,
            currency: 'EUR',
            items: [{ variant_id: 'v1', title: 'Bague test', price: 120, quantity: 1 }],
          },
        },
      },
      comparison({ signals: { ...comparison().signals, event_id: 'evt_cart', cart_token: 'cart_1' } }),
      { forwarded: true, status: 200 },
    )

    expect(event?.event_name).toBe('add_to_cart')
    expect(event?.valid).toBe(true)
    expect(event?.payload_normalized.ecommerce).toMatchObject({ value: 120, currency: 'EUR', item_count: 1 })
    expect(event?.payload_normalized.cart).toMatchObject({ token: 'cart_1' })
  })

  it('maps checkout completion to purchase and exposes V2 identity', () => {
    const event = normalizePosthogEventToCanonical(
      {
        uuid: 'evt_purchase',
        event: 'checkout:completed',
        distinct_id: 'ph_1',
        timestamp: '2026-06-09T10:00:00.000Z',
        properties: {
          checkout: {
            token: 'chk_1',
            shopify_order_id: 'order_1',
            total_price: 150,
            currency: 'EUR',
            items: [{ variant_id: 'v1', title: 'Bague test', price: 150, quantity: 1 }],
          },
        },
      },
      comparison({
        signals: {
          ...comparison().signals,
          event_id: 'evt_purchase',
          checkout_token: 'chk_1',
          current_url: 'https://fancypalas.com/checkouts/cn/thank-you',
        },
        v2: { email: 'alice@test.com', contact_id: 'contact_1', source: 'event_email' },
        matched_v1: false,
        status: 'diverged',
      }),
      { forwarded: true, status: 200 },
    )

    expect(event?.event_name).toBe('purchase')
    expect(event?.valid).toBe(true)
    expect(event?.identity_email_sha256).toHaveLength(64)
    expect(event?.payload_normalized.user).toMatchObject({
      identity_status: 'diverged',
      identity_source: 'event_email',
      contact_id: 'contact_1',
    })
  })
})
