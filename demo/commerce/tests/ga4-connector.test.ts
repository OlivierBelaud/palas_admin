import { describe, expect, it } from 'vitest'
import {
  ensureMissingGa4DispatchLogs,
  gaClientIdFromCookie,
  getGa4Config,
  mapCanonicalToGa4,
} from '../src/modules/event-hub/ga4-connector'

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

    if (mapped.ok) throw new Error('Expected GA4 mapping to be invalid')
    expect(mapped.errors).toContain('ga4_client_id_missing')
  })

  it('preserves numeric Shopify item identifiers in GA4 item arrays', () => {
    const mapped = mapCanonicalToGa4('view_item_list', {
      user: { ga_client_id: '123456789.987654321' },
      context: { url: 'https://fancypalas.com/fr/collections/tous-les-bijoux' },
      ecommerce: {
        currency: 'EUR',
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
    })

    expect(mapped.ok).toBe(true)
    expect(mapped.payload).toMatchObject({
      events: [
        {
          name: 'view_item_list',
          params: {
            item_list_name: 'Tous les bijoux',
            items: [
              {
                item_id: '50123456789012',
                item_name: 'Santa Maria - Bracelet Pink',
                item_variant: 'Default Title',
                price: 49,
                quantity: 1,
                index: 0,
              },
            ],
          },
        },
      ],
    })
  })

  it('maps purchase payloads to GA4 Measurement Protocol shape', () => {
    const mapped = mapCanonicalToGa4('purchase', {
      user: {
        ga_client_id: '123456789.987654321',
        contact_id: 'contact_1',
        muid: 'muid_1',
        distinct_id: 'ph_1',
        email_sha256: 'a'.repeat(64),
        identity_source: 'event_email',
        gclid: 'gclid_1',
        gbraid: 'gbraid_1',
        wbraid: 'wbraid_1',
        fbclid: 'fbclid_1',
        fbc: 'fb.1.123.abc',
        fbp: 'fb.1.123.xyz',
        ttclid: 'ttclid_1',
      },
      context: {
        url: 'https://fancypalas.com/checkouts/cn/thank-you?gclid=gclid_1',
        referrer: 'https://fancypalas.com/cart',
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
          campaign_name: 'Brand Search',
          ad_group_name: 'Brand FR',
          placement: 'search',
        },
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
            page_location: 'https://fancypalas.com/checkouts/cn/thank-you?gclid=gclid_1',
            transaction_id: 'order_1',
            currency: 'EUR',
            value: 150,
            gclid: 'gclid_1',
            gbraid: 'gbraid_1',
            wbraid: 'wbraid_1',
            fbclid: 'fbclid_1',
            ttclid: 'ttclid_1',
            term: 'palas',
            content: 'search-ad',
            utm_id: 'utm_1',
            campaign_id: 'camp_1',
            ad_group_id: 'group_1',
            ad_id: 'ad_1',
            creative_id: 'creative_1',
            items: [{ item_id: 'v1', item_name: 'Bague', item_variant: 'Or', price: 125, quantity: 1 }],
          },
        },
      ],
      user_data: {
        sha256_email_address: ['a'.repeat(64)],
      },
      user_properties: {
        identity_source: { value: 'event_email' },
        palas_muid: { value: 'muid_1' },
        posthog_distinct_id: { value: 'ph_1' },
      },
    })
  })

  it('uses MUID as GA4 user_id when contact_id is not resolved yet', () => {
    const mapped = mapCanonicalToGa4('page_view', {
      user: {
        ga_client_id: 'muid_1',
        muid: 'muid_1',
        distinct_id: 'ph_1',
      },
      context: { url: 'https://fancypalas.com/products/bague' },
      ecommerce: {},
    })

    expect(mapped.ok).toBe(true)
    expect(mapped.payload).toMatchObject({
      client_id: 'muid_1',
      user_id: 'muid_1',
    })
  })

  it('uses GA4 debug endpoint by default during connector testing', () => {
    expect(getGa4Config({} as NodeJS.ProcessEnv)).toMatchObject({
      debug: true,
      endpoint: 'https://www.google-analytics.com/debug/mp/collect',
    })
    expect(getGa4Config({ GA4_DEBUG: 'false' } as NodeJS.ProcessEnv)).toMatchObject({
      debug: false,
      endpoint: 'https://www.google-analytics.com/mp/collect',
    })
  })

  it('materializes missing GA4 dispatch rows from normalized event logs', async () => {
    const writes: Array<{ query: string; params?: unknown[] }> = []
    const db = {
      raw: async <T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]> => {
        if (query.trim().startsWith('SELECT')) {
          return [
            {
              event_id: 'evt_1',
              event_name: 'page_view',
              source_event_name: 'page_view',
              received_at: '2026-06-18T08:30:00.000Z',
              payload_normalized: {
                user: { ga_client_id: 'muid_1', muid: 'muid_1', distinct_id: 'ph_1' },
                context: { url: 'https://fancypalas.com/products/bague' },
                ecommerce: {},
              },
            },
          ] as T[]
        }
        writes.push({ query, params })
        return [{ id: 'dispatch_1' }] as T[]
      },
    }

    const result = await ensureMissingGa4DispatchLogs(db)

    expect(result).toEqual({ scanned: 1, inserted: 1, invalid: 0 })
    expect(writes).toHaveLength(1)
    expect(writes[0].params?.slice(0, 10)).toEqual([
      'evt_1:ga4',
      'evt_1',
      'page_view',
      'page_view',
      'ga4',
      'pending',
      '2026-06-18T08:30:00.000Z',
      expect.any(Date),
      null,
      null,
    ])
    expect(JSON.parse(String(writes[0].params?.[10]))).toMatchObject({
      client_id: 'muid_1',
      events: [{ name: 'page_view' }],
    })
  })
})
