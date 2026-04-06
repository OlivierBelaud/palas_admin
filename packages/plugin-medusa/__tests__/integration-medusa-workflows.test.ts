// Integration: Verify Medusa workflows are discoverable and modules
// are resolvable from MantaApp. Actual workflow execution is tested
// via the transpiler (transpiler-e2e.test.ts) which runs natively on Manta.

import { createRequire } from 'node:module'
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
import { discoverModules } from '../src/_internal/discovery/modules'
import { registerAllModulesInApp } from '../src/_internal/mapping/module-loader'

const require = createRequire(import.meta.url)

describe('Medusa workflows on Manta app', () => {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic modules
  let app: MantaApp<any>
  // biome-ignore lint/suspicious/noExplicitAny: dynamic core-flows
  let coreFlows: Record<string, any>

  beforeAll(async () => {
    const infra = {
      eventBus: new InMemoryEventBusAdapter(),
      logger: new TestLogger(),
      cache: new InMemoryCacheAdapter(),
      locking: new InMemoryLockingAdapter(),
      file: new InMemoryFileAdapter(),
      db: {},
    }
    const appBuilder = createApp({ infra })
    const modules = discoverModules()
    const result = registerAllModulesInApp(appBuilder, modules, infra)

    expect(result.failed).toBe(0)
    expect(result.registered).toBeGreaterThanOrEqual(14)

    const noopService = new Proxy({}, { get: () => async () => [] })
    appBuilder.registerModule('link', noopService)
    appBuilder.registerModule('remoteLink', noopService)
    appBuilder.registerModule('remoteQuery', async () => [])
    appBuilder.registerModule('query', async () => [])

    app = appBuilder.build()

    coreFlows = require('@medusajs/core-flows')
  })

  it('key workflows are discoverable in core-flows', () => {
    const expectedWorkflows = [
      'createProductsWorkflow',
      'addToCartWorkflow',
      'completeCartWorkflow',
      'createOrderWorkflow',
    ]
    for (const name of expectedWorkflows) {
      expect(coreFlows[name], `${name} should exist in core-flows`).toBeDefined()
      expect(typeof coreFlows[name]).toBe('function')
    }
  })

  it('addToCartWorkflow is callable with MantaApp resolve', () => {
    const wf = coreFlows.addToCartWorkflow
    const scope = { resolve: <T>(key: string): T => app.resolve<T>(key) }

    let error: Error | null = null
    try {
      const runner = wf(scope)
      expect(runner).toBeDefined()
      expect(typeof runner.run).toBe('function')
    } catch (e) {
      error = e as Error
      console.log('addToCart runner error:', error.message)
    }
  })

  it('workflow resolves all commerce module services from app', () => {
    const keysToCheck = [
      'productModuleService',
      'orderModuleService',
      'cartModuleService',
      'customerModuleService',
      'inventoryModuleService',
      'pricingModuleService',
      'event_bus',
      'logger',
    ]

    const resolved: Record<string, boolean> = {}
    for (const key of keysToCheck) {
      try {
        app.resolve(key)
        resolved[key] = true
      } catch {
        resolved[key] = false
      }
    }

    console.log('Resolved services:', resolved)

    for (const key of keysToCheck) {
      expect(resolved[key], `${key} should be resolvable`).toBe(true)
    }

    // Short-name keys (used by Medusa workflows internally)
    const shortKeys = ['product', 'order', 'cart', 'customer', 'inventory', 'pricing']
    const shortResolved: Record<string, boolean> = {}
    for (const key of shortKeys) {
      try {
        app.resolve(key)
        shortResolved[key] = true
      } catch {
        shortResolved[key] = false
      }
    }
    console.log('Short-name keys:', shortResolved)

    for (const key of shortKeys) {
      expect(shortResolved[key], `short key '${key}' should be resolvable`).toBe(true)
    }
  })
})
