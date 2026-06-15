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
vi.mock('../src/modules/contact/upsert-shopify-customer', () => ({
  upsertShopifyCustomer: vi.fn(async (_sql: unknown, customer: unknown) => {
    upsertCalls.push(customer)
    return { matched_via: 'inserted', contact_id: 'c-1', created: true, carts_reattached: 0 }
  }),
}))

// Import AFTER the mocks are registered.
const routeModulePromise = import('../src/modules/cart-tracking/api/shopify-webhooks/customers/route')

const SHOPIFY_REAL_ID = '1234567890'

beforeEach(() => {
  upsertCalls.length = 0
  // Force DATABASE_URL on so the route's getSql() returns a value.
  process.env.DATABASE_URL = 'postgres://test:test@localhost/test'
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = 'test-token'
  process.env.SHOPIFY_SHOP_DOMAIN = 'fancy-palas.myshopify.com'
})

function withRuntimeApp(req: Request): Request {
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
      emit: async () => {},
    },
    enumerable: true,
    configurable: true,
  })
  return req
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
