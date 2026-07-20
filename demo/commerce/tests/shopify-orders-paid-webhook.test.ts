import { beforeEach, describe, expect, it, vi } from 'vitest'

const upsertCalls: Array<Record<string, unknown>> = []
const emitCalls: string[] = []

vi.mock('../src/modules/cart-tracking/upsert-shopify-order', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/modules/cart-tracking/upsert-shopify-order')>()
  return {
    ...original,
    upsertShopifyOrder: vi.fn(async (_sql: unknown, order: Record<string, unknown>) => {
      upsertCalls.push(order)
      return { matched_via: 'cart_token', cart_id: 'cart_1', already_completed: false }
    }),
  }
})

const routeModulePromise = import('../src/modules/cart-tracking/api/shopify-webhooks/orders-paid/route')

beforeEach(() => {
  upsertCalls.length = 0
  emitCalls.length = 0
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = 'test-token'
  process.env.SHOPIFY_SHOP_DOMAIN = 'fancy-palas.myshopify.com'
})

function canonicalOrder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '9001',
    email: 'buyer@example.com',
    cart_token: 'cart-token',
    checkout_token: 'checkout-token',
    created_at: '2026-07-20T10:00:00.000Z',
    total_price: '120.00',
    currency: 'EUR',
    line_items: [],
    financial_status: 'paid',
    fulfillment_status: 'fulfilled',
    ...overrides,
  }
}

function withRuntimeApp(req: Request, failEvent?: string): Request {
  const sql = Object.assign(() => Promise.resolve([]), {
    unsafe: () => Promise.resolve([]),
  })
  Object.defineProperty(req, 'app', {
    value: {
      resolve(key: string) {
        if (key !== 'IDatabasePort' && key !== 'db') return undefined
        return {
          getPool: () => sql,
          raw: () => Promise.resolve([]),
        }
      },
      async emit(event: string) {
        emitCalls.push(event)
        if (event === failEvent) throw new Error(`${event} unavailable`)
      },
    },
    enumerable: true,
    configurable: true,
  })
  return req
}

describe('POST /api/cart-tracking/shopify-webhooks/orders-paid', () => {
  it('projects the canonical fetch-back state, not an out-of-order posted body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ order: canonicalOrder() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    const req = new Request('https://admin.fancypalas.com/api/cart-tracking/shopify-webhooks/orders-paid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '9001', financial_status: 'pending', total_price: '1.00' }),
    })
    const { POST } = await routeModulePromise
    const res = await POST(withRuntimeApp(req))

    expect(res.status).toBe(200)
    expect(upsertCalls).toHaveLength(1)
    expect(upsertCalls[0]).toMatchObject({
      id: '9001',
      financial_status: 'paid',
      fulfillment_status: 'fulfilled',
      total_price: '120.00',
    })
    expect(emitCalls).toEqual(['order.refresh-requested', 'contact.refresh-requested', 'cart.refresh-requested'])
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/orders/9001.json'),
      expect.objectContaining({
        headers: { 'X-Shopify-Access-Token': 'test-token' },
      }),
    )
    expect((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit | undefined)?.method).toBeUndefined()
  })

  it('fails visibly before writing when the event transport is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ order: canonicalOrder() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    const sql = Object.assign(() => Promise.resolve([]), {
      unsafe: () => Promise.resolve([]),
    })
    const req = new Request('https://admin.fancypalas.com/api/cart-tracking/shopify-webhooks/orders-paid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '9001' }),
    })
    Object.defineProperty(req, 'app', {
      value: {
        resolve: () => ({ getPool: () => sql, raw: () => Promise.resolve([]) }),
      },
    })

    const { POST } = await routeModulePromise
    const res = await POST(req)

    expect(res.status).toBe(500)
    expect(await res.text()).toBe('Event Transport Misconfigured')
    expect(upsertCalls).toHaveLength(0)
  })

  it('returns a retryable failure when a required refresh event cannot be durably emitted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ order: canonicalOrder() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    const req = new Request('https://admin.fancypalas.com/api/cart-tracking/shopify-webhooks/orders-paid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '9001' }),
    })
    const { POST } = await routeModulePromise
    const res = await POST(withRuntimeApp(req, 'order.refresh-requested'))

    expect(res.status).toBe(500)
    expect(await res.text()).toBe('Internal Error')
    expect(upsertCalls).toHaveLength(1)
  })

  it('distinguishes a Shopify outage from an unknown order id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503 })))

    const req = new Request('https://admin.fancypalas.com/api/cart-tracking/shopify-webhooks/orders-paid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '9001' }),
    })
    const { POST } = await routeModulePromise
    const res = await POST(req)

    expect(res.status).toBe(502)
    expect(await res.text()).toBe('Shopify Unavailable')
    expect(upsertCalls).toHaveLength(0)
  })
})
