// Layer 6: Route bridge tests — verifies Medusa route handler wrapping

import {
  createTestMantaApp,
  InMemoryCacheAdapter,
  InMemoryEventBusAdapter,
  InMemoryFileAdapter,
  InMemoryLockingAdapter,
  QueryService,
  TestLogger,
} from '@manta/core'
import { beforeAll, describe, expect, it } from 'vitest'
import { clearAlerts } from '../src/_internal/alerts'
import { discoverRoutes } from '../src/_internal/discovery/routes'
import { wrapMedusaRouteHandler } from '../src/_internal/mapping/route-bridge'

describe('layer-6: route bridge', () => {
  // biome-ignore lint/suspicious/noExplicitAny: test
  let app: any

  beforeAll(() => {
    clearAlerts()
    app = createTestMantaApp({
      infra: {
        eventBus: new InMemoryEventBusAdapter(),
        logger: new TestLogger(),
        cache: new InMemoryCacheAdapter(),
        locking: new InMemoryLockingAdapter(),
        file: new InMemoryFileAdapter(),
        db: null,
      },
    })
    // Register query service
    const queryService = new QueryService()
    queryService.registerResolver('product', async () => [
      { id: 'prod_1', title: 'Widget' },
      { id: 'prod_2', title: 'Gadget' },
    ])
    app.register('query', queryService)
  })

  // RB-01 — wrapMedusaRouteHandler wraps Express-style handler
  it('RB-01: wraps Express handler into Response', async () => {
    // Medusa-style handler
    // biome-ignore lint/suspicious/noExplicitAny: Medusa handler
    const medusaHandler = async (req: any, res: any) => {
      res.json({ message: 'hello', method: req.method })
    }

    const wrapped = wrapMedusaRouteHandler(medusaHandler, app)
    const response = await wrapped(new Request('http://localhost/test', { method: 'GET' }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.message).toBe('hello')
    expect(body.method).toBe('GET')
  })

  // RB-02 — handler gets req.scope.resolve
  it('RB-02: handler gets scope.resolve', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: Medusa handler
    const medusaHandler = async (req: any, res: any) => {
      const query = req.scope.resolve('query')
      const hasGraph = typeof query?.graph === 'function' || typeof query?.registerResolver === 'function'
      res.json({ hasQuery: !!query, hasGraph })
    }

    const wrapped = wrapMedusaRouteHandler(medusaHandler, app)
    const response = await wrapped(new Request('http://localhost/test'))
    const body = await response.json()
    expect(body.hasQuery).toBe(true)
  })

  // RB-03 — handler gets req.validatedBody
  it('RB-03: handler gets validatedBody', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: Medusa handler
    const medusaHandler = async (req: any, res: any) => {
      res.json({ body: req.validatedBody })
    }

    const wrapped = wrapMedusaRouteHandler(medusaHandler, app)
    const request = new Request('http://localhost/test', { method: 'POST' })
    Object.defineProperty(request, 'validatedBody', { value: { title: 'New Product' } })

    const response = await wrapped(request)
    const body = await response.json()
    expect(body.body.title).toBe('New Product')
  })

  // RB-04 — handler error returns 500
  it('RB-04: handler error returns 500', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: Medusa handler
    const medusaHandler = async (_req: any, _res: any) => {
      throw new Error('Something went wrong')
    }

    const wrapped = wrapMedusaRouteHandler(medusaHandler, app)
    const response = await wrapped(new Request('http://localhost/test'))

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.message).toContain('Something went wrong')
  })

  // RB-05 — handler gets req.params
  it('RB-05: handler gets URL params', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: Medusa handler
    const medusaHandler = async (req: any, res: any) => {
      res.json({ id: req.params.id })
    }

    const wrapped = wrapMedusaRouteHandler(medusaHandler, app)
    const request = new Request('http://localhost/admin/products/prod_123')
    Object.defineProperty(request, 'params', { value: { id: 'prod_123' } })

    const response = await wrapped(request)
    const body = await response.json()
    expect(body.id).toBe('prod_123')
  })

  // RB-06 — res.status(201).json() sets correct status
  it('RB-06: res.status().json() sets status code', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: Medusa handler
    const medusaHandler = async (_req: any, res: any) => {
      res.status(201).json({ created: true })
    }

    const wrapped = wrapMedusaRouteHandler(medusaHandler, app)
    const response = await wrapped(new Request('http://localhost/test', { method: 'POST' }))

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.created).toBe(true)
  })

  // RB-07 — route discovery finds 290+ routes (existing test from layer-5, validates bridge input)
  it('RB-07: route discovery feeds 290+ routes to bridge', () => {
    const routes = discoverRoutes()
    expect(routes.length).toBeGreaterThanOrEqual(290)
  })

  // RB-08 — handler gets req.query (URL query params)
  it('RB-08: handler gets URL query params', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: Medusa handler
    const medusaHandler = async (req: any, res: any) => {
      res.json({ limit: req.validatedQuery?.limit, offset: req.validatedQuery?.offset })
    }

    const wrapped = wrapMedusaRouteHandler(medusaHandler, app)
    const response = await wrapped(new Request('http://localhost/test?limit=10&offset=5'))
    const body = await response.json()
    expect(body.limit).toBe('10')
    expect(body.offset).toBe('5')
  })

  // RB-09 — handler gets req.auth_context from MantaRequest
  it('RB-09: handler gets auth_context', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: Medusa handler
    const medusaHandler = async (req: any, res: any) => {
      res.json({ actor_id: req.auth_context?.actor_id })
    }

    const wrapped = wrapMedusaRouteHandler(medusaHandler, app)
    const request = new Request('http://localhost/test')
    Object.defineProperty(request, 'authContext', {
      value: { actor_id: 'user_123', actor_type: 'user' },
    })

    const response = await wrapped(request)
    const body = await response.json()
    expect(body.actor_id).toBe('user_123')
  })
})
