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
  it('logs denied consent without blocking identity capture during observation phase', async () => {
    const unsafeCalls: Array<{ query: string; params?: unknown[] }> = []
    const res = await POST(
      makeReq(
        {
          event_id: 'evt_contact_email_without_analytics_consent',
          event_name: 'add_contact_info',
          event_time: '2026-06-11T23:00:00.000Z',
          source: 'shopify_theme',
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
})
