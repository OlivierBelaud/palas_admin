// UpstashEventBusAdapter — IEventBusPort conformance
// Tests grouped events via Redis (mocked) and local fallback
import type { Message } from '@manta/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock @upstash/qstash
vi.mock('@upstash/qstash', () => ({
  Client: vi.fn(() => ({
    publishJSON: vi.fn().mockResolvedValue({ messageId: 'msg-1' }),
  })),
}))

// Mock @upstash/redis with working list operations
const redisStore = new Map<string, string[]>()
const redisTtls = new Map<string, number>()

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn(() => ({
    rpush: vi.fn(async (key: string, ...values: string[]) => {
      if (!redisStore.has(key)) redisStore.set(key, [])
      redisStore.get(key)!.push(...values)
      return redisStore.get(key)!.length
    }),
    lrange: vi.fn(async (key: string) => {
      return redisStore.get(key) ?? []
    }),
    llen: vi.fn(async (key: string) => {
      return redisStore.get(key)?.length ?? 0
    }),
    del: vi.fn(async (key: string) => {
      redisStore.delete(key)
      return 1
    }),
    exists: vi.fn(async (key: string) => {
      return redisStore.has(key) ? 1 : 0
    }),
    expire: vi.fn(async (key: string, ttl: number) => {
      redisTtls.set(key, ttl)
      return 1
    }),
  })),
}))

import { UpstashEventBusAdapter } from '../src'

const createMessage = (eventName: string, data: unknown = {}): Message => ({
  eventName,
  data,
  metadata: { timestamp: Date.now() },
})

describe('UpstashEventBusAdapter — IEventBusPort conformance', () => {
  let bus: UpstashEventBusAdapter

  beforeEach(() => {
    vi.clearAllMocks()
    redisStore.clear()
    redisTtls.clear()
    // With Redis credentials → grouped events use Redis
    bus = new UpstashEventBusAdapter({
      redisUrl: 'https://fake.upstash.io',
      redisToken: 'fake-token',
    })
  })

  // E-01 — emit/subscribe with QStash callback
  it('E-01 — emit/subscribe delivery with QStash', async () => {
    const received: Message[] = []
    bus.subscribe('order.created', (event) => {
      received.push(event)
    })

    await bus.emit(createMessage('order.created', { orderId: '1' }))

    // Local delivery works
    expect(received).toHaveLength(1)
    expect(received[0].eventName).toBe('order.created')
  })

  // E-03 — grouped events stored in Redis
  it('E-03 — grouped events stored in Redis', async () => {
    const received: Message[] = []
    bus.subscribe('order.created', (event) => {
      received.push(event)
    })

    await bus.emit(createMessage('order.created', { id: '1' }), { groupId: 'tx-1' })
    await bus.emit(createMessage('order.created', { id: '2' }), { groupId: 'tx-1' })

    // Not delivered yet (stored in Redis)
    expect(received).toHaveLength(0)

    // Verify Redis was called
    expect(redisStore.has('manta:eventgroup:tx-1')).toBe(true)
    expect(redisStore.get('manta:eventgroup:tx-1')).toHaveLength(2)
  })

  // E-04 — release grouped events from Redis
  it('E-04 — release grouped events from Redis', async () => {
    const received: Message[] = []
    bus.subscribe('order.created', (event) => {
      received.push(event)
    })

    await bus.emit(createMessage('order.created', { id: '1' }), { groupId: 'tx-1' })
    await bus.emit(createMessage('order.created', { id: '2' }), { groupId: 'tx-1' })

    expect(received).toHaveLength(0)

    await bus.releaseGroupedEvents('tx-1')

    expect(received).toHaveLength(2)
    expect(received[0].data).toEqual({ id: '1' })
    expect(received[1].data).toEqual({ id: '2' })

    // Redis key deleted after release
    expect(redisStore.has('manta:eventgroup:tx-1')).toBe(false)
  })

  // E-05 — clear grouped events from Redis
  it('E-05 — clear grouped events from Redis', async () => {
    const received: Message[] = []
    bus.subscribe('order.created', (event) => {
      received.push(event)
    })

    await bus.emit(createMessage('order.created', { id: '1' }), { groupId: 'tx-1' })
    await bus.clearGroupedEvents('tx-1')
    await bus.releaseGroupedEvents('tx-1')

    // Nothing delivered
    expect(received).toHaveLength(0)
    expect(redisStore.has('manta:eventgroup:tx-1')).toBe(false)
  })
})
