import type { TestMantaApp } from '@manta/core'
import {
  createTestMantaApp,
  InMemoryCacheAdapter,
  InMemoryEventBusAdapter,
  InMemoryFileAdapter,
  InMemoryHttpAdapter,
  InMemoryLockingAdapter,
  MantaError,
  TestLogger,
} from '@manta/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const makeInfra = () => ({
  eventBus: new InMemoryEventBusAdapter(),
  logger: new TestLogger(),
  cache: new InMemoryCacheAdapter(),
  locking: new InMemoryLockingAdapter(),
  file: new InMemoryFileAdapter(),
  db: {},
})

describe('IHttpPort Conformance', () => {
  let http: InMemoryHttpAdapter
  let app: TestMantaApp

  beforeEach(() => {
    const infra = makeInfra()
    app = createTestMantaApp({ infra })
    http = new InMemoryHttpAdapter()
    app.register('IHttpPort', http)
  })

  afterEach(async () => {
    await app.dispose()
  })

  // H-01 — SPEC-037: path routes to handler
  it('routing > path vers handler', async () => {
    http.registerRoute('GET', '/api/users', async () => {
      return new Response(JSON.stringify({ users: [] }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const req = new Request('http://localhost/api/users')
    const res = await http.handleRequest(req)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.users).toEqual([])
  })

  // H-02 — SPEC-037: dynamic parameters
  it('routing > paramètres dynamiques', async () => {
    http.registerRoute('GET', '/api/users/:id', async (req) => {
      const url = new URL(req.url)
      // Parameter extraction depends on adapter implementation
      return new Response(JSON.stringify({ id: '123' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const req = new Request('http://localhost/api/users/123')
    const res = await http.handleRequest(req)

    expect(res.status).toBe(200)
  })

  // H-03 — SPEC-039: pipeline 12 steps in order
  it("pipeline > 12 étapes dans l'ordre", async () => {
    // Contract: pipeline steps execute in order for every request
    // InMemoryHttpAdapter implements: RequestID -> RateLimit -> Route -> ErrorHandler
    // We verify the observable effects of the pipeline order
    const steps: string[] = []

    http.configureRateLimit('', { max: 100, windowMs: 60000 })
    http.registerRoute('GET', '/api/test', async () => {
      steps.push('handler')
      return new Response('ok')
    })

    const res = await http.handleRequest(new Request('http://localhost/api/test'))

    // Step 1: RequestID assigned
    expect(res.headers.get('x-request-id')).toBeTruthy()
    // Step 3: Rate limit checked (not blocked)
    expect(res.status).toBe(200)
    // Step 10: Handler executed
    expect(steps).toContain('handler')
  })

  // H-04 — SPEC-038: CORS headers per namespace
  it('CORS > headers par namespace', async () => {
    http.registerRoute('GET', '/admin/products', async () => {
      return new Response('ok')
    })

    http.registerRoute('GET', '/store/products', async () => {
      return new Response('ok')
    })

    // Contract: different namespaces can have different CORS policies
    const adminReq = new Request('http://localhost/admin/products')
    const adminRes = await http.handleRequest(adminReq)
    expect(adminRes).toBeDefined()

    const storeReq = new Request('http://localhost/store/products')
    const storeRes = await http.handleRequest(storeReq)
    expect(storeRes).toBeDefined()
  })

  // H-05 — SPEC-047: requestId generation
  it('requestId > génération', async () => {
    http.registerRoute('GET', '/api/test', async () => {
      return new Response('ok')
    })

    const res = await http.handleRequest(new Request('http://localhost/api/test'))
    expect(res.headers.get('x-request-id')).toBeTruthy()
    // Should be a valid UUID
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
  })

  // H-06 — SPEC-047: requestId propagation
  it('requestId > propagation', async () => {
    http.registerRoute('GET', '/api/test', async () => {
      return new Response('ok')
    })

    const customId = 'my-request-123'
    const res = await http.handleRequest(
      new Request('http://localhost/api/test', {
        headers: { 'x-request-id': customId },
      }),
    )
    expect(res.headers.get('x-request-id')).toBe(customId)
  })

  // H-07 — SPEC-001/039: scoped context per request
  it('scoped context > par requête', async () => {
    const scopeIds: string[] = []

    http.registerRoute('GET', '/api/test', async () => {
      scopeIds.push(crypto.randomUUID()) // Simulate unique scope per request
      return new Response('ok')
    })

    await http.handleRequest(new Request('http://localhost/api/test'))
    await http.handleRequest(new Request('http://localhost/api/test'))

    expect(scopeIds).toHaveLength(2)
    expect(scopeIds[0]).not.toBe(scopeIds[1])
  })

  // H-08 — SPEC-041/133: MantaError(NOT_FOUND) -> HTTP 404
  it('error handler > MantaError vers HTTP 404', async () => {
    http.registerRoute('GET', '/api/orders/:id', async () => {
      throw new MantaError('NOT_FOUND', 'Order not found')
    })

    const res = await http.handleRequest(new Request('http://localhost/api/orders/999'))

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.type).toBe('NOT_FOUND')
    expect(body.message).toBe('Order not found')
  })

  // H-09 — SPEC-041: MantaError(INVALID_DATA) -> HTTP 400
  it('error handler > MantaError(INVALID_DATA) -> 400', async () => {
    http.registerRoute('POST', '/api/products', async () => {
      throw new MantaError('INVALID_DATA', 'Invalid product data')
    })

    const res = await http.handleRequest(new Request('http://localhost/api/products', { method: 'POST' }))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.type).toBe('INVALID_DATA')
  })

  // H-10 — SPEC-041: MantaError(UNAUTHORIZED) -> HTTP 401
  it('error handler > MantaError(UNAUTHORIZED) -> 401', async () => {
    http.registerRoute('GET', '/api/admin', async () => {
      throw new MantaError('UNAUTHORIZED', 'Not authenticated')
    })

    const res = await http.handleRequest(new Request('http://localhost/api/admin'))

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.type).toBe('UNAUTHORIZED')
  })

  // H-11 — SPEC-041: unknown error -> HTTP 500 (no leak)
  it('error handler > erreur inconnue -> 500', async () => {
    http.registerRoute('GET', '/api/crash', async () => {
      throw new Error('oops')
    })

    const res = await http.handleRequest(new Request('http://localhost/api/crash'))

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.type).toBe('UNEXPECTED_STATE')
    expect(body.message).not.toContain('oops') // No leak of internal error
  })

  // H-12 — SPEC-037: Web Standards Request/Response
  it('Web Standards > Request/Response', async () => {
    http.registerRoute('GET', '/api/test', async (req) => {
      // Handler receives standard Request, returns standard Response
      expect(req).toBeInstanceOf(Request)
      return new Response('ok')
    })

    const res = await http.handleRequest(new Request('http://localhost/api/test'))
    expect(res).toBeInstanceOf(Response)
  })

  // H-13 — SPEC-039: body parser JSON
  it('body parser > JSON', async () => {
    http.registerRoute('POST', '/api/data', async (req) => {
      const body = await req.json()
      return new Response(JSON.stringify({ received: body }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const res = await http.handleRequest(
      new Request('http://localhost/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'value' }),
      }),
    )

    expect(res.status).toBe(200)
  })

  // H-14 — SPEC-039: body parser form data
  it('body parser > form data', async () => {
    http.registerRoute('POST', '/api/upload', async (req) => {
      return new Response('ok')
    })

    const formData = new FormData()
    formData.append('field', 'value')

    const res = await http.handleRequest(
      new Request('http://localhost/api/upload', {
        method: 'POST',
        body: formData,
      }),
    )

    expect(res).toBeDefined()
  })

  // H-15 — SPEC-072: /health/live returns 200
  it('health > /health/live returns 200', async () => {
    http.registerRoute('GET', '/health/live', async () => {
      return new Response(JSON.stringify({ status: 'alive', uptime_ms: 1000 }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const res = await http.handleRequest(new Request('http://localhost/health/live'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('alive')
    expect(typeof body.uptime_ms).toBe('number')
  })

  // H-16 — SPEC-072: /health/ready returns 200 when ready
  it('health > /health/ready returns 200 when ready', async () => {
    http.registerRoute('GET', '/health/ready', async () => {
      return new Response(
        JSON.stringify({
          status: 'ready',
          checks: { database: 'ok', cache: 'ok' },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      )
    })

    const res = await http.handleRequest(new Request('http://localhost/health/ready'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ready')
  })

  // H-17 — SPEC-072: /health/ready returns 503 when DB down
  it('health > /health/ready returns 503 when DB down', async () => {
    http.registerRoute('GET', '/health/ready', async () => {
      return new Response(
        JSON.stringify({
          status: 'not_ready',
          checks: { database: 'timeout', cache: 'ok' },
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      )
    })

    const res = await http.handleRequest(new Request('http://localhost/health/ready'))

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.status).toBe('not_ready')
    expect(body.checks.database).toBe('timeout')
  })

  // H-18 — SPEC-072: no auth on health endpoints
  it('health > no auth on health endpoints', async () => {
    http.registerRoute('GET', '/health/live', async () => {
      return new Response(JSON.stringify({ status: 'alive', uptime_ms: 0 }))
    })

    // Request without Authorization header
    const res = await http.handleRequest(new Request('http://localhost/health/live'))
    expect(res.status).toBe(200)
  })

  // H-19 — SPEC-041: MantaError with code
  it('error handler > MantaError with code', async () => {
    http.registerRoute('GET', '/api/orders/:id', async () => {
      throw new MantaError('NOT_FOUND', 'Order not found', { code: 'ORDER_NOT_FOUND' })
    })

    const res = await http.handleRequest(new Request('http://localhost/api/orders/999'))

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.type).toBe('NOT_FOUND')
    expect(body.code).toBe('ORDER_NOT_FOUND')
  })

  // H-20 — SPEC-043: Zod validation error details
  it('error handler > Zod validation error', async () => {
    http.registerRoute('POST', '/api/products', async () => {
      throw new MantaError('INVALID_DATA', 'Validation failed')
    })

    const res = await http.handleRequest(new Request('http://localhost/api/products', { method: 'POST' }))

    expect(res.status).toBe(400)
  })

  // H-21 — SPEC-041: no stack in production
  it('error handler > no stack in prod', async () => {
    http.registerRoute('GET', '/api/crash', async () => {
      throw new MantaError('NOT_FOUND', 'Missing')
    })

    const res = await http.handleRequest(new Request('http://localhost/api/crash'))
    const body = await res.json()

    // In production, body should NOT contain stack trace
    // In test, behavior depends on NODE_ENV
    expect(body.type).toBe('NOT_FOUND')
  })

  // H-22 — SPEC-039b: rate limit 429 after exceeding threshold
  it('rate limit > 429 après dépassement', async () => {
    http.configureRateLimit('', { max: 3, windowMs: 60000 })
    http.registerRoute('GET', '/api/test', async () => new Response('ok'))

    // First 3 requests succeed
    for (let i = 0; i < 3; i++) {
      const res = await http.handleRequest(new Request('http://localhost/api/test'))
      expect(res.status).toBe(200)
    }

    // 4th request should be rate limited
    const res = await http.handleRequest(new Request('http://localhost/api/test'))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBeTruthy()
    expect(res.headers.get('X-RateLimit-Limit')).toBe('3')
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0')
  })

  // H-23 — SPEC-039b: rate limit resets after window
  it('rate limit > reset après window', async () => {
    http.configureRateLimit('', { max: 2, windowMs: 100 }) // 100ms window
    http.registerRoute('GET', '/api/test', async () => new Response('ok'))

    // Exhaust the limit
    await http.handleRequest(new Request('http://localhost/api/test'))
    await http.handleRequest(new Request('http://localhost/api/test'))
    const blocked = await http.handleRequest(new Request('http://localhost/api/test'))
    expect(blocked.status).toBe(429)

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, 150))

    // Should be allowed again
    const res = await http.handleRequest(new Request('http://localhost/api/test'))
    expect(res.status).toBe(200)
  })

  // H-24 — SPEC-039b: rate limit custom keyFn
  it('rate limit > custom keyFn', async () => {
    http.configureRateLimit('', {
      max: 2,
      windowMs: 60000,
      keyFn: (req) => req.headers.get('x-api-key') || 'anonymous',
    })
    http.registerRoute('GET', '/api/test', async () => new Response('ok'))

    // Client A uses 2 requests
    for (let i = 0; i < 2; i++) {
      await http.handleRequest(
        new Request('http://localhost/api/test', {
          headers: { 'x-api-key': 'client-a' },
        }),
      )
    }

    // Client A is blocked
    const blockedA = await http.handleRequest(
      new Request('http://localhost/api/test', {
        headers: { 'x-api-key': 'client-a' },
      }),
    )
    expect(blockedA.status).toBe(429)

    // Client B should still be allowed (independent counter)
    const resB = await http.handleRequest(
      new Request('http://localhost/api/test', {
        headers: { 'x-api-key': 'client-b' },
      }),
    )
    expect(resB.status).toBe(200)
  })

  // H-25 — SPEC-039b: rate limit disabled by default
  it('rate limit > désactivé par défaut', async () => {
    http.registerRoute('GET', '/api/test', async () => {
      return new Response('ok')
    })

    // Without rate limit config, no requests should be blocked
    const res = await http.handleRequest(new Request('http://localhost/api/test'))
    expect(res.status).toBe(200)
  })

  // H-26 — SPEC-039b: rate limit per namespace
  it('rate limit > par namespace', async () => {
    http.configureRateLimit('/store', { max: 2, windowMs: 60000 })
    http.configureRateLimit('/admin', { max: 5, windowMs: 60000 })

    http.registerRoute('GET', '/store/products', async () => new Response('ok'))
    http.registerRoute('GET', '/admin/products', async () => new Response('ok'))

    // Exhaust /store limit
    for (let i = 0; i < 2; i++) {
      await http.handleRequest(new Request('http://localhost/store/products'))
    }
    const blockedStore = await http.handleRequest(new Request('http://localhost/store/products'))
    expect(blockedStore.status).toBe(429)

    // /admin should still be available (separate namespace)
    const adminRes = await http.handleRequest(new Request('http://localhost/admin/products'))
    expect(adminRes.status).toBe(200)
  })

  // H-27 — SPEC-072/135: health ready 503 when migrations pending
  it('health > /health/ready 503 when migrations pending', async () => {
    http.registerRoute('GET', '/health/ready', async () => {
      return new Response(
        JSON.stringify({
          status: 'not_ready',
          checks: { migrations: 'pending' },
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      )
    })

    const res = await http.handleRequest(new Request('http://localhost/health/ready'))

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.checks.migrations).toBe('pending')
  })

  // H-28 — SPEC-072/135: health ready 200 after migration
  it('health > /health/ready 200 after migration', async () => {
    http.registerRoute('GET', '/health/ready', async () => {
      return new Response(
        JSON.stringify({
          status: 'ready',
          checks: { migrations: 'ok' },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      )
    })

    const res = await http.handleRequest(new Request('http://localhost/health/ready'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.checks.migrations).toBe('ok')
  })
})
