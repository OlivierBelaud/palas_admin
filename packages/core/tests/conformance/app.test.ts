import { beforeEach, describe, expect, it } from 'vitest'
import {
  createApp,
  createTestMantaApp,
  InMemoryCacheAdapter,
  InMemoryEventBusAdapter,
  InMemoryFileAdapter,
  InMemoryLockingAdapter,
  type MantaApp,
  type MantaAppBuilder,
  TestLogger,
  type TestMantaApp,
} from '../../src'

interface ProductService {
  list(): string[]
  create(data: { title: string }): { id: string; title: string }
}

interface OrderService {
  list(): string[]
}

interface TestModules extends Record<string, unknown> {
  product: ProductService
  order: OrderService
}

const makeInfra = () => ({
  eventBus: new InMemoryEventBusAdapter(),
  logger: new TestLogger(),
  cache: new InMemoryCacheAdapter(),
  locking: new InMemoryLockingAdapter(),
  file: new InMemoryFileAdapter(),
  db: {},
})

describe('MantaApp', () => {
  let builder: MantaAppBuilder

  beforeEach(() => {
    builder = createApp({ infra: makeInfra() })
  })

  // APP-01 — Build app with modules
  it('builds an app with typed modules', () => {
    const productService: ProductService = {
      list: () => ['product-1'],
      create: (data) => ({ id: 'p1', title: data.title }),
    }
    builder.registerModule('product', productService)
    builder.registerModule('order', { list: () => ['order-1'] })

    const app = builder.build<TestModules>()
    expect(app.modules.product.list()).toEqual(['product-1'])
    expect(app.modules.order.list()).toEqual(['order-1'])
  })

  // APP-02 — Modules are frozen
  it('modules object is frozen', () => {
    builder.registerModule('product', { list: () => [] })
    const app = builder.build()
    expect(() => {
      ;(app.modules as Record<string, unknown>).hack = 'nope'
    }).toThrow()
  })

  // APP-03 — Cannot register after build
  it('cannot register modules after build', () => {
    builder.build()
    expect(() => builder.registerModule('late', {})).toThrow('App is frozen')
  })

  // APP-04 — Infra is accessible
  it('provides infra access', () => {
    const app = builder.build()
    expect(app.infra.eventBus).toBeDefined()
    expect(app.infra.logger).toBeDefined()
    expect(app.infra.cache).toBeDefined()
  })

  // APP-05 — Dynamic resolve
  it('resolve() provides dynamic access by key', () => {
    const svc = { list: () => ['p1'] }
    builder.registerModule('product', svc)
    const app = builder.build()
    expect(app.resolve('product')).toBe(svc)
    expect(app.resolve('productModuleService')).toBe(svc)
  })

  // APP-06 — Resolve infra keys
  it('resolve() provides infra access by Medusa keys', () => {
    const app = builder.build()
    expect(app.resolve('IEventBusPort')).toBeDefined()
    expect(app.resolve('event_bus')).toBeDefined()
    expect(app.resolve('logger')).toBeDefined()
  })

  // APP-07 — Resolve unknown key throws
  it('resolve() throws descriptive error for unknown key', () => {
    const app = builder.build()
    expect(() => app.resolve('nonexistent')).toThrow("Cannot resolve 'nonexistent'")
  })

  // APP-08 — CamelCase aliases
  it('generates camelCase aliases for hyphenated module names', () => {
    builder.registerModule('sales-channel', { list: () => ['sc1'] })
    const app = builder.build()
    // biome-ignore lint/suspicious/noExplicitAny: dynamic
    expect((app.modules as any)['sales-channel'].list()).toEqual(['sc1'])
    // biome-ignore lint/suspicious/noExplicitAny: dynamic
    expect((app.modules as any).salesChannel.list()).toEqual(['sc1'])
  })

  // APP-09 — App object is frozen
  it('app object is frozen', () => {
    const app = builder.build()
    expect(() => {
      ;(app as unknown as Record<string, unknown>).hack = true
    }).toThrow()
  })

  // APP-10 — Performance
  it('builds 108 modules in < 1ms', () => {
    for (let i = 0; i < 108; i++) builder.registerModule(`module-${i}`, { list: () => [] })
    const start = performance.now()
    const app = builder.build()
    expect(performance.now() - start).toBeLessThan(1)
    expect(Object.keys(app.modules).length).toBeGreaterThanOrEqual(108)
  })

  // APP-11 — App has unique ID
  it('has a unique ID', () => {
    const app1 = createApp({ infra: makeInfra() }).build()
    const app2 = createApp({ infra: makeInfra() }).build()
    expect(app1.id).toBeDefined()
    expect(app2.id).toBeDefined()
    expect(app1.id).not.toBe(app2.id)
  })

  // APP-12 — Dispose calls dispose on infra
  it('dispose() cleans up disposable infra', async () => {
    let disposed = false
    const infra = makeInfra()
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    ;(infra.cache as any).dispose = async () => {
      disposed = true
    }
    const app = createApp({ infra }).build()
    await app.dispose()
    expect(disposed).toBe(true)
  })

  // APP-13 — registerInfra for extra keys
  it('registerInfra makes keys available via resolve()', () => {
    const scheduler = { register: () => {}, runJob: () => {} }
    builder.registerInfra('IJobSchedulerPort', scheduler)
    const app = builder.build()
    expect(app.resolve('IJobSchedulerPort')).toBe(scheduler)
  })

  // APP-14 — Workflows accessible via resolve
  it('workflows accessible via resolve("workflows")', () => {
    builder.registerWorkflow('testWf', async () => ({ done: true }))
    const app = builder.build()
    expect(app.resolve('workflows')).toBeDefined()
    // biome-ignore lint/suspicious/noExplicitAny: dynamic
    expect(typeof (app.resolve('workflows') as any).testWf).toBe('function')
  })
})

describe('TestMantaApp', () => {
  // TAPP-01 — Mutable registration
  it('supports post-creation registration', () => {
    const app = createTestMantaApp({ infra: makeInfra() })
    app.register('myService', { greet: () => 'hello' })
    expect(app.resolve<{ greet: () => string }>('myService').greet()).toBe('hello')
  })

  // TAPP-02 — Infra accessible
  it('has infra accessible', () => {
    const app = createTestMantaApp({ infra: makeInfra() })
    expect(app.infra.eventBus).toBeDefined()
    expect(app.infra.logger).toBeDefined()
  })

  // TAPP-03 — Resolve infra by key
  it('resolves infra by standard keys', () => {
    const app = createTestMantaApp({ infra: makeInfra() })
    expect(app.resolve('IEventBusPort')).toBe(app.infra.eventBus)
    expect(app.resolve('ILoggerPort')).toBe(app.infra.logger)
  })

  // TAPP-04 — Has ID
  it('has unique ID', () => {
    const app = createTestMantaApp({ infra: makeInfra() })
    expect(app.id).toBeDefined()
    expect(typeof app.id).toBe('string')
  })

  // TAPP-05 — Dispose works
  it('dispose() works', async () => {
    const app = createTestMantaApp({ infra: makeInfra() })
    await expect(app.dispose()).resolves.toBeUndefined()
  })

  // TAPP-06 — Register overwrites
  it('register() overwrites previous value', () => {
    const app = createTestMantaApp({ infra: makeInfra() })
    app.register('svc', { version: 1 })
    app.register('svc', { version: 2 })
    expect(app.resolve<{ version: number }>('svc').version).toBe(2)
  })
})
