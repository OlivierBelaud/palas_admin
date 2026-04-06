// Integration test: Register Medusa COMMERCE modules into MantaApp.

import {
  createApp,
  InMemoryCacheAdapter,
  InMemoryEventBusAdapter,
  InMemoryFileAdapter,
  InMemoryLockingAdapter,
  type MantaApp,
  TestLogger,
} from '@manta/core'
import { beforeAll, describe, expect, it } from 'vitest'
import { clearAlerts, getAlerts } from '../src/_internal/alerts'
import { type DiscoveredModule, discoverModules } from '../src/_internal/discovery/modules'
import { isCommerceModule, isFrameworkModule, registerAllModulesInApp } from '../src/_internal/mapping/module-loader'

describe('integration: register Medusa commerce modules', () => {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic modules
  let app: MantaApp<any>
  let allModules: DiscoveredModule[]
  let commerceModules: DiscoveredModule[]
  let result: { registered: number; skipped: number; failed: number; errors: string[] }

  beforeAll(() => {
    clearAlerts()

    const eventBus = new InMemoryEventBusAdapter()
    const logger = new TestLogger()
    const cache = new InMemoryCacheAdapter()
    const locking = new InMemoryLockingAdapter()
    const file = new InMemoryFileAdapter()
    const infra = { eventBus, logger, cache, locking, file, db: {} }

    const appBuilder = createApp({ infra })

    allModules = discoverModules()
    result = registerAllModulesInApp(appBuilder, allModules, infra)
    commerceModules = allModules.filter((m) => isCommerceModule(m.name))

    app = appBuilder.build()
  })

  it('discovers modules (commerce + framework)', () => {
    expect(allModules.length).toBeGreaterThanOrEqual(20)
  })

  it('classifies commerce vs framework correctly', () => {
    const commerce = allModules.filter((m) => isCommerceModule(m.name))
    const framework = allModules.filter((m) => isFrameworkModule(m.name))

    expect(commerce.length).toBeGreaterThanOrEqual(14)
    expect(framework.length).toBeGreaterThanOrEqual(5)

    expect(isCommerceModule('product')).toBe(true)
    expect(isCommerceModule('order')).toBe(true)
    expect(isFrameworkModule('auth')).toBe(true)
    expect(isFrameworkModule('user')).toBe(true)
  })

  it('skips framework modules', () => {
    expect(result.skipped).toBeGreaterThanOrEqual(5)
  })

  it('registers all commerce modules without errors', () => {
    expect(result.failed).toBe(0)
    expect(result.registered).toBe(commerceModules.length)
  })

  it('each commerce module is accessible via app.modules', () => {
    for (const mod of commerceModules) {
      // biome-ignore lint/suspicious/noExplicitAny: dynamic module access
      const service = (app.modules as any)[mod.name]
      expect(service, `"${mod.name}" not in app.modules`).toBeDefined()
    }
  })

  it('each commerce module is resolvable by xxxModuleService (compat)', () => {
    for (const mod of commerceModules) {
      const service = app.resolve(`${mod.name}ModuleService`)
      expect(service, `"${mod.name}ModuleService" not resolvable`).toBeDefined()
    }
  })

  it('product module has all CRUD methods', () => {
    // biome-ignore lint/suspicious/noExplicitAny: dynamic method check
    const service = (app.modules as any).product
    expect(typeof service.retrieveProduct).toBe('function')
    expect(typeof service.listProducts).toBe('function')
    expect(typeof service.listAndCountProducts).toBe('function')
    expect(typeof service.createProducts).toBe('function')
    expect(typeof service.updateProducts).toBe('function')
    expect(typeof service.deleteProducts).toBe('function')
    expect(typeof service.softDeleteProducts).toBe('function')
    expect(typeof service.restoreProducts).toBe('function')
  })

  it('order module has CRUD methods', () => {
    // biome-ignore lint/suspicious/noExplicitAny: dynamic method check
    const service = (app.modules as any).order
    expect(typeof service.retrieveOrder).toBe('function')
    expect(typeof service.listOrders).toBe('function')
    expect(typeof service.createOrders).toBe('function')
  })

  it('event_bus resolved via app.resolve (compat)', () => {
    expect(app.resolve('event_bus')).toBe(app.infra.eventBus)
  })

  it('cache resolved via app.resolve (compat)', () => {
    expect(app.resolve('cache')).toBe(app.infra.cache)
  })

  it('no error-level alerts', () => {
    const errors = getAlerts('module').filter((a) => a.level === 'error')
    expect(errors).toHaveLength(0)
  })
})
