import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { POST } from '../src/modules/event-hub/api/ingest/route'

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function makeReq(body: Record<string, unknown>, unsafeCalls: Array<{ query: string; params?: unknown[] }>) {
  const sql = Object.assign(async () => [], {
    unsafe: async (query: string, params?: unknown[]) => {
      unsafeCalls.push({ query, params })
      return []
    },
  })
  const req = new Request('https://admin.fancypalas.com/api/event-hub/ingest', {
    method: 'POST',
    headers: {
      origin: 'https://fancypalas.com',
      'content-type': 'application/json',
      'user-agent': 'Vitest Browser',
      'x-forwarded-for': '203.0.113.10, 10.0.0.1',
      cookie: '_fbp=fb.1.1710000000.1234567890; _fbc=fb.1.1710000000.fbclid_123',
    },
    body: JSON.stringify(body),
  })
  Object.defineProperty(req, 'app', {
    value: {
      infra: {
        db: {
          getPool: () => sql,
          raw: async () => [],
        },
      },
    },
    enumerable: true,
    configurable: true,
  })
  return req
}

describe('Event Hub ingest consent logging', () => {
  it('rejects legacy browser direct ingest before persistence', async () => {
    const unsafeCalls: Array<{ query: string; params?: unknown[] }> = []
    const res = await POST(
      makeReq(
        {
          event_id: 'evt_legacy_direct_shopify_theme',
          event_name: 'page_view',
          event_time: '2026-06-11T23:00:00.000Z',
          source: 'shopify_theme',
          context: { url: 'https://fancypalas.com/', page_type: 'home' },
        },
        unsafeCalls,
      ),
    )

    expect(res.status).toBe(410)
    expect(await res.json()).toMatchObject({
      ok: false,
      error: 'DIRECT_EVENT_HUB_INGEST_DISABLED',
      source: 'shopify_theme',
    })
    expect(unsafeCalls).toHaveLength(0)
  })

  it('logs denied consent without blocking identity capture during observation phase', async () => {
    const unsafeCalls: Array<{ query: string; params?: unknown[] }> = []
    const res = await POST(
      makeReq(
        {
          event_id: 'evt_contact_email_without_analytics_consent',
          event_name: 'add_contact_info',
          event_time: '2026-06-11T23:00:00.000Z',
          source: 'posthog_proxy',
          consent: {
            analytics_storage: false,
            ad_storage: false,
            ad_user_data: false,
            ad_personalization: false,
            source: 'shopify_customer_privacy',
          },
          context: { url: 'https://fancypalas.com/cart', page_type: 'cart' },
          properties: { checkout: { email: ' Client@Example.com ' } },
        },
        unsafeCalls,
      ),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('muid=')
    expect(unsafeCalls[0].params?.[5]).toEqual(expect.stringMatching(/^muid_/))
    expect(unsafeCalls[0].params?.[6]).toBe(sha256('client@example.com'))
    expect(unsafeCalls[0].params?.[7]).toBeNull()
    const normalized = JSON.parse(unsafeCalls[0].params?.[10] as string)
    expect(normalized.consent).toMatchObject({
      analytics_storage: false,
      ad_storage: false,
      ad_user_data: false,
      ad_personalization: false,
      source: 'shopify_customer_privacy',
    })
  })

  it('uses the Event Hub muid as GA4 client id without relying on a GA browser tag', async () => {
    const unsafeCalls: Array<{ query: string; params?: unknown[] }> = []
    const res = await POST(
      makeReq(
        {
          event_id: 'evt_purchase_with_event_hub_client_id',
          event_name: 'purchase',
          event_time: '2026-06-12T12:00:00.000Z',
          source: 'posthog_proxy',
          consent: {
            analytics_storage: true,
            ad_storage: true,
            ad_user_data: true,
            ad_personalization: true,
            source: 'shopify_customer_privacy',
          },
          context: { url: 'https://fancypalas.com/checkouts/cn/thank-you', page_type: 'purchase' },
          user: { gclid: 'gclid_1' },
          ecommerce: {
            currency: 'EUR',
            value: 150,
            transaction_id: 'order_1',
            items: [{ item_id: 'v1', item_name: 'Bague', price: 150, quantity: 1 }],
          },
          properties: {
            checkout: { shopify_order_id: 'order_1', email: 'client@example.com' },
          },
        },
        unsafeCalls,
      ),
    )

    expect(res.status).toBe(200)
    const eventHubClientId = unsafeCalls[0].params?.[5]
    expect(eventHubClientId).toEqual(expect.stringMatching(/^muid_/))
    const normalized = JSON.parse(unsafeCalls[0].params?.[10] as string)
    expect(normalized.user.ga_client_id).toBe(eventHubClientId)

    const ga4Call = unsafeCalls.find((call) => call.params?.[0] === 'evt_purchase_with_event_hub_client_id:ga4')
    expect(ga4Call?.params?.[4]).toBe('pending')
    expect(ga4Call?.params?.[8]).toBeNull()

    const metaCall = unsafeCalls.find((call) => call.params?.[0] === 'evt_purchase_with_event_hub_client_id:meta_capi')
    expect(metaCall?.params?.[4]).toBe('pending')
    expect(metaCall?.params?.[8]).toBeNull()
    const metaPayload = JSON.parse(metaCall?.params?.[9] as string)
    expect(metaPayload.data[0]).toMatchObject({
      event_name: 'Purchase',
      event_id: 'evt_purchase_with_event_hub_client_id',
      action_source: 'website',
      event_source_url: 'https://fancypalas.com/checkouts/cn/thank-you',
      user_data: {
        client_ip_address: '203.0.113.10',
        client_user_agent: 'Vitest Browser',
        fbp: 'fb.1.1710000000.1234567890',
        fbc: 'fb.1.1710000000.fbclid_123',
      },
    })
  })
})
