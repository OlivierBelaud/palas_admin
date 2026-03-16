import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerSubscriber,
  makeIdempotent,
  InMemoryEventBusAdapter,
  InMemoryCacheAdapter,
} from '@manta/core'
import type { Message } from '@manta/core'

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

    registerSubscriber(
      bus,
      { event: ['order.created', 'order.updated'] },
      (event) => { received.push(event.eventName) },
    )

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

    registerSubscriber(
      bus,
      { event: 'test.event', subscriberId: 'my-sub' },
      () => { callCount++ },
    )

    // Same subscriberId should deduplicate
    registerSubscriber(
      bus,
      { event: 'test.event', subscriberId: 'my-sub' },
      () => { callCount++ },
    )

    await bus.emit({
      eventName: 'test.event',
      data: {},
      metadata: { timestamp: Date.now() },
    })

    // Dedup means only called once
    expect(callCount).toBe(1)
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
    const handler = makeIdempotent(cache, async () => {
      callCount++
    }, {
      keyFn: (event) => `custom:${(event.data as Record<string, unknown>).id}`,
    })

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
