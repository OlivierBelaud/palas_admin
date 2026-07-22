// Smoke test — Shopify customers webhook route.
//
// Validates the fetch-back authenticity gate:
//   - a real customer id → Shopify returns the body → 200
//   - a fake customer id → Shopify returns 404 → route returns 401
//   - a malformed POST body → 400
//
// We mock the `postgres` module and the `upsertShopifyCustomer` helper so
// the route test stays self-contained (no DB needed).

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock postgres BEFORE importing the route module so the singleton uses our stub.
vi.mock('postgres', () => {
  return {
    default: () => {
      // Return a tagged-template-callable function. Our mock helper below is
      // the one that gets called by the route, not this stub.
      const stub: (...args: unknown[]) => unknown = () => Promise.resolve([])
      return stub as unknown
    },
  }
})

// Mock the upsert helper to record the call without doing DB work.
const upsertCalls: unknown[] = []
const emittedEvents: string[] = []
vi.mock('../src/modules/contact/upsert-shopify-customer', () => ({
  upsertShopifyCustomer: vi.fn(async (_sql: unknown, customer: unknown) => {
    upsertCalls.push(customer)
    if ((customer as { email?: string }).email === 'conflict@example.com') {
      return {
        matched_via: 'identity_conflict',
        contact_id: 'c-conflict',
        created: false,
        carts_reattached: 0,
      }
    }
    return { matched_via: 'inserted', contact_id: 'c-1', created: true, carts_reattached: 0 }
  }),
}))

// Import AFTER the mocks are registered.
const routeModulePromise = import('../src/modules/cart-tracking/api/shopify-webhooks/customers/route')

const SHOPIFY_REAL_ID = '1234567890'

beforeEach(() => {
  upsertCalls.length = 0
  emittedEvents.length = 0
  // Force DATABASE_URL on so the route's getSql() returns a value.
  process.env.DATABASE_URL = 'postgres://test:test@localhost/test'
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = 'test-token'
  process.env.SHOPIFY_SHOP_DOMAIN = 'fancy-palas.myshopify.com'
})

function attachRuntimeApp(req: Request, emit?: (event: string) => Promise<void>): Request {
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
      ...(emit ? { emit } : {}),
    },
    enumerable: true,
    configurable: true,
  })
  return req
}

function withRuntimeApp(req: Request): Request {
  return attachRuntimeApp(req, async (event) => {
    emittedEvents.push(event)
  })
}

function withControlledEventTransport(req: Request) {
  const pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>()
  attachRuntimeApp(req, (event) => {
    emittedEvents.push(event)
    return new Promise<void>((resolve, reject) => pending.set(event, { resolve, reject }))
  })
  return { req, pending }
}

describe('POST /api/cart-tracking/shopify-webhooks/customers', () => {
  it('returns 200 when Shopify confirms the customer id', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = String(url)
      if (u.includes(`/customers/${SHOPIFY_REAL_ID}.json`)) {
        return new Response(
          JSON.stringify({
            customer: {
              id: SHOPIFY_REAL_ID,
              email: 'jane@example.com',
              first_name: 'Jane',
              last_name: 'Doe',
              phone: null,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await routeModulePromise
    const req = new Request('https://admin.fancypalas.com/api/cart-tracking/shopify-webhooks/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: SHOPIFY_REAL_ID }),
    })
    const res = await POST(withRuntimeApp(req))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('OK')
    expect(upsertCalls.length).toBe(1)
  })

  it('does not acknowledge Shopify until every refresh event is durably emitted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ customer: { id: SHOPIFY_REAL_ID, email: 'jane@example.com' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )

    const { POST } = await routeModulePromise
    const controlled = withControlledEventTransport(
      new Request('https://admin.fancypalas.com/api/cart-tracking/shopify-webhooks/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: SHOPIFY_REAL_ID }),
      }),
    )
    let settled = false
    const responsePromise = POST(controlled.req).finally(() => {
      settled = true
    })
    await vi.waitFor(() => expect(controlled.pending.size).toBe(2))

    await Promise.resolve()
    expect(settled).toBe(false)

    for (const event of controlled.pending.values()) event.resolve()
    expect((await responsePromise).status).toBe(200)
  })

  it('returns a retryable failure when a refresh event cannot be durably emitted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ customer: { id: SHOPIFY_REAL_ID, email: 'jane@example.com' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )

    const { POST } = await routeModulePromise
    const controlled = withControlledEventTransport(
      new Request('https://admin.fancypalas.com/api/cart-tracking/shopify-webhooks/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: SHOPIFY_REAL_ID }),
      }),
    )
    const responsePromise = POST(controlled.req)
    await vi.waitFor(() => expect(controlled.pending.size).toBe(2))
    controlled.pending.get('contact.refresh-requested')?.reject(new Error('event transport unavailable'))
    controlled.pending.get('cart.refresh-requested')?.resolve()

    const response = await responsePromise
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('Internal Error')
  })

  it('fails before the upsert when the durable event transport is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ customer: { id: SHOPIFY_REAL_ID, email: 'jane@example.com' } }),
      ),
    )

    const { POST } = await routeModulePromise
    const request = attachRuntimeApp(
      new Request('https://admin.fancypalas.com/api/cart-tracking/shopify-webhooks/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: SHOPIFY_REAL_ID }),
      }),
    )

    const response = await POST(request)

    expect(response.status).toBe(500)
    expect(await response.text()).toBe('Event Transport Misconfigured')
    expect(upsertCalls).toEqual([])
  })

  it('returns 401 when Shopify cannot find the customer id', async () => {
    const fetchMock = vi.fn(async () => new Response('not found', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await routeModulePromise
    const req = new Request('https://admin.fancypalas.com/api/cart-tracking/shopify-webhooks/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '9999999' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    expect(upsertCalls.length).toBe(0)
  })

  it('returns 409 and emits nothing when the email belongs to another Shopify identity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            customer: {
              id: SHOPIFY_REAL_ID,
              email: 'conflict@example.com',
              first_name: 'Jane',
              last_name: 'Doe',
              phone: null,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )

    const { POST } = await routeModulePromise
    const req = new Request('https://admin.fancypalas.com/api/cart-tracking/shopify-webhooks/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: SHOPIFY_REAL_ID }),
    })
    const res = await POST(withRuntimeApp(req))

    expect(res.status).toBe(409)
    expect(await res.text()).toBe('Identity Conflict')
    expect(emittedEvents).toEqual([])
  })

  it('returns 400 on malformed JSON body', async () => {
    const { POST } = await routeModulePromise
    const req = new Request('https://admin.fancypalas.com/api/cart-tracking/shopify-webhooks/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json{',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when payload has no id', async () => {
    const { POST } = await routeModulePromise
    const req = new Request('https://admin.fancypalas.com/api/cart-tracking/shopify-webhooks/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ no_id: true }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
