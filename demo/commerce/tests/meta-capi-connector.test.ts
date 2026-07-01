import { describe, expect, it, vi } from 'vitest'
import {
  getMetaCapiConfig,
  mapCanonicalToMetaCapi,
  sendMetaCapiPayload,
} from '../src/modules/event-hub/meta-capi-connector'

const purchasePayload = {
  event_id: 'evt_purchase_1',
  event_time: '2026-06-12T10:11:12.000Z',
  user: {
    muid: 'muid_0123456789abcdef0123456789abcdef',
    email_sha256: 'a'.repeat(64),
    fbp: 'fb.1.1710000000.1234567890',
    fbc: 'fb.1.1710000000.fbclid_123',
    client_ip: '203.0.113.10',
    user_agent: 'Vitest Browser',
  },
  consent: {
    ad_user_data: true,
    ad_storage: true,
    ad_personalization: true,
  },
  context: {
    url: 'https://fancypalas.com/checkouts/cn/thank-you',
  },
  ecommerce: {
    currency: 'EUR',
    value: 150,
    transaction_id: 'order_123',
    items: [{ item_id: 'variant_1', item_name: 'Bague', price: 150, quantity: 1 }],
  },
  checkout: {
    shopify_order_id: 'order_123',
  },
}

describe('Meta CAPI connector mapping', () => {
  it('maps purchase payloads to Conversions API shape', () => {
    const mapped = mapCanonicalToMetaCapi('purchase', purchasePayload, { testEventCode: 'TEST123' })

    expect(mapped.ok).toBe(true)
    expect(mapped.payload).toMatchObject({
      test_event_code: 'TEST123',
      data: [
        {
          event_name: 'Purchase',
          event_time: 1_781_259_072,
          event_id: 'evt_purchase_1',
          action_source: 'website',
          event_source_url: 'https://fancypalas.com/checkouts/cn/thank-you',
          user_data: {
            em: ['a'.repeat(64)],
            fbp: 'fb.1.1710000000.1234567890',
            fbc: 'fb.1.1710000000.fbclid_123',
            client_ip_address: '203.0.113.10',
            client_user_agent: 'Vitest Browser',
          },
          custom_data: {
            currency: 'EUR',
            value: 150,
            order_id: 'order_123',
            content_type: 'product',
            content_ids: ['variant_1'],
            contents: [{ id: 'variant_1', quantity: 1, item_price: 150 }],
            num_items: 1,
          },
        },
      ],
    })
    expect(mapped.metadata).toMatchObject({
      email_present: true,
      external_id_present: true,
      fbp_present: true,
      fbc_present: true,
      client_ip_present: true,
      client_user_agent_present: true,
    })
  })

  it('rejects website events without client user agent and match keys', () => {
    const mapped = mapCanonicalToMetaCapi('page_view', {
      ...purchasePayload,
      event_id: 'evt_page_1',
      user: {},
      ecommerce: {},
    })

    if (mapped.ok) throw new Error('Expected Meta CAPI mapping to be invalid')
    expect(mapped.errors).toContain('meta_capi_client_user_agent_missing')
    expect(mapped.errors).toContain('meta_capi_user_data_missing')
  })

  it('accepts website events without IP when user agent, source URL, consent, and match data are present', () => {
    const mapped = mapCanonicalToMetaCapi('page_view', {
      ...purchasePayload,
      event_id: 'evt_page_1',
      user: {
        muid: 'muid_0123456789abcdef0123456789abcdef',
        user_agent: 'Vitest Browser',
      },
      ecommerce: {},
    })

    expect(mapped.ok).toBe(true)
    expect(mapped.payload).toMatchObject({
      data: [
        {
          event_name: 'PageView',
          user_data: {
            client_user_agent: 'Vitest Browser',
          },
        },
      ],
    })
  })

  it('maps add_payment_info to the Meta standard event', () => {
    const mapped = mapCanonicalToMetaCapi('add_payment_info', {
      ...purchasePayload,
      event_id: 'evt_payment_1',
    })

    expect(mapped.ok).toBe(true)
    expect(mapped.payload).toMatchObject({
      data: [
        {
          event_name: 'AddPaymentInfo',
          event_id: 'evt_payment_1',
        },
      ],
    })
  })

  it('keeps non-consented events out of Meta dispatch', () => {
    const mapped = mapCanonicalToMetaCapi('purchase', {
      ...purchasePayload,
      consent: {
        ad_storage: false,
        ad_user_data: false,
        ad_personalization: false,
      },
    })

    if (mapped.ok) throw new Error('Expected Meta CAPI mapping to be invalid')
    expect(mapped.errors).toContain('meta_capi_ad_storage_consent_not_granted')
    expect(mapped.errors).toContain('meta_capi_ad_user_data_consent_not_granted')
    expect(mapped.errors).toContain('meta_capi_ad_personalization_consent_not_granted')
  })

  it('loads config from Meta or Facebook env names', () => {
    expect(
      getMetaCapiConfig({
        FACEBOOK_PIXEL_ID: 'pixel_1',
        FACEBOOK_ACCESS_TOKEN: 'token_1',
        FACEBOOK_TEST_EVENT_CODE: 'test_1',
      } as NodeJS.ProcessEnv),
    ).toMatchObject({
      pixelId: 'pixel_1',
      accessToken: 'token_1',
      testEventCode: 'test_1',
      apiVersion: 'v25.0',
    })
  })

  it('posts accepted payloads to the pixel events endpoint', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ events_received: 1, fbtrace_id: 'trace_1' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const mapped = mapCanonicalToMetaCapi('purchase', purchasePayload)
    const result = await sendMetaCapiPayload(mapped.payload, {
      pixelId: 'pixel_1',
      accessToken: 'token_1',
      testEventCode: null,
      apiVersion: 'v25.0',
      endpoint: 'https://graph.facebook.com/v25.0',
    })

    expect(result).toMatchObject({ status: 'sent', http_status: 200 })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v25.0/pixel_1/events?access_token=token_1',
      expect.objectContaining({ method: 'POST' }),
    )

    vi.unstubAllGlobals()
  })
})
