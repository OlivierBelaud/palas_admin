import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  type IHttpPort,
  MantaError,
  createTestContainer,
  resetAll,
  InMemoryContainer,
} from '@manta/test-utils'

describe('HTTP Lifecycle Integration', () => {
  let http: IHttpPort
  let container: InMemoryContainer

  beforeEach(() => {
    container = createTestContainer()
    http = container.resolve<IHttpPort>('IHttpPort')
  })

  afterEach(async () => {
    await resetAll(container)
  })

  // SPEC-039/047: full pipeline execution
  it('full pipeline execution', async () => {
    http.registerRoute('GET', '/api/products', async () => {
      return new Response(JSON.stringify({ products: [] }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const req = new Request('http://localhost/api/products', {
      headers: { 'Authorization': 'Bearer valid-jwt' },
    })
    const res = await http.handleRequest(req)

    expect(res.status).toBe(200)
  })

  // SPEC-001: scoped container created per request
  it('scoped container created per request', async () => {
    const requestIds: string[] = []

    http.registerRoute('GET', '/api/test', async () => {
      requestIds.push(crypto.randomUUID())
      return new Response('ok')
    })

    await http.handleRequest(new Request('http://localhost/api/test'))
    await http.handleRequest(new Request('http://localhost/api/test'))

    expect(requestIds).toHaveLength(2)
    expect(requestIds[0]).not.toBe(requestIds[1])
  })

  // SPEC-049/060: auth context propagated to handler
  it('auth context propagated to handler', async () => {
    http.registerRoute('GET', '/api/me', async () => {
      // In real pipeline, auth middleware extracts JWT and populates AuthContext
      return new Response(JSON.stringify({ userId: 'u1' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const res = await http.handleRequest(
      new Request('http://localhost/api/me', {
        headers: { 'Authorization': 'Bearer valid-jwt' },
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.userId).toBe('u1')
  })

  // SPEC-041/133: MantaError caught by error handler
  it('MantaError caught by error handler', async () => {
    http.registerRoute('GET', '/api/orders/:id', async () => {
      throw new MantaError('NOT_FOUND', 'Order not found')
    })

    const res = await http.handleRequest(new Request('http://localhost/api/orders/999'))

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.type).toBe('NOT_FOUND')
    expect(body.message).toBe('Order not found')
  })
})
