// SPEC-039 — H3Adapter conformance tests

import { H3Adapter } from '@manta/adapter-h3'
import { MantaError } from '@manta/core/errors'
import { beforeEach, describe, expect, it } from 'vitest'

describe('H3Adapter Conformance', () => {
  let adapter: H3Adapter

  beforeEach(() => {
    adapter = new H3Adapter({ port: 0, isDev: true })
  })

  // Route registration and handling
  it('registerRoute + handleRequest works for GET', async () => {
    adapter.registerRoute('GET', '/test', () => {
      return Response.json({ ok: true })
    })

    const res = await adapter.handleRequest(new Request('http://localhost/test'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('registerRoute + handleRequest works for POST', async () => {
    adapter.registerRoute('POST', '/items', (_req) => {
      return Response.json({ created: true }, { status: 201 })
    })

    const res = await adapter.handleRequest(
      new Request('http://localhost/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      }),
    )
    expect(res.status).toBe(201)
  })

  // 404 for unknown routes
  it('returns 404 for unregistered routes', async () => {
    const res = await adapter.handleRequest(new Request('http://localhost/unknown'))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.type).toBe('NOT_FOUND')
  })

  // Error handling — MantaError
  it('maps MantaError to correct HTTP status', async () => {
    adapter.registerRoute('GET', '/fail', () => {
      throw new MantaError('UNAUTHORIZED', 'Not logged in')
    })

    const res = await adapter.handleRequest(new Request('http://localhost/fail'))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.type).toBe('UNAUTHORIZED')
    expect(body.message).toBe('Not logged in')
  })

  // Error handling — unknown error
  it('maps unknown errors to 500', async () => {
    adapter.registerRoute('GET', '/crash', () => {
      throw new Error('oops')
    })

    const res = await adapter.handleRequest(new Request('http://localhost/crash'))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.type).toBe('UNEXPECTED_STATE')
  })

  // Health endpoints
  it('/health/live returns 200', async () => {
    const res = await adapter.handleRequest(new Request('http://localhost/health/live'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('alive')
    expect(typeof body.uptime_ms).toBe('number')
  })

  it('/health/ready returns 200', async () => {
    const res = await adapter.handleRequest(new Request('http://localhost/health/ready'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ready')
  })

  // Path params
  it('supports path parameters', async () => {
    adapter.registerRoute('GET', '/items/:id', (req) => {
      const url = new URL(req.url)
      return Response.json({ path: url.pathname })
    })

    const res = await adapter.handleRequest(new Request('http://localhost/items/123'))
    expect(res.status).toBe(200)
  })

  // DUPLICATE_ERROR → 422 (not 409 like in-memory)
  it('maps DUPLICATE_ERROR to 422', async () => {
    adapter.registerRoute('POST', '/dup', () => {
      throw new MantaError('DUPLICATE_ERROR', 'Already exists')
    })

    const res = await adapter.handleRequest(new Request('http://localhost/dup', { method: 'POST' }))
    expect(res.status).toBe(409)
  })
})
