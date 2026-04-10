import type { Message } from '@manta/core'
import {
  defineSubscriber,
  InMemoryCacheAdapter,
  InMemoryEventBusAdapter,
  makeIdempotent,
  registerSubscriber,
} from '@manta/core'
import { beforeEach, describe, expect, it } from 'vitest'

// Augment the generated event map with test-only events so that
// defineSubscriber's overloaded signatures accept them.
declare global {
  interface MantaGeneratedEventMap {
    'order.created': { id: string; sku?: string; title?: string }
    'order.updated': { id: string }
    'product.created': { id?: string; sku?: string; title?: string }
    'test.event': Record<string, unknown>
  }
}

describe('Subscriber System', () => {
  let bus: InMemoryEventBusAdapter

  beforeEach(() => {
    bus = new InMemoryEventBusAdapter()
  })

  // SUB-01 — registerSubscriber registers handler for event
  it('registerSubscriber registers a handler', async () => {
    let received: Message | null = null

    registerSubscriber(bus, { event: 'order.created' }, (event) => {
      received = event
    })

    await bus.emit({
      eventName: 'order.created',
      data: { id: 'ord_1' },
      metadata: { timestamp: Date.now() },
    })

    expect(received).not.toBeNull()
    expect(received!.data).toEqual({ id: 'ord_1' })
  })

  // SUB-02 — registerSubscriber with multiple events
  it('registerSubscriber handles multiple events', async () => {
    const received: string[] = []

    registerSubscriber(bus, { event: ['order.created', 'order.updated'] }, (event) => {
      received.push(event.eventName)
    })

    await bus.emit({
      eventName: 'order.created',
      data: { id: '1' },
      metadata: { timestamp: Date.now() },
    })

    await bus.emit({
      eventName: 'order.updated',
      data: { id: '1' },
      metadata: { timestamp: Date.now() },
    })

    expect(received).toContain('order.created')
    expect(received).toContain('order.updated')
  })

  // SUB-03 — registerSubscriber with subscriberId
  it('registerSubscriber passes subscriberId', async () => {
    let callCount = 0

    registerSubscriber(bus, { event: 'test.event', subscriberId: 'my-sub' }, () => {
      callCount++
    })

    // Same subscriberId should deduplicate
    registerSubscriber(bus, { event: 'test.event', subscriberId: 'my-sub' }, () => {
      callCount++
    })

    await bus.emit({
      eventName: 'test.event',
      data: {},
      metadata: { timestamp: Date.now() },
    })

    // Dedup means only called once
    expect(callCount).toBe(1)
  })
})

describe('defineSubscriber()', () => {
  // DS-01 — returns config with __type marker (object form)
  it('returns config with __type: subscriber marker (object form)', () => {
    const sub = defineSubscriber({
      event: 'order.created',
      handler: async () => {},
    })

    expect(sub.__type).toBe('subscriber')
    expect(sub.event).toBe('order.created')
    expect(typeof sub.handler).toBe('function')
  })

  // DS-01b — returns config with __type marker (string form)
  it('returns config with __type: subscriber marker (string form)', () => {
    const sub = defineSubscriber('order.created', async () => {})

    expect(sub.__type).toBe('subscriber')
    expect(sub.event).toBe('order.created')
    expect(typeof sub.handler).toBe('function')
  })

  // DS-02 — handler receives (event, { command, log }) context (object form)
  it('handler receives (event, { command, log }) context', async () => {
    let receivedCommand: Record<string, unknown> | null = null
    let receivedEvent: Message | null = null

    const sub = defineSubscriber({
      event: 'product.created',
      handler: async (event, { command }) => {
        receivedCommand = command as unknown as Record<string, unknown>
        receivedEvent = event
      },
    })

    const fakeCommand = { createProduct: async () => ({}) } as unknown as import('@manta/core').MantaCommands
    const fakeLog = { info() {}, warn() {}, error() {}, debug() {} } as unknown as import('@manta/core').ILoggerPort
    const msg = {
      eventName: 'product.created',
      data: { id: 'prod_1' },
      metadata: { timestamp: Date.now() },
    } as Message<{ id?: string; sku?: string; title?: string }>

    await sub.handler(msg, { command: fakeCommand, log: fakeLog })

    expect(receivedCommand).toBe(fakeCommand)
    expect(receivedEvent!.data).toEqual({ id: 'prod_1' })
  })

  // DS-02b — handler receives (event, { command, log }) context (string form)
  it('handler receives (event, { command, log }) context (string form)', async () => {
    let receivedCommand: Record<string, unknown> | null = null
    let receivedEvent: Message | null = null

    const sub = defineSubscriber('product.created', async (event, { command }) => {
      receivedCommand = command as unknown as Record<string, unknown>
      receivedEvent = event
    })

    const fakeCommand = { createProduct: async () => ({}) } as unknown as import('@manta/core').MantaCommands
    const fakeLog = { info() {}, warn() {}, error() {}, debug() {} } as unknown as import('@manta/core').ILoggerPort
    const msg = {
      eventName: 'product.created',
      data: { id: 'prod_1' },
      metadata: { timestamp: Date.now() },
    } as Message<{ id?: string; sku?: string; title?: string }>

    await sub.handler(msg, { command: fakeCommand, log: fakeLog })

    expect(receivedCommand).toBe(fakeCommand)
    expect(receivedEvent!.data).toEqual({ id: 'prod_1' })
  })

  // DS-03 — supports multiple events (object form only)
  it('supports multiple events', () => {
    const sub = defineSubscriber({
      event: ['order.created', 'order.updated'],
      handler: async () => {},
    })

    expect(sub.event).toEqual(['order.created', 'order.updated'])
  })

  // DS-04 — supports subscriberId (object form only)
  it('supports subscriberId', () => {
    const sub = defineSubscriber({
      event: 'test.event',
      subscriberId: 'my-sub',
      handler: async () => {},
    })

    expect(sub.subscriberId).toBe('my-sub')
  })

  // DS-05 — typed message data
  it('preserves generic type for message data', async () => {
    interface ProductCreated {
      sku: string
      title: string
    }

    let receivedSku = ''

    const sub = defineSubscriber<ProductCreated>({
      event: 'product.created',
      handler: async (event, { command: _command }) => {
        receivedSku = event.data.sku
      },
    })

    const fakeCommand = {} as import('@manta/core').MantaCommands
    const fakeLog = { info() {}, warn() {}, error() {}, debug() {} } as unknown as import('@manta/core').ILoggerPort
    await sub.handler(
      {
        eventName: 'product.created',
        data: { sku: 'SKU-001', title: 'Widget' },
        metadata: { timestamp: Date.now() },
      },
      { command: fakeCommand, log: fakeLog },
    )

    expect(receivedSku).toBe('SKU-001')
  })

  // DS-06 — string form throws on empty event
  it('string form throws on empty event', () => {
    // Intentional: pass an invalid empty event name to verify runtime validation.
    expect(() => defineSubscriber('' as keyof import('@manta/core').MantaEventMap, async () => {})).toThrow(
      'non-empty string',
    )
  })

  // DS-07 — string form throws on missing handler
  it('string form throws on missing handler', () => {
    expect(() => defineSubscriber('test.event', undefined as any)).toThrow('handler must be a function')
  })
})

describe('makeIdempotent()', () => {
  let cache: InMemoryCacheAdapter

  beforeEach(() => {
    cache = new InMemoryCacheAdapter()
  })

  // IDEM-01 — First call executes handler
  it('first call executes handler', async () => {
    let executed = false
    const handler = makeIdempotent(cache, async () => {
      executed = true
    })

    await handler({
      eventName: 'order.created',
      data: { id: 'ord_1' },
      metadata: { timestamp: Date.now() },
    })

    expect(executed).toBe(true)
  })

  // IDEM-02 — Second call with same key is skipped
  it('second call with same key is skipped', async () => {
    let callCount = 0
    const handler = makeIdempotent(cache, async () => {
      callCount++
    })

    const event: Message = {
      eventName: 'order.created',
      data: { id: 'ord_1' },
      metadata: { timestamp: Date.now() },
    }

    await handler(event)
    await handler(event)

    expect(callCount).toBe(1)
  })

  // IDEM-03 — Different keys execute separately
  it('different keys execute separately', async () => {
    let callCount = 0
    const handler = makeIdempotent(cache, async () => {
      callCount++
    })

    await handler({
      eventName: 'order.created',
      data: { id: 'ord_1' },
      metadata: { timestamp: Date.now() },
    })

    await handler({
      eventName: 'order.created',
      data: { id: 'ord_2' },
      metadata: { timestamp: Date.now() },
    })

    expect(callCount).toBe(2)
  })

  // IDEM-04 — Custom keyFn
  it('supports custom keyFn', async () => {
    let callCount = 0
    const handler = makeIdempotent(
      cache,
      async () => {
        callCount++
      },
      {
        keyFn: (event) => `custom:${(event.data as Record<string, unknown>).id}`,
      },
    )

    await handler({
      eventName: 'a',
      data: { id: 'same' },
      metadata: { timestamp: Date.now() },
    })

    await handler({
      eventName: 'b', // Different event name but same key
      data: { id: 'same' },
      metadata: { timestamp: Date.now() },
    })

    expect(callCount).toBe(1)
  })
})
