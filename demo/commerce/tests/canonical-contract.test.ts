import { describe, expect, it } from 'vitest'
import {
  isDispatchableCanonicalEventName,
  isGa4CanonicalEventName,
  validateCanonicalEvent,
  validationErrorsForSupportedDestinations,
} from '../src/modules/event-hub/canonical-contract'

const basePayload = {
  consent: {
    analytics_storage: true,
    ad_storage: true,
    ad_user_data: true,
    ad_personalization: true,
    source: 'test',
  },
  user: {
    ga_client_id: '123.456',
    email_sha256: 'a'.repeat(64),
    client_ip: '203.0.113.10',
    user_agent: 'Vitest',
    gclid: 'gclid_1',
  },
  context: { url: 'https://fancypalas.com/products/bague', page_type: 'product' },
  ecommerce: {
    currency: 'EUR',
    value: 120,
    transaction_id: 'order_1',
    items: [{ item_id: 'v1', item_name: 'Bague', price: 120, quantity: 1 }],
  },
  checkout: { shopify_order_id: 'order_1' },
}

describe('canonical event contract', () => {
  it('accepts a complete view_item for GA4 and ad destinations that support it', () => {
    const result = validateCanonicalEvent({
      eventName: 'view_item',
      eventId: 'evt_1',
      eventTime: '2026-06-11T10:00:00.000Z',
      payload: basePayload,
    })

    expect(result.valid).toBe(true)
    expect(result.destinations.ga4).toMatchObject({ supported: true, ready: true, event_name: 'view_item' })
    expect(result.destinations.meta_capi).toMatchObject({ supported: true, ready: true, event_name: 'ViewContent' })
    expect(result.destinations.google_ads.supported).toBe(false)
  })

  it('routes storefront browsing and checkout step events to Meta instead of marking them unsupported', () => {
    for (const [eventName, metaEventName] of [
      ['view_item_list', 'ViewContent'],
      ['remove_from_cart', 'ViewContent'],
      ['view_cart', 'ViewContent'],
      ['add_shipping_info', 'InitiateCheckout'],
    ] as const) {
      const result = validateCanonicalEvent({
        eventName,
        eventId: `evt_${eventName}`,
        eventTime: '2026-06-11T10:00:00.000Z',
        payload: basePayload,
      })

      expect(result.destinations.meta_capi).toMatchObject({
        supported: true,
        ready: true,
        event_name: metaEventName,
      })
    }
  })

  it('rejects a product view without items', () => {
    const result = validateCanonicalEvent({
      eventName: 'view_item',
      eventId: 'evt_1',
      eventTime: '2026-06-11T10:00:00.000Z',
      payload: { ...basePayload, ecommerce: { ...basePayload.ecommerce, items: [] } },
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('items_missing')
    expect(result.destinations.ga4.blockers).toContain('items_missing')
  })

  it('marks CRM-only PostHog events as non-dispatchable', () => {
    const result = validateCanonicalEvent({
      eventName: 'cart:closed',
      eventId: 'evt_1',
      eventTime: '2026-06-11T10:00:00.000Z',
      payload: basePayload,
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('non_dispatchable_internal_event')
    expect(result.destinations.posthog.ready).toBe(true)
    expect(result.destinations.ga4.supported).toBe(false)
    expect(result.destinations.meta_capi.supported).toBe(false)
    expect(isDispatchableCanonicalEventName('cart:closed')).toBe(false)
    expect(isGa4CanonicalEventName('cart:closed')).toBe(false)
  })

  it('keeps externally routable canonical events in the dispatchable set', () => {
    expect(isDispatchableCanonicalEventName('page_view')).toBe(true)
    expect(isDispatchableCanonicalEventName('purchase')).toBe(true)
    expect(isGa4CanonicalEventName('purchase')).toBe(true)
    expect(isGa4CanonicalEventName('add_contact_info')).toBe(false)
  })

  it('accepts stable server-generated event IDs for dispatchability', () => {
    const result = validateCanonicalEvent({
      eventName: 'purchase',
      eventId: 'palas_purchase_generated',
      eventTime: '2026-06-11T10:00:00.000Z',
      eventIdWasGenerated: true,
      payload: basePayload,
    })

    expect(result.valid).toBe(true)
    expect(result.errors).not.toContain('event_id_server_generated')
  })

  it('keeps denied analytics consent out of the GA4 readiness decision', () => {
    const result = validateCanonicalEvent({
      eventName: 'view_item',
      eventId: 'evt_denied_consent',
      eventTime: '2026-06-11T10:00:00.000Z',
      payload: {
        ...basePayload,
        consent: {
          analytics_storage: false,
          ad_storage: false,
          ad_user_data: false,
          ad_personalization: false,
          source: 'shopify_customer_privacy',
        },
      },
    })

    expect(result.valid).toBe(true)
    expect(result.destinations.ga4).toMatchObject({ supported: true, ready: true, blockers: [] })
    expect(result.destinations.meta_capi.blockers).toContain('ad_storage_consent_not_granted')
    expect(validationErrorsForSupportedDestinations(result)).toEqual([])
  })
})
