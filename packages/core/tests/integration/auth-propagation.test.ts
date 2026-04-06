import type { AuthContext, Message, TestMantaApp } from '@manta/core'
import {
  createTestMantaApp,
  InMemoryCacheAdapter,
  InMemoryEventBusAdapter,
  InMemoryFileAdapter,
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
    payloads(eventName: string) {
      return captured.filter((e) => e.name === eventName).map((e) => e.payload)
    },
    count(eventName: string) {
      return captured.filter((e) => e.name === eventName).length
    },
    all() {
      return [...captured]
    },
    reset() {
      captured.length = 0
    },
  }
}

describe('AuthContext Propagation Integration', () => {
  let app: TestMantaApp
  let bus: InMemoryEventBusAdapter

  const userAuth: AuthContext = {
    type: 'user',
    id: 'u1',
  }

  const systemAuth: AuthContext = {
    type: 'system',
    id: 'cron',
  }

  beforeEach(() => {
    const infra = makeInfra()
    app = createTestMantaApp({ infra })
    bus = infra.eventBus
  })

  afterEach(async () => {
    await app.dispose()
  })

  // SPEC-049/060: auth_context propagates through subscriber cascade
  it('propagates auth_context through subscriber cascade', async () => {
    const _spy = spyOnEvents(bus)
    const receivedAuth: (AuthContext | undefined)[] = []

    // Level 1: order.created -> emits inventory.reserved
    bus.subscribe(
      'order.created',
      async (event) => {
        receivedAuth.push(event.metadata.auth_context)
        await bus.emit({
          eventName: 'inventory.reserved',
          data: { orderId: event.data },
          metadata: {
            timestamp: Date.now(),
            auth_context: event.metadata.auth_context, // Propagate
          },
        })
      },
      { subscriberId: 'inventory-subscriber' },
    )

    // Level 2: inventory.reserved -> emits notification.sent
    bus.subscribe(
      'inventory.reserved',
      async (event) => {
        receivedAuth.push(event.metadata.auth_context)
        await bus.emit({
          eventName: 'notification.sent',
          data: { type: 'inventory' },
          metadata: {
            timestamp: Date.now(),
            auth_context: event.metadata.auth_context, // Propagate
          },
        })
      },
      { subscriberId: 'notification-subscriber' },
    )

    // Level 3: notification.sent
    bus.subscribe(
      'notification.sent',
      (event) => {
        receivedAuth.push(event.metadata.auth_context)
      },
      { subscriberId: 'audit-subscriber' },
    )

    // Emit initial event with user auth
    await bus.emit({
      eventName: 'order.created',
      data: { orderId: 'o1' },
      metadata: {
        timestamp: Date.now(),
        auth_context: userAuth,
      },
    })

    // All 3 levels received the same AuthContext
    expect(receivedAuth).toHaveLength(3)
    receivedAuth.forEach((auth) => {
      expect(auth).toEqual(userAuth)
    })
  })

  // SPEC-049: subscriber without auth_context does not crash
  it('subscriber without auth_context does not crash', async () => {
    let receivedAuth: AuthContext | undefined

    bus.subscribe('system.event', (event) => {
      receivedAuth = event.metadata.auth_context
    })

    // Emit event without auth_context
    await bus.emit({
      eventName: 'system.event',
      data: { action: 'cleanup' },
      metadata: {
        timestamp: Date.now(),
        // No auth_context
      },
    })

    expect(receivedAuth).toBeUndefined()
  })

  // SPEC-063: cron job propagates system AuthContext
  it('cron job propagates system AuthContext through cascade', async () => {
    const receivedAuth: (AuthContext | undefined)[] = []

    bus.subscribe(
      'cleanup.started',
      async (event) => {
        receivedAuth.push(event.metadata.auth_context)
        await bus.emit({
          eventName: 'cleanup.completed',
          data: {},
          metadata: {
            timestamp: Date.now(),
            auth_context: event.metadata.auth_context,
          },
        })
      },
      { subscriberId: 'cleanup-handler' },
    )

    bus.subscribe(
      'cleanup.completed',
      (event) => {
        receivedAuth.push(event.metadata.auth_context)
      },
      { subscriberId: 'cleanup-audit' },
    )

    // Cron job emits with system AuthContext
    await bus.emit({
      eventName: 'cleanup.started',
      data: {},
      metadata: {
        timestamp: Date.now(),
        auth_context: systemAuth,
      },
    })

    expect(receivedAuth).toHaveLength(2)
    receivedAuth.forEach((auth) => {
      expect(auth).toEqual(systemAuth)
    })
  })
})
