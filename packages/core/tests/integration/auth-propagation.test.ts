import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  type AuthContext,
  type Message,
  createTestContainer,
  resetAll,
  spyOnEvents,
  InMemoryContainer,
  InMemoryEventBusAdapter,
} from '@manta/test-utils'

describe('AuthContext Propagation Integration', () => {
  let container: InMemoryContainer
  let bus: InMemoryEventBusAdapter

  const userAuth: AuthContext = {
    actor_type: 'user',
    actor_id: 'u1',
    scope: 'admin',
  }

  const systemAuth: AuthContext = {
    actor_type: 'system',
    actor_id: 'cron',
  }

  beforeEach(() => {
    container = createTestContainer()
    bus = container.resolve<InMemoryEventBusAdapter>('IEventBusPort')
  })

  afterEach(async () => {
    await resetAll(container)
  })

  // SPEC-049/060: auth_context propagates through subscriber cascade
  it('propagates auth_context through subscriber cascade', async () => {
    const spy = spyOnEvents(container)
    const receivedAuth: (AuthContext | undefined)[] = []

    // Level 1: order.created → emits inventory.reserved
    bus.subscribe('order.created', async (event) => {
      receivedAuth.push(event.metadata.auth_context)
      await bus.emit({
        eventName: 'inventory.reserved',
        data: { orderId: event.data },
        metadata: {
          timestamp: Date.now(),
          auth_context: event.metadata.auth_context, // Propagate
        },
      })
    }, { subscriberId: 'inventory-subscriber' })

    // Level 2: inventory.reserved → emits notification.sent
    bus.subscribe('inventory.reserved', async (event) => {
      receivedAuth.push(event.metadata.auth_context)
      await bus.emit({
        eventName: 'notification.sent',
        data: { type: 'inventory' },
        metadata: {
          timestamp: Date.now(),
          auth_context: event.metadata.auth_context, // Propagate
        },
      })
    }, { subscriberId: 'notification-subscriber' })

    // Level 3: notification.sent
    bus.subscribe('notification.sent', (event) => {
      receivedAuth.push(event.metadata.auth_context)
    }, { subscriberId: 'audit-subscriber' })

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

    bus.subscribe('cleanup.started', async (event) => {
      receivedAuth.push(event.metadata.auth_context)
      await bus.emit({
        eventName: 'cleanup.completed',
        data: {},
        metadata: {
          timestamp: Date.now(),
          auth_context: event.metadata.auth_context,
        },
      })
    }, { subscriberId: 'cleanup-handler' })

    bus.subscribe('cleanup.completed', (event) => {
      receivedAuth.push(event.metadata.auth_context)
    }, { subscriberId: 'cleanup-audit' })

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
