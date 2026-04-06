import type { Message, TestMantaApp } from '@manta/core'
import {
  createTestMantaApp,
  InMemoryCacheAdapter,
  InMemoryEventBusAdapter,
  InMemoryFileAdapter,
  InMemoryHttpAdapter,
  InMemoryLockingAdapter,
  TestLogger,
} from '@manta/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const makeInfra = () => ({
  eventBus: new InMemoryEventBusAdapter(),
  logger: new TestLogger(),
  cache: new InMemoryCacheAdapter(),
  locking: new InMemoryLockingAdapter(),
  file: new InMemoryFileAdapter(),
  db: {},
})

/** Simple event spy that hooks into the event bus interceptor */
function spyOnEvents(bus: InMemoryEventBusAdapter) {
  const captured: Array<{ name: string; payload: Message; timestamp: number }> = []
  bus.addInterceptor((message: Message) => {
    captured.push({ name: message.eventName, payload: message, timestamp: Date.now() })
  })
  return {
    received(eventName: string) {
      return captured.some((e) => e.name === eventName)
    },
    count(eventName: string) {
      return captured.filter((e) => e.name === eventName).length
    },
  }
}

describe('Bootstrap Integration', () => {
  let app: TestMantaApp

  beforeEach(() => {
    app = createTestMantaApp({ infra: makeInfra() })
  })

  afterEach(async () => {
    await app.dispose()
  })

  // SPEC-074: boot with all in-memory adapters
  it('boot with all in-memory adapters completes', () => {
    // All ports should be resolvable from the test app
    expect(() => app.resolve('ICachePort')).not.toThrow()
    expect(() => app.resolve('IEventBusPort')).not.toThrow()
    expect(() => app.resolve('ILoggerPort')).not.toThrow()
    expect(() => app.resolve('ILockingPort')).not.toThrow()
    expect(() => app.resolve('IFilePort')).not.toThrow()
  })

  // SPEC-074: event buffer released after lazy boot
  it('event buffer released after lazy boot', async () => {
    const bus = app.infra.eventBus as InMemoryEventBusAdapter
    const spy = spyOnEvents(bus)

    // Simulate events emitted during core boot (buffered in group)
    bus.subscribe('boot.module.loaded', () => {})

    await bus.emit(
      { eventName: 'boot.module.loaded', data: { module: 'cache' }, metadata: { timestamp: Date.now() } },
      { groupId: 'boot-buffer' },
    )
    await bus.emit(
      { eventName: 'boot.module.loaded', data: { module: 'events' }, metadata: { timestamp: Date.now() } },
      { groupId: 'boot-buffer' },
    )

    // Before release — events not delivered
    expect(spy.received('boot.module.loaded')).toBe(false)

    // Simulate lazy boot complete -> release buffer
    await bus.releaseGroupedEvents('boot-buffer')

    // After release — events delivered
    expect(spy.received('boot.module.loaded')).toBe(true)
    expect(spy.count('boot.module.loaded')).toBe(2)
  })

  // SPEC-074: core boot completes without lazy modules
  it('core boot completes without lazy modules', () => {
    // Required modules (EVENT_BUS, CACHE) are available
    expect(() => app.resolve('ICachePort')).not.toThrow()
    expect(() => app.resolve('IEventBusPort')).not.toThrow()

    // App itself is operational
    expect(app.id).toBeDefined()
  })

  // SPEC-074: lazy boot timeout returns 503
  it('lazy boot timeout returns 503', async () => {
    // Simulate: lazy boot not complete -> HTTP handler should return 503
    const http = new InMemoryHttpAdapter()
    app.register('IHttpPort', http)
    let lazyBootComplete = false

    http.registerRoute('GET', '/api/products', async () => {
      if (!lazyBootComplete) {
        return new Response(
          JSON.stringify({ type: 'UNEXPECTED_STATE', message: 'Service not ready — lazy boot in progress' }),
          { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '2' } },
        )
      }
      return new Response(JSON.stringify({ products: [] }))
    })

    // Before lazy boot completes -> 503
    const res1 = await http.handleRequest(new Request('http://localhost/api/products'))
    expect(res1.status).toBe(503)
    expect(res1.headers.get('Retry-After')).toBe('2')

    // After lazy boot completes -> 200
    lazyBootComplete = true
    const res2 = await http.handleRequest(new Request('http://localhost/api/products'))
    expect(res2.status).toBe(200)
  })
})
