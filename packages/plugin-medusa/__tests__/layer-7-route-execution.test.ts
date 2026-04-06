// Layer 7: Route execution tests — verifies end-to-end Medusa route handling
// with MedusaScope, MedusaQueryAdapter, middlewares, and auth context.

import {
  createTestMantaApp,
  InMemoryCacheAdapter,
  InMemoryEventBusAdapter,
  InMemoryFileAdapter,
  InMemoryLockingAdapter,
  InMemoryRepository,
  TestLogger,
} from '@manta/core'
import { beforeAll, describe, expect, it } from 'vitest'
import { clearAlerts } from '../src/_internal/alerts'
import { createRemoteQueryCallable, MedusaQueryAdapter } from '../src/_internal/mapping/query-adapter'
import { applyMiddlewares, MedusaScope, wrapMedusaRouteHandler } from '../src/_internal/mapping/route-bridge'

describe('layer-7: route execution', () => {
  // biome-ignore lint/suspicious/noExplicitAny: test
  let app: any
  let scope: MedusaScope
  // biome-ignore lint/suspicious/noExplicitAny: test
  let queryAdapter: any
  // biome-ignore lint/suspicious/noExplicitAny: test
  let remoteQuery: any

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

    // Register a mock product module service
    const productRepo = new InMemoryRepository()
    const productService = {
      async list(filters: Record<string, unknown>, config: Record<string, unknown>) {
        return productRepo.find({ where: filters, limit: config?.take as number, offset: config?.skip as number })
      },
      async listAndCount(filters: Record<string, unknown>, config: Record<string, unknown>) {
        return productRepo.findAndCount({
          where: filters,
          limit: config?.take as number,
          offset: config?.skip as number,
        })
      },
      async retrieve(id: string) {
        const results = await productRepo.find({ where: { id } })
        return results[0] ?? null
      },
      async create(data: Record<string, unknown>) {
        return productRepo.create(Array.isArray(data) ? data : [data])
      },
    }

    // Seed some products
    productRepo.create([
      { id: 'prod_1', title: 'Widget', status: 'published' },
      { id: 'prod_2', title: 'Gadget', status: 'published' },
      { id: 'prod_3', title: 'Doohickey', status: 'draft' },
    ])

    app.register('product', productService)

    // Register a mock customer module
    const customerService = {
      async listAndCount() {
        return [[{ id: 'cust_1', name: 'Alice' }], 1]
      },
    }
    app.register('customer', customerService)

    // Create query adapter + remoteQuery
    queryAdapter = new MedusaQueryAdapter(app.modules)
    remoteQuery = createRemoteQueryCallable(app.modules)

    // Create scope
    scope = new MedusaScope(app, queryAdapter, remoteQuery, null)
  })

  // ── MedusaQueryAdapter tests ─────────────────

  // RE-01 — query.graph() returns { data, metadata } format
  it('RE-01: query.graph() returns Medusa format', async () => {
    const result = await queryAdapter.graph({
      entity: 'product',
      pagination: { limit: 10, offset: 0 },
    })

    expect(result).toHaveProperty('data')
    expect(result).toHaveProperty('metadata')
    expect(result.metadata).toHaveProperty('count')
    expect(result.metadata).toHaveProperty('skip', 0)
    expect(result.metadata).toHaveProperty('take', 10)
    expect(Array.isArray(result.data)).toBe(true)
    expect(result.data.length).toBeGreaterThanOrEqual(3)
  })

  // RE-02 — remoteQuery is callable and returns rows with metadata
  it('RE-02: remoteQuery returns rows with metadata', async () => {
    const result = await remoteQuery({
      __value: {
        product: {
          __args: { filters: {} },
          fields: ['id', 'title'],
        },
      },
    })

    expect(Array.isArray(result)).toBe(true)
    expect(result.metadata).toBeDefined()
    expect(result.metadata.count).toBeGreaterThanOrEqual(3)
  })

  // RE-03 — remoteQuery with direct object (no __value)
  it('RE-03: remoteQuery works without __value wrapper', async () => {
    const result = await remoteQuery({
      customer: {
        __args: {},
      },
    })

    expect(Array.isArray(result)).toBe(true)
    expect(result.metadata).toBeDefined()
  })

  // ── MedusaScope tests ─────────────────────────

  // RE-04 — scope.resolve('query') returns MedusaQueryAdapter
  it('RE-04: scope resolves query to MedusaQueryAdapter', () => {
    const query = scope.resolve('query')
    expect(query).toBe(queryAdapter)
    expect(typeof (query as MedusaQueryAdapter).graph).toBe('function')
  })

  // RE-05 — scope.resolve('remoteQuery') is callable
  it('RE-05: scope resolves remoteQuery as callable', () => {
    const rq = scope.resolve('remoteQuery')
    expect(typeof rq).toBe('function')
  })

  // RE-06 — scope.resolve('product') returns module service
  it('RE-06: scope resolves module service by name', () => {
    const product = scope.resolve('product')
    expect(product).toBeDefined()
    expect(typeof (product as Record<string, unknown>).list).toBe('function')
  })

  // RE-07 — scope.resolve('productModuleService') aliases to module
  it('RE-07: scope resolves xxxModuleService alias', () => {
    const product = scope.resolve('productModuleService')
    expect(product).toBeDefined()
    expect(product).toBe(scope.resolve('product'))
  })

  // RE-08 — scope.resolve('configModule') returns project config
  it('RE-08: scope resolves configModule', () => {
    // biome-ignore lint/suspicious/noExplicitAny: test
    const config = scope.resolve<any>('configModule')
    expect(config).toBeDefined()
    expect(config.projectConfig).toBeDefined()
    expect(config.projectConfig.jwt_secret).toBeDefined()
  })

  // RE-09 — scope.resolve('logger') returns logger
  it('RE-09: scope resolves logger', () => {
    const logger = scope.resolve('logger')
    expect(logger).toBeDefined()
    expect(logger).toBe(app.infra.logger)
  })

  // RE-10 — scope.createScope() returns self
  it('RE-10: scope.createScope() returns self', () => {
    expect(scope.createScope()).toBe(scope)
  })

  // ── Route handler with scope ──────────────────

  // RE-11 — GET handler with query.graph() (Pattern A/B)
  it('RE-11: GET handler uses query.graph() via scope', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: Medusa handler
    const handler = async (req: any, res: any) => {
      const query = req.scope.resolve('query')
      const result = await query.graph({ entity: 'product', pagination: { limit: 10 } })
      res.json({ products: result.data, count: result.metadata.count })
    }

    const wrapped = wrapMedusaRouteHandler(handler, app, { scope })
    const response = await wrapped(new Request('http://localhost/admin/products'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.products.length).toBeGreaterThanOrEqual(3)
    expect(body.count).toBeGreaterThanOrEqual(3)
  })

  // RE-12 — GET handler with remoteQuery (Pattern A)
  it('RE-12: GET handler uses remoteQuery via scope', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: Medusa handler
    const handler = async (req: any, res: any) => {
      const remoteQuery = req.scope.resolve('remoteQuery')
      const result = await remoteQuery({
        __value: { product: { __args: { filters: {} } } },
      })
      res.json({ products: result, count: result.metadata.count })
    }

    const wrapped = wrapMedusaRouteHandler(handler, app, { scope })
    const response = await wrapped(new Request('http://localhost/admin/products'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.products.length).toBeGreaterThanOrEqual(3)
  })

  // RE-13 — POST handler with workflow pattern (Pattern C)
  it('RE-13: POST handler simulates workflow via scope', async () => {
    // Simulate a workflow that uses container.resolve
    // biome-ignore lint/suspicious/noExplicitAny: Medusa handler
    const handler = async (req: any, res: any) => {
      const productService = req.scope.resolve('product')
      const created = await productService.create({ id: 'prod_new', title: req.body.title })
      res.status(201).json({ product: created })
    }

    const wrapped = wrapMedusaRouteHandler(handler, app, { scope })
    const request = new Request('http://localhost/admin/products', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })
    Object.defineProperty(request, 'validatedBody', { value: { title: 'New Widget' } })

    const response = await wrapped(request)
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.product).toBeDefined()
  })

  // RE-14 — Handler with auth_context (Pattern with auth)
  it('RE-14: handler receives auth_context', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: Medusa handler
    const handler = async (req: any, res: any) => {
      res.json({
        actor_id: req.auth_context?.actor_id,
        actor_type: req.auth_context?.actor_type,
        auth_identity_id: req.auth_context?.auth_identity_id,
      })
    }

    const wrapped = wrapMedusaRouteHandler(handler, app, { scope })
    const request = new Request('http://localhost/admin/products', { method: 'POST' })
    Object.defineProperty(request, 'authContext', {
      value: {
        actor_id: 'user_admin_1',
        actor_type: 'user',
        auth_identity_id: 'auth_id_1',
        app_metadata: { role: 'admin' },
      },
    })

    const response = await wrapped(request)
    const body = await response.json()
    expect(body.actor_id).toBe('user_admin_1')
    expect(body.actor_type).toBe('user')
    expect(body.auth_identity_id).toBe('auth_id_1')
  })

  // RE-15 — Middleware execution before handler
  it('RE-15: middlewares run before handler', async () => {
    const executionOrder: string[] = []

    // biome-ignore lint/suspicious/noExplicitAny: Express middleware
    const middleware1 = (req: any, _res: any, next: () => void) => {
      executionOrder.push('mw1')
      req.queryConfig = { fields: ['id', 'title'] }
      next()
    }

    // biome-ignore lint/suspicious/noExplicitAny: Express middleware
    const middleware2 = (req: any, _res: any, next: () => void) => {
      executionOrder.push('mw2')
      req.filterableFields = { status: 'published' }
      next()
    }

    // biome-ignore lint/suspicious/noExplicitAny: Medusa handler
    const handler = async (req: any, res: any) => {
      executionOrder.push('handler')
      res.json({
        fields: req.queryConfig?.fields,
        filters: req.filterableFields,
      })
    }

    const wrapped = wrapMedusaRouteHandler(handler, app, {
      scope,
      middlewares: [middleware1, middleware2],
    })
    const response = await wrapped(new Request('http://localhost/admin/products'))
    const body = await response.json()

    expect(executionOrder).toEqual(['mw1', 'mw2', 'handler'])
    expect(body.fields).toEqual(['id', 'title'])
    expect(body.filters).toEqual({ status: 'published' })
  })

  // RE-16 — scope.resolve unknown key returns undefined (no throw)
  it('RE-16: scope resolves unknown key gracefully', () => {
    const result = scope.resolve('nonExistentService')
    expect(result).toBeUndefined()
  })

  // RE-17 — scope.register() adds extra key
  it('RE-17: scope.register() adds extra resolvable key', () => {
    const testScope = new MedusaScope(app, queryAdapter, remoteQuery, null)
    testScope.register('customService', { hello: 'world' })
    // biome-ignore lint/suspicious/noExplicitAny: test
    const resolved = testScope.resolve<any>('customService')
    expect(resolved.hello).toBe('world')
  })

  // RE-18 — error in handler maps status code from error type
  it('RE-18: error type maps to HTTP status', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: Medusa handler
    const handler = async (_req: any, _res: any) => {
      const err = new Error('Product not found')
      ;(err as unknown as Record<string, unknown>).type = 'NOT_FOUND'
      throw err
    }

    const wrapped = wrapMedusaRouteHandler(handler, app, { scope })
    const response = await wrapped(new Request('http://localhost/admin/products/missing'))

    expect(response.status).toBe(404)
  })

  // RE-19 — handler service direct pattern (Pattern D)
  it('RE-19: handler resolves service directly via scope', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: Medusa handler
    const handler = async (req: any, res: any) => {
      const customerService = req.scope.resolve('customer')
      const [customers, count] = await customerService.listAndCount()
      res.json({ customers, count })
    }

    const wrapped = wrapMedusaRouteHandler(handler, app, { scope })
    const response = await wrapped(new Request('http://localhost/admin/customers'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.customers).toHaveLength(1)
    expect(body.count).toBe(1)
  })

  // RE-20 — async middleware errors are caught
  it('RE-20: async middleware error returns 500', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: Express middleware
    const failingMiddleware = async (_req: any, _res: any, _next: () => void) => {
      throw new Error('Middleware failed')
    }

    // biome-ignore lint/suspicious/noExplicitAny: Medusa handler
    const handler = async (_req: any, res: any) => {
      res.json({ ok: true })
    }

    const wrapped = wrapMedusaRouteHandler(handler, app, {
      scope,
      middlewares: [failingMiddleware],
    })
    const response = await wrapped(new Request('http://localhost/test'))

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.message).toContain('Middleware failed')
  })
})
