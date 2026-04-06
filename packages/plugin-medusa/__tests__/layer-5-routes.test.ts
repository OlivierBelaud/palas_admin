// Layer 5: Route discovery tests

import { beforeAll, describe, expect, it } from 'vitest'
import { clearAlerts, getAlerts } from '../src/_internal/alerts'
import { countEndpoints, type DiscoveredRoute, discoverRoutes } from '../src/_internal/discovery/routes'

describe('layer-5: routes', () => {
  let routes: DiscoveredRoute[]

  beforeAll(() => {
    clearAlerts()
    routes = discoverRoutes()
  })

  it('discovers >= 290 route files', () => {
    expect(routes.length).toBeGreaterThanOrEqual(290)
  })

  it('discovers >= 440 HTTP endpoints', () => {
    const total = countEndpoints(routes)
    expect(total).toBeGreaterThanOrEqual(440)
  })

  it('admin routes >= 230', () => {
    const admin = routes.filter((r) => r.namespace === 'admin')
    expect(admin.length).toBeGreaterThanOrEqual(230)
  })

  it('store routes >= 40', () => {
    const store = routes.filter((r) => r.namespace === 'store')
    expect(store.length).toBeGreaterThanOrEqual(40)
  })

  it('auth routes >= 5', () => {
    const auth = routes.filter((r) => r.namespace === 'auth')
    expect(auth.length).toBeGreaterThanOrEqual(5)
  })

  it('GET /admin/products route exists and has GET export', () => {
    const productRoute = routes.find((r) => r.path === '/admin/products')
    expect(productRoute).toBeDefined()
    expect(productRoute!.methods).toContain('GET')
  })

  it('POST /admin/products route exists and has POST export', () => {
    const productRoute = routes.find((r) => r.path === '/admin/products')
    expect(productRoute).toBeDefined()
    expect(productRoute!.methods).toContain('POST')
  })

  it('GET /store/products route exists', () => {
    const storeProducts = routes.find((r) => r.path === '/store/products')
    expect(storeProducts).toBeDefined()
    expect(storeProducts!.methods).toContain('GET')
  })

  it('no error-level alerts', () => {
    const errors = getAlerts('route').filter((a) => a.level === 'error')
    expect(errors).toHaveLength(0)
  })
})
