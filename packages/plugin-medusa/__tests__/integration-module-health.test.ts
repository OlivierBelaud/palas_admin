// Health check: verify each commerce module is TRULY operational.

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
import { clearAlerts } from '../src/_internal/alerts'
import { type DiscoveredModule, discoverModules } from '../src/_internal/discovery/modules'
import { isCommerceModule, registerAllModulesInApp } from '../src/_internal/mapping/module-loader'

describe('module health: all commerce modules operational', () => {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic modules
  let app: MantaApp<any>
  let commerceModules: DiscoveredModule[]

  beforeAll(() => {
    clearAlerts()
    const infra = {
      eventBus: new InMemoryEventBusAdapter(),
      logger: new TestLogger(),
      cache: new InMemoryCacheAdapter(),
      locking: new InMemoryLockingAdapter(),
      file: new InMemoryFileAdapter(),
      db: {},
    }
    const appBuilder = createApp({ infra })
    const all = discoverModules()
    registerAllModulesInApp(appBuilder, all, infra)
    app = appBuilder.build()
    commerceModules = all.filter((m) => isCommerceModule(m.name))
  })

  const COMMERCE_WITH_ENTITIES = [
    { name: 'product', entity: 'Product', plural: 'Products', minEntities: 10 },
    { name: 'order', entity: 'Order', plural: 'Orders', minEntities: 20 },
    { name: 'cart', entity: 'Cart', plural: 'Carts', minEntities: 8 },
    { name: 'customer', entity: 'Customer', plural: 'Customers', minEntities: 3 },
    { name: 'payment', entity: 'Payment', plural: 'Payments', minEntities: 7 },
    { name: 'pricing', entity: 'Price', plural: 'Prices', minEntities: 5 },
    { name: 'fulfillment', entity: 'FulfillmentSet', plural: 'FulfillmentSets', minEntities: 10 },
    { name: 'promotion', entity: 'Promotion', plural: 'Promotions', minEntities: 6 },
    { name: 'inventory', entity: 'InventoryItem', plural: 'InventoryItems', minEntities: 3 },
    { name: 'sales-channel', entity: 'SalesChannel', plural: 'SalesChannels', minEntities: 1 },
    { name: 'tax', entity: 'TaxRate', plural: 'TaxRates', minEntities: 3 },
    { name: 'currency', entity: 'Currency', plural: 'Currencies', minEntities: 1 },
    { name: 'region', entity: 'Region', plural: 'Regions', minEntities: 1 },
    { name: 'store', entity: 'Store', plural: 'Stores', minEntities: 2 },
    { name: 'stock-location', entity: 'StockLocation', plural: 'StockLocations', minEntities: 1 },
  ]

  for (const { name, entity, plural, minEntities } of COMMERCE_WITH_ENTITIES) {
    describe(name, () => {
      it('is resolvable', () => {
        // biome-ignore lint/suspicious/noExplicitAny: dynamic module
        const service = (app.modules as any)[name]
        expect(service, `${name} not in app.modules`).toBeDefined()
      })

      it(`has retrieve${entity}`, () => {
        // biome-ignore lint/suspicious/noExplicitAny: dynamic module
        const service = (app.modules as any)[name]
        expect(typeof service[`retrieve${entity}`]).toBe('function')
      })

      it(`has list${plural}`, () => {
        // biome-ignore lint/suspicious/noExplicitAny: dynamic module
        const service = (app.modules as any)[name]
        expect(typeof service[`list${plural}`]).toBe('function')
      })

      it(`has create${plural}`, () => {
        // biome-ignore lint/suspicious/noExplicitAny: dynamic module
        const service = (app.modules as any)[name]
        expect(typeof service[`create${plural}`]).toBe('function')
      })

      it(`list${plural}() is callable and returns array`, async () => {
        // biome-ignore lint/suspicious/noExplicitAny: dynamic module
        const service = (app.modules as any)[name]
        const result = await service[`list${plural}`]()
        expect(Array.isArray(result)).toBe(true)
      })

      it(`has >= ${minEntities} DML entities`, () => {
        const mod = commerceModules.find((m) => m.name === name)
        expect(mod, `${name} not found in discovered modules`).toBeDefined()
        expect(mod!.models.length).toBeGreaterThanOrEqual(minEntities)
      })
    })
  }
})
