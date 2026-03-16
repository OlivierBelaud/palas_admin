import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createTestContainer,
  resetAll,
  spyOnEvents,
  InMemoryContainer,
  InMemoryEventBusAdapter,
} from '@manta/test-utils'

describe('Bootstrap Integration', () => {
  let container: InMemoryContainer

  beforeEach(() => {
    container = createTestContainer()
  })

  afterEach(async () => {
    await resetAll(container)
  })

  // SPEC-074: boot with all in-memory adapters
  it('boot with all in-memory adapters completes', () => {
    // All ports should be resolvable from the test container
    expect(() => container.resolve('ICachePort')).not.toThrow()
    expect(() => container.resolve('IEventBusPort')).not.toThrow()
    expect(() => container.resolve('ILoggerPort')).not.toThrow()
    expect(() => container.resolve('ILockingPort')).not.toThrow()
    expect(() => container.resolve('IWorkflowEnginePort')).not.toThrow()
    expect(() => container.resolve('IWorkflowStoragePort')).not.toThrow()
    expect(() => container.resolve('IFilePort')).not.toThrow()
    expect(() => container.resolve('INotificationPort')).not.toThrow()
    expect(() => container.resolve('IJobSchedulerPort')).not.toThrow()
    expect(() => container.resolve('ITranslationPort')).not.toThrow()
  })

  // SPEC-074: event buffer released after lazy boot
  it('event buffer released after lazy boot', async () => {
    const spy = spyOnEvents(container)
    const bus = container.resolve<InMemoryEventBusAdapter>('IEventBusPort')

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

    // Simulate lazy boot complete → release buffer
    await bus.releaseGroupedEvents('boot-buffer')

    // After release — events delivered
    expect(spy.received('boot.module.loaded')).toBe(true)
    expect(spy.count('boot.module.loaded')).toBe(2)
  })

  // SPEC-074: core boot completes without lazy modules
  it('core boot completes without lazy modules', () => {
    // Required modules (EVENT_BUS, CACHE) are available
    expect(() => container.resolve('ICachePort')).not.toThrow()
    expect(() => container.resolve('IEventBusPort')).not.toThrow()

    // Container itself is operational
    expect(container.id).toBeDefined()
  })

  // SPEC-074: lazy boot timeout returns 503
  it.todo('lazy boot timeout returns 503 — blocked on: Bootstrap orchestrator with lazy boot timeout enforcement (SPEC-074)')
})
