import { describe, expect, it } from 'vitest'
import type { CanonicalValidationResult } from '../src/modules/event-hub/canonical-contract'
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

  it('keeps a product PostHog pageview as page_view instead of inventing an incomplete view_item', () => {
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

    expect(event?.event_name).toBe('page_view')
    expect(event?.raw_event_name).toBe('$pageview')
    expect(event?.page_type).toBe('product')
    expect(event?.valid).toBe(true)
    expect(event?.validation_errors).toEqual([])
    expect(event?.validation_errors).not.toContain('ga4:ga4_client_id_missing')
    expect(event?.payload_normalized.user).toMatchObject({ ga_client_id: 'ph_1' })
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
    expect(event?.validation_errors).toEqual([])
    expect(event?.validation_errors).not.toContain('ga4:ga4_client_id_missing')
    expect(event?.payload_normalized.ecommerce).toMatchObject({ value: 120, currency: 'EUR', item_count: 1 })
    expect(event?.payload_normalized.cart).toMatchObject({ token: 'cart_1' })
  })

  it('maps PostHog ecommerce product events with items from properties.ecommerce', () => {
    const event = normalizePosthogEventToCanonical(
      {
        uuid: 'evt_product_view',
        event: 'view_item',
        distinct_id: 'ph_1',
        timestamp: '2026-06-09T10:00:00.000Z',
        properties: {
          $current_url: 'https://fancypalas.com/products/bague-test',
          ecommerce: {
            currency: 'EUR',
            value: 120,
            items: [{ item_id: 'v1', item_name: 'Bague test', price: 120, quantity: 1 }],
          },
        },
      },
      comparison({ signals: { ...comparison().signals, event_id: 'evt_product_view' } }),
      { forwarded: true, status: 200 },
    )

    expect(event?.event_name).toBe('view_item')
    expect(event?.validation_errors).not.toContain('items_missing')
    expect(event?.validation_errors).not.toContain('ga4:ga4_client_id_missing')
    expect(event?.payload_normalized.ecommerce).toMatchObject({ value: 120, currency: 'EUR', item_count: 1 })
    const validation = event?.payload_normalized.validation as CanonicalValidationResult
    expect(validation.destinations.ga4).toMatchObject({ ready: true })
  })

  it('keeps numeric Shopify product identifiers on collection list events', () => {
    const event = normalizePosthogEventToCanonical(
      {
        uuid: 'evt_collection_view',
        event: 'view_item_list',
        distinct_id: 'ph_1',
        timestamp: '2026-06-09T10:00:00.000Z',
        properties: {
          $current_url: 'https://fancypalas.com/fr/collections/tous-les-bijoux',
          ecommerce: {
            currency: 'EUR',
            item_list_id: 144850485330,
            item_list_name: 'Tous les bijoux',
            items: [
              {
                item_id: 50123456789012,
                product_id: 9988776655443,
                item_name: 'Santa Maria - Bracelet Pink',
                item_variant: 'Default Title',
                price: 49,
                quantity: 1,
                index: 0,
              },
            ],
          },
        },
      },
      comparison({ signals: { ...comparison().signals, event_id: 'evt_collection_view' } }),
      { forwarded: true, status: 200 },
    )

    expect(event?.event_name).toBe('view_item_list')
    expect(event?.valid).toBe(true)
    expect(event?.validation_errors).toEqual([])
    expect(event?.payload_normalized.ecommerce).toMatchObject({
      currency: 'EUR',
      item_count: 1,
      items: [
        {
          item_id: '50123456789012',
          item_name: 'Santa Maria - Bracelet Pink',
          price: 49,
          quantity: 1,
        },
      ],
    })
    const validation = event?.payload_normalized.validation as CanonicalValidationResult
    expect(validation.destinations.ga4).toMatchObject({ ready: true })
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
    expect(event?.validation_errors).toEqual([])
    expect(event?.validation_errors).not.toContain('ga4:ga4_client_id_missing')
    expect(event?.identity_email_sha256).toHaveLength(64)
    expect(event?.payload_normalized.user).toMatchObject({
      identity_status: 'diverged',
      identity_source: 'event_email',
      contact_id: 'contact_1',
      ga_client_id: 'ph_1',
    })
  })

  it('propagates PostHog consent properties for ads gating without blocking GA4', () => {
    const event = normalizePosthogEventToCanonical(
      {
        uuid: 'evt_consent',
        event: 'checkout:completed',
        distinct_id: 'ph_1',
        timestamp: '2026-06-09T10:00:00.000Z',
        properties: {
          palas_consent_analytics: false,
          palas_consent_ads: true,
          palas_consent_source: 'shopify_customer_privacy',
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
          event_id: 'evt_consent',
          checkout_token: 'chk_1',
          current_url: 'https://fancypalas.com/checkouts/cn/thank-you',
        },
        v2: { email: 'alice@test.com', contact_id: 'contact_1', source: 'event_email' },
        status: 'identified',
      }),
      { forwarded: true, status: 200 },
    )

    expect(event?.payload_normalized.consent).toMatchObject({
      analytics_storage: false,
      ad_storage: true,
      ad_user_data: true,
      ad_personalization: true,
      source: 'shopify_customer_privacy',
    })
    const validation = event?.payload_normalized.validation as CanonicalValidationResult
    expect(validation.destinations.ga4.ready).toBe(true)
    expect(validation.destinations.google_ads.ready).toBe(true)
  })

  it('keeps acquisition and ads tracking fields from PostHog URLs and properties', () => {
    const url =
      'https://fancypalas.com/products/bague-test?gclid=gclid_url&gbraid=gbraid_url&wbraid=wbraid_url&fbclid=fbclid_url&ttclid=ttclid_url&utm_source=google&utm_medium=cpc&utm_campaign=brand&utm_term=palas&utm_content=search-ad&utm_id=utm_1&campaign_id=camp_1&ad_group_id=group_1&ad_id=ad_1&creative_id=creative_1'
    const event = normalizePosthogEventToCanonical(
      {
        uuid: 'evt_ads',
        event: '$pageview',
        distinct_id: 'ph_1',
        timestamp: '2026-06-09T10:00:00.000Z',
        properties: {
          $current_url: url,
          muid: 'muid_1',
          fbp: 'fb.1.123.xyz',
          fbc: 'fb.1.123.abc',
        },
      },
      comparison({ signals: { ...comparison().signals, event_id: 'evt_ads', current_url: url } }),
      { forwarded: true, status: 200 },
    )

    expect(event?.payload_normalized.user).toMatchObject({
      muid: 'muid_1',
      ga_client_id: 'muid_1',
      gclid: 'gclid_url',
      gbraid: 'gbraid_url',
      wbraid: 'wbraid_url',
      fbclid: 'fbclid_url',
      ttclid: 'ttclid_url',
      fbp: 'fb.1.123.xyz',
      fbc: 'fb.1.123.abc',
    })
    expect(event?.identity_muid).toBe('muid_1')
    expect(event?.payload_normalized.context).toMatchObject({
      utm: {
        source: 'google',
        medium: 'cpc',
        campaign: 'brand',
        term: 'palas',
        content: 'search-ad',
        id: 'utm_1',
      },
      ads: {
        campaign_id: 'camp_1',
        ad_group_id: 'group_1',
        ad_id: 'ad_1',
        creative_id: 'creative_1',
      },
    })
  })
})
