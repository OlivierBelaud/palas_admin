import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
const SHOPIFY_WEBHOOK_SECRET = 'test-shopify-webhook-secret'

beforeEach(() => {
  upsertCalls.length = 0
  emitCalls.length = 0
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = 'test-token'
  process.env.SHOPIFY_SHOP_DOMAIN = 'fancy-palas.myshopify.com'
  process.env.SHOPIFY_WEBHOOK_SECRET = SHOPIFY_WEBHOOK_SECRET
})

afterEach(() => {
  vi.unstubAllGlobals()
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

function signedRequest(body: string, signatureBody = body): Request {
  const signature = createHmac('sha256', SHOPIFY_WEBHOOK_SECRET).update(signatureBody, 'utf8').digest('base64')
  return new Request('https://admin.fancypalas.com/api/cart-tracking/shopify-webhooks/orders-paid', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Hmac-Sha256': signature,
    },
    body,
  })
}

describe('POST /api/cart-tracking/shopify-webhooks/orders-paid', () => {
  it('projects the canonical fetch-back state, not an out-of-order posted body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ order: canonicalOrder() }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    )

    const req = signedRequest(JSON.stringify({ id: '9001', financial_status: 'pending', total_price: '1.00' }))
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

  it('authenticates the exact raw body without requiring canonical JSON formatting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ order: canonicalOrder() })),
    )
    const body = `{
  "financial_status": "pending",
  "id": "9001"
}`

    const { POST } = await routeModulePromise
    const res = await POST(withRuntimeApp(signedRequest(body)))

    expect(res.status).toBe(200)
    expect(upsertCalls).toHaveLength(1)
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/orders/9001.json'),
      expect.objectContaining({
        headers: { 'X-Shopify-Access-Token': 'test-token' },
      }),
    )
  })

  it('fails visibly before writing when the event transport is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ order: canonicalOrder() }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    )
    const sql = Object.assign(() => Promise.resolve([]), {
      unsafe: () => Promise.resolve([]),
    })
    const req = signedRequest(JSON.stringify({ id: '9001' }))
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
      vi.fn(
        async () =>
          new Response(JSON.stringify({ order: canonicalOrder() }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    )

    const body = JSON.stringify({ id: '9001' })
    const req = signedRequest(body)
    const { POST } = await routeModulePromise
    const res = await POST(withRuntimeApp(req, 'order.refresh-requested'))

    expect(res.status).toBe(500)
    expect(await res.text()).toBe('Internal Error')
    expect(upsertCalls).toHaveLength(1)

    const retry = await POST(withRuntimeApp(signedRequest(body)))
    expect(retry.status).toBe(200)
    expect(await retry.text()).toBe('OK')
    expect(upsertCalls).toHaveLength(2)
  })

  it('distinguishes a Shopify outage from an unknown order id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unavailable', { status: 503 })),
    )

    const req = signedRequest(JSON.stringify({ id: '9001' }))
    const { POST } = await routeModulePromise
    const res = await POST(req)

    expect(res.status).toBe(502)
    expect(await res.text()).toBe('Shopify Unavailable')
    expect(upsertCalls).toHaveLength(0)
  })

  it('fails closed before reading the body when the webhook secret is missing', async () => {
    delete process.env.SHOPIFY_WEBHOOK_SECRET
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const req = signedRequest(JSON.stringify({ id: '9001' }))
    const textSpy = vi.spyOn(req, 'text')

    const { POST } = await routeModulePromise
    const res = await POST(withRuntimeApp(req))

    expect(res.status).toBe(500)
    expect(await res.text()).toBe('Webhook Secret Misconfigured')
    expect(textSpy).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(upsertCalls).toEqual([])
    expect(emitCalls).toEqual([])
  })

  it('rejects a missing signature before any provider or application effect', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const req = new Request('https://admin.fancypalas.com/api/cart-tracking/shopify-webhooks/orders-paid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '9001' }),
    })

    const { POST } = await routeModulePromise
    const res = await POST(withRuntimeApp(req))

    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(upsertCalls).toEqual([])
    expect(emitCalls).toEqual([])
  })

  it('rejects malformed or invalid signatures before any provider or application effect', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const req = new Request('https://admin.fancypalas.com/api/cart-tracking/shopify-webhooks/orders-paid', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Hmac-Sha256': 'not-a-valid-shopify-signature',
      },
      body: 'not-json{',
    })

    const { POST } = await routeModulePromise
    const res = await POST(withRuntimeApp(req))

    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(upsertCalls).toEqual([])
    expect(emitCalls).toEqual([])
  })

  it('returns 400 without provider or application effects when the body cannot be read', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const req = signedRequest(JSON.stringify({ id: '9001' }))
    vi.spyOn(req, 'text').mockRejectedValue(new Error('body stream failed'))

    const { POST } = await routeModulePromise
    const res = await POST(withRuntimeApp(req))

    expect(res.status).toBe(400)
    expect(await res.text()).toBe('Bad Request')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(upsertCalls).toEqual([])
    expect(emitCalls).toEqual([])
  })

  it('rejects a body changed after signing before any provider or application effect', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const signedBody = JSON.stringify({ id: '9001' })
    const tamperedBody = JSON.stringify({ id: '9002' })

    const { POST } = await routeModulePromise
    const res = await POST(withRuntimeApp(signedRequest(tamperedBody, signedBody)))

    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(upsertCalls).toEqual([])
    expect(emitCalls).toEqual([])
  })

  it('returns 400 for a validly signed malformed body without fetching or mutating', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await routeModulePromise
    const res = await POST(withRuntimeApp(signedRequest('not-json{')))

    expect(res.status).toBe(400)
    expect(await res.text()).toBe('Bad JSON')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(upsertCalls).toEqual([])
    expect(emitCalls).toEqual([])
  })
})
