// Phase 4 — Pipeline HTTP steps conformance tests
// Tests for auth (step 6), body parsing 415 (step 5), scope (step 4),
// Zod validation (step 8), RBAC (step 10)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NitroAdapter } from '../src'
import { MantaError } from '@manta/core/errors'
import type { IContainer } from '@manta/core'
import type { z } from 'zod'

describe('Pipeline — Step 5: Body parsing (415)', () => {
  let adapter: NitroAdapter

  beforeEach(() => {
    adapter = new NitroAdapter({ port: 0, isDev: true })
  })

  afterEach(async () => {
    await adapter.close()
  })

  // HP-01 — POST with application/json is parsed
  it('HP-01 — POST with application/json body is parsed', async () => {
    adapter.registerRoute('POST', '/api/items', async (req) => {
      const body = (req as unknown as { validatedBody: unknown }).validatedBody
      return Response.json({ received: body })
    })

    const res = await adapter.handleRequest(
      new Request('http://localhost/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      }),
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.received).toEqual({ name: 'test' })
  })

  // HP-02 — GET has no body (undefined)
  it('HP-02 — GET requests have undefined body', async () => {
    adapter.registerRoute('GET', '/api/items', async (req) => {
      const body = (req as unknown as { validatedBody: unknown }).validatedBody
      return Response.json({ hasBody: body !== undefined })
    })

    const res = await adapter.handleRequest(new Request('http://localhost/api/items'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.hasBody).toBe(false)
  })
})

describe('Pipeline — Step 6: Auth', () => {
  let adapter: NitroAdapter

  beforeEach(() => {
    adapter = new NitroAdapter({ port: 0, isDev: true })
  })

  afterEach(async () => {
    await adapter.close()
  })

  // HP-03 — Auth context is injected when authVerifier is set
  it('HP-03 — valid auth token injects authContext', async () => {
    adapter.setAuthVerifier(async (token: string) => {
      if (token === 'valid-token') {
        return { actor_type: 'user', actor_id: 'user_123' }
      }
      return null
    })

    adapter.registerRoute('GET', '/admin/data', async (req) => {
      const authCtx = (req as unknown as { authContext?: unknown }).authContext
      return Response.json({ auth: authCtx })
    })

    const res = await adapter.handleRequest(
      new Request('http://localhost/admin/data', {
        headers: { Authorization: 'Bearer valid-token' },
      }),
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.auth).toEqual({ actor_type: 'user', actor_id: 'user_123' })
  })

  // HP-04 — /admin/* without auth returns 401
  it('HP-04 — /admin/ without auth returns 401 when authVerifier is set', async () => {
    adapter.setAuthVerifier(async () => null)

    adapter.registerRoute('GET', '/admin/protected', async () => {
      return Response.json({ secret: true })
    })

    const res = await adapter.handleRequest(
      new Request('http://localhost/admin/protected'),
    )
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.type).toBe('UNAUTHORIZED')
  })

  // HP-05 — /store/* auth is optional (no 401 without token)
  it('HP-05 — /store/ without auth succeeds (auth is optional)', async () => {
    adapter.setAuthVerifier(async () => null)

    adapter.registerRoute('GET', '/store/products', async () => {
      return Response.json({ products: [] })
    })

    const res = await adapter.handleRequest(
      new Request('http://localhost/store/products'),
    )
    expect(res.status).toBe(200)
  })

  // HP-06 — Invalid token on /admin returns 401
  it('HP-06 — invalid token on /admin returns 401', async () => {
    adapter.setAuthVerifier(async () => null)

    adapter.registerRoute('GET', '/admin/data', async () => {
      return Response.json({ ok: true })
    })

    const res = await adapter.handleRequest(
      new Request('http://localhost/admin/data', {
        headers: { Authorization: 'Bearer bad-token' },
      }),
    )
    expect(res.status).toBe(401)
  })

  // HP-07 — No authVerifier set = auth step is skipped
  it('HP-07 — no authVerifier = auth step skipped, request proceeds', async () => {
    // No setAuthVerifier called
    adapter.registerRoute('GET', '/admin/data', async () => {
      return Response.json({ ok: true })
    })

    const res = await adapter.handleRequest(
      new Request('http://localhost/admin/data'),
    )
    expect(res.status).toBe(200)
  })
})

describe('Pipeline — Step 8: Zod validation', () => {
  let adapter: NitroAdapter

  beforeEach(() => {
    adapter = new NitroAdapter({ port: 0, isDev: true })
  })

  afterEach(async () => {
    await adapter.close()
  })

  // HP-08 — Valid body passes Zod schema
  it('HP-08 — valid body passes Zod schema', async () => {
    adapter.registerRoute('POST', '/api/items', async (req) => {
      const body = (req as unknown as { validatedBody: unknown }).validatedBody
      return Response.json({ item: body })
    }, {
      bodySchema: {
        parse: (data: unknown) => {
          const d = data as { name?: string }
          if (!d || !d.name) throw new Error('name required')
          return d
        },
      },
    })

    const res = await adapter.handleRequest(
      new Request('http://localhost/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      }),
    )
    expect(res.status).toBe(200)
  })

  // HP-09 — Invalid body fails Zod schema with 400
  it('HP-09 — invalid body fails Zod schema with 400', async () => {
    adapter.registerRoute('POST', '/api/items', async () => {
      return Response.json({ ok: true })
    }, {
      bodySchema: {
        parse: (data: unknown) => {
          const d = data as { name?: string }
          if (!d || !d.name) {
            const err = new Error('Validation failed')
            ;(err as unknown as { issues: unknown[] }).issues = [
              { path: ['name'], message: 'Required' },
            ]
            throw err
          }
          return d
        },
      },
    })

    const res = await adapter.handleRequest(
      new Request('http://localhost/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.type).toBe('INVALID_DATA')
  })
})

describe('Pipeline — Step 10: RBAC (basic namespace check)', () => {
  let adapter: NitroAdapter

  beforeEach(() => {
    adapter = new NitroAdapter({ port: 0, isDev: true })
  })

  afterEach(async () => {
    await adapter.close()
  })

  // HP-10 — Admin route with admin actor passes RBAC
  it('HP-10 — admin actor on /admin route passes RBAC', async () => {
    adapter.setAuthVerifier(async () => ({ actor_type: 'user', actor_id: 'admin_1' }))
    adapter.enableRbac(true)

    adapter.registerRoute('GET', '/admin/data', async () => {
      return Response.json({ ok: true })
    })

    const res = await adapter.handleRequest(
      new Request('http://localhost/admin/data', {
        headers: { Authorization: 'Bearer admin-token' },
      }),
    )
    expect(res.status).toBe(200)
  })

  // HP-11 — RBAC disabled = no check (default)
  it('HP-11 — RBAC disabled by default, no check performed', async () => {
    adapter.registerRoute('GET', '/admin/data', async () => {
      return Response.json({ ok: true })
    })

    const res = await adapter.handleRequest(
      new Request('http://localhost/admin/data'),
    )
    expect(res.status).toBe(200)
  })
})
