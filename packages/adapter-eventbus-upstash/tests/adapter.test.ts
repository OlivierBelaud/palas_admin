// UpstashEventBusAdapter — unit tests (SDKs mocked)
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock @upstash/qstash
vi.mock('@upstash/qstash', () => ({
  Client: vi.fn(() => ({
    publishJSON: vi.fn().mockResolvedValue({ messageId: 'msg-1' }),
  })),
}))

// Mock @upstash/redis
vi.mock('@upstash/redis', () => ({
  Redis: vi.fn(() => ({
    rpush: vi.fn().mockResolvedValue(1),
    lrange: vi.fn().mockResolvedValue([]),
    llen: vi.fn().mockResolvedValue(0),
    del: vi.fn().mockResolvedValue(1),
    exists: vi.fn().mockResolvedValue(0),
    expire: vi.fn().mockResolvedValue(1),
  })),
}))

import type { Message } from '@manta/core'
import { UpstashEventBusAdapter } from '../src'

const createMessage = (eventName: string, data: unknown = {}): Message => ({
  eventName,
  data,
  metadata: { timestamp: Date.now() },
})

describe('UpstashEventBusAdapter', () => {
  let bus: UpstashEventBusAdapter

  beforeEach(() => {
    vi.clearAllMocks()
    // No credentials → local-only mode (graceful degradation)
    bus = new UpstashEventBusAdapter()
  })

  // E-01 — emit/subscribe basic delivery
  it('emit/subscribe > basic delivery', async () => {
    const received: Message[] = []
    bus.subscribe('order.created', (event) => {
      received.push(event)
    })

    await bus.emit(createMessage('order.created', { orderId: '1' }))

    expect(received).toHaveLength(1)
    expect(received[0].eventName).toBe('order.created')
  })

  // E-02 — emit without subscriber is silent
  it('emit > without subscriber', async () => {
    await expect(bus.emit(createMessage('unknown.event'))).resolves.toBeUndefined()
  })

  // E-03 — grouped events are held
  it('grouped > hold events', async () => {
    const received: Message[] = []
    bus.subscribe('order.created', (event) => {
      received.push(event)
    })

    await bus.emit(createMessage('order.created'), { groupId: 'tx-1' })
    expect(received).toHaveLength(0)
  })

  // E-04 — release delivers all in FIFO order
  it('grouped > release delivers in FIFO', async () => {
    const received: string[] = []

    bus.subscribe('eventA', () => {
      received.push('A')
    })
    bus.subscribe('eventB', () => {
      received.push('B')
    })
    bus.subscribe('eventC', () => {
      received.push('C')
    })

    await bus.emit(createMessage('eventA'), { groupId: 'tx-1' })
    await bus.emit(createMessage('eventB'), { groupId: 'tx-1' })
    await bus.emit(createMessage('eventC'), { groupId: 'tx-1' })

    expect(received).toHaveLength(0)

    await bus.releaseGroupedEvents('tx-1')
    expect(received).toEqual(['A', 'B', 'C'])
  })

  // E-05 — clear discards grouped events
  it('grouped > clear discards events', async () => {
    const received: Message[] = []
    bus.subscribe('order.created', (event) => {
      received.push(event)
    })

    await bus.emit(createMessage('order.created'), { groupId: 'tx-1' })
    await bus.clearGroupedEvents('tx-1')
    await bus.releaseGroupedEvents('tx-1')

    expect(received).toHaveLength(0)
  })

  // E-06 — TTL expiration
  it('grouped > TTL expiration', async () => {
    vi.useFakeTimers()

    const received: Message[] = []
    bus.subscribe('order.created', (event) => {
      received.push(event)
    })

    await bus.emit(createMessage('order.created'), { groupId: 'tx-1' })

    vi.advanceTimersByTime(601_000)

    await bus.releaseGroupedEvents('tx-1')
    expect(received).toHaveLength(0)

    vi.useRealTimers()
  })

  // E-07 — subscriber deduplication
  it('subscriber > deduplication', async () => {
    let callCount = 0
    bus.subscribe(
      'order.created',
      () => {
        callCount++
      },
      { subscriberId: 'sub-1' },
    )
    bus.subscribe(
      'order.created',
      () => {
        callCount++
      },
      { subscriberId: 'sub-1' },
    )

    await bus.emit(createMessage('order.created'))
    expect(callCount).toBe(1)
  })

  // E-08 — interceptors non-blocking
  it('interceptors > non-blocking', async () => {
    let interceptorCalled = false
    let subscriberCalled = false

    bus.addInterceptor(() => {
      interceptorCalled = true
      throw new Error('interceptor crash')
    })

    bus.subscribe('test.event', () => {
      subscriberCalled = true
    })

    await bus.emit(createMessage('test.event'))
    expect(interceptorCalled).toBe(true)
    expect(subscriberCalled).toBe(true)
  })

  // E-13 — maxActiveGroups
  it('grouped > maxActiveGroups exceeded', async () => {
    bus._setMaxActiveGroups(5)

    for (let i = 0; i < 5; i++) {
      await bus.emit(createMessage('test.event'), { groupId: `group-${i}` })
    }

    await expect(bus.emit(createMessage('test.event'), { groupId: 'group-6th' })).rejects.toThrow()
  })

  // E-14 — non-serializable payload
  it('emit > non-serializable payload throws', async () => {
    const circular: any = { a: 1 }
    circular.self = circular
    await expect(bus.emit(createMessage('test.event', circular))).rejects.toThrow()
  })

  // unsubscribe
  it('unsubscribe > removes handler', async () => {
    let callCount = 0
    bus.subscribe(
      'order.created',
      () => {
        callCount++
      },
      { subscriberId: 'sub-1' },
    )
    bus.unsubscribe('sub-1')

    await bus.emit(createMessage('order.created'))
    expect(callCount).toBe(0)
  })

  // getGroupStatus
  it('getGroupStatus > returns status for existing group', async () => {
    await bus.emit(createMessage('test.event'), { groupId: 'tx-1' })
    const status = bus.getGroupStatus('tx-1')
    expect(status).not.toBeNull()
    expect(status!.exists).toBe(true)
    expect(status!.eventCount).toBe(1)
  })

  it('getGroupStatus > returns null for nonexistent group', () => {
    const status = bus.getGroupStatus('nonexistent')
    expect(status).toBeNull()
  })
})
