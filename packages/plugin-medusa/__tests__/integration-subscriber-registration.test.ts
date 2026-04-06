// Integration: Register Medusa subscribers into MantaApp's event bus
// and verify they execute when events are emitted.

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
import { discoverModules } from '../src/_internal/discovery/modules'
import { discoverSubscribers } from '../src/_internal/discovery/subscribers'
import { registerAllModulesInApp } from '../src/_internal/mapping/module-loader'
import { adaptMedusaHandler, registerSubscribersInApp } from '../src/_internal/mapping/subscriber-loader'

describe('integration: subscriber registration', () => {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic app
  let app: MantaApp<any>
  let eventBus: InMemoryEventBusAdapter

  beforeAll(() => {
    clearAlerts()

    eventBus = new InMemoryEventBusAdapter()
    const infra = {
      eventBus,
      logger: new TestLogger(),
      cache: new InMemoryCacheAdapter(),
      locking: new InMemoryLockingAdapter(),
      file: new InMemoryFileAdapter(),
      db: {},
    }
    const appBuilder = createApp({ infra })
    const modules = discoverModules()
    registerAllModulesInApp(appBuilder, modules, infra)

    // Stubs for framework services
    const noopService = new Proxy({}, { get: () => async () => [] })
    appBuilder.registerModule('link', noopService)
    appBuilder.registerModule('remoteLink', noopService)
    appBuilder.registerModule('remoteQuery', async () => [])
    appBuilder.registerModule('query', async () => [])

    app = appBuilder.build()
  })

  it('discovers subscribers with handlers attached', () => {
    const subscribers = discoverSubscribers()
    expect(subscribers.length).toBeGreaterThanOrEqual(2)

    for (const sub of subscribers) {
      expect(sub.hasHandler).toBe(true)
      expect(sub.handler).toBeDefined()
      expect(typeof sub.handler).toBe('function')
    }
  })

  it('registers all subscribers in the event bus', () => {
    const subscribers = discoverSubscribers()
    const result = registerSubscribersInApp(eventBus, subscribers, (key) => app.resolve(key))

    expect(result.registered).toBe(subscribers.length)
    expect(result.failed).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.errors).toHaveLength(0)
  })

  it('no error-level alerts after registration', () => {
    clearAlerts()
    const subscribers = discoverSubscribers()
    registerSubscribersInApp(eventBus, subscribers, (key) => app.resolve(key))

    const errors = getAlerts('subscriber').filter((a) => a.level === 'error')
    expect(errors).toHaveLength(0)
  })

  it('adaptMedusaHandler bridges the signature correctly', async () => {
    const calls: unknown[] = []
    const fakeHandler = async ({ event, container }: { event: unknown; container: unknown }) => {
      calls.push({ event, container })
    }

    const adapted = adaptMedusaHandler(fakeHandler, (key) => app.resolve(key))

    await adapted({
      eventName: 'test.event',
      data: { id: '123' },
      metadata: { timestamp: Date.now() },
    })

    expect(calls).toHaveLength(1)
    // biome-ignore lint/suspicious/noExplicitAny: test assertion
    const call = calls[0] as any
    expect(call.event.name).toBe('test.event')
    expect(call.event.data).toEqual({ id: '123' })
    expect(call.container.resolve).toBeDefined()
    expect(typeof call.container.resolve).toBe('function')
  })

  it('adapted handler can resolve services from the container', async () => {
    let resolvedLogger: unknown = null
    const fakeHandler = async ({ container }: { container: { resolve: (key: string) => unknown } }) => {
      resolvedLogger = container.resolve('logger')
    }

    const adapted = adaptMedusaHandler(fakeHandler, (key) => app.resolve(key))

    await adapted({
      eventName: 'test.resolve',
      data: {},
      metadata: { timestamp: Date.now() },
    })

    expect(resolvedLogger).toBeDefined()
    expect(resolvedLogger).toBe(app.infra.logger)
  })

  it('subscriber fires when event is emitted', async () => {
    // Register a fake subscriber through the bridge
    const received: unknown[] = []
    const fakeHandler = async ({ event }: { event: { name: string; data: unknown } }) => {
      received.push(event)
    }

    const freshBus = new InMemoryEventBusAdapter()
    const adapted = adaptMedusaHandler(fakeHandler, (key) => app.resolve(key))
    freshBus.subscribe('product.created', adapted, { subscriberId: 'test-sub' })

    // Emit an event
    await freshBus.emit({
      eventName: 'product.created',
      data: { id: 'prod_123', title: 'Test' },
      metadata: { timestamp: Date.now() },
    })

    expect(received).toHaveLength(1)
    // biome-ignore lint/suspicious/noExplicitAny: test assertion
    const evt = received[0] as any
    expect(evt.name).toBe('product.created')
    expect(evt.data.id).toBe('prod_123')
  })

  it('skips subscribers without handler or events', () => {
    clearAlerts()
    const fakeSubs = [
      { name: 'no-handler', events: ['test'], subscriberId: null, hasHandler: false },
      { name: 'no-events', events: [], subscriberId: null, hasHandler: true, handler: async () => {} },
    ]

    const result = registerSubscribersInApp(eventBus, fakeSubs, (key) => app.resolve(key))
    expect(result.skipped).toBe(2)
    expect(result.registered).toBe(0)

    const warnings = getAlerts('subscriber').filter((a) => a.level === 'warn')
    expect(warnings.length).toBeGreaterThanOrEqual(2)
  })

  it('real Medusa configurable-notifications subscriber has correct shape', () => {
    const subscribers = discoverSubscribers()
    const notif = subscribers.find((s) => s.name === 'configurable-notifications')
    expect(notif).toBeDefined()
    expect(notif!.events).toContain('order.created')
    expect(notif!.subscriberId).toBe('configurable-notifications-handler')
    expect(notif!.handler).toBeDefined()
  })

  it('real Medusa payment-webhook subscriber has correct shape', () => {
    const subscribers = discoverSubscribers()
    const webhook = subscribers.find((s) => s.name === 'payment-webhook')
    expect(webhook).toBeDefined()
    expect(webhook!.events).toContain('payment.webhook_received')
    expect(webhook!.subscriberId).toBe('payment-webhook-handler')
    expect(webhook!.handler).toBeDefined()
  })
})
