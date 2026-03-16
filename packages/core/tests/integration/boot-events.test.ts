import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createTestContainer,
  resetAll,
  spyOnEvents,
  InMemoryContainer,
  InMemoryEventBusAdapter,
  InMemoryMessageAggregator,
} from '@manta/test-utils'

describe('Bootstrap Events Integration', () => {
  let container: InMemoryContainer
  let bus: InMemoryEventBusAdapter

  beforeEach(() => {
    container = createTestContainer()
    bus = container.resolve<InMemoryEventBusAdapter>('IEventBusPort')
  })

  afterEach(async () => {
    await resetAll(container)
  })

  // SPEC-074: events emitted in onApplicationStart are buffered and released
  it('events emitted in onApplicationStart are buffered and released', async () => {
    const spy = spyOnEvents(container)

    bus.subscribe('test.module.started', () => {})

    // Module emits event during onApplicationStart (buffered)
    await bus.emit(
      {
        eventName: 'test.module.started',
        data: { module: 'test' },
        metadata: { timestamp: Date.now() },
      },
      { groupId: 'boot-events' },
    )

    // Not yet delivered
    expect(spy.received('test.module.started')).toBe(false)

    // Boot completes → release
    await bus.releaseGroupedEvents('boot-events')

    expect(spy.received('test.module.started')).toBe(true)
  })

  // SPEC-074/137: hook error does not block other modules
  it('hook error does not block other modules', async () => {
    const spy = spyOnEvents(container)

    bus.subscribe('healthy.started', () => {})

    // Failing module throws (its events would be cleared)
    await bus.emit(
      {
        eventName: 'failing.started',
        data: {},
        metadata: { timestamp: Date.now() },
      },
      { groupId: 'failing-module-boot' },
    )

    // Clear failing module's events
    await bus.clearGroupedEvents('failing-module-boot')

    // Healthy module emits and releases successfully
    await bus.emit(
      {
        eventName: 'healthy.started',
        data: { module: 'healthy' },
        metadata: { timestamp: Date.now() },
      },
      { groupId: 'healthy-module-boot' },
    )
    await bus.releaseGroupedEvents('healthy-module-boot')

    // Failing module's event was cleared
    expect(spy.received('failing.started')).toBe(false)

    // Healthy module's event was released
    expect(spy.received('healthy.started')).toBe(true)
  })

  // SPEC-074: events from throwing hook are cleared
  it('events from throwing hook are cleared', async () => {
    const spy = spyOnEvents(container)
    const aggregator = new InMemoryMessageAggregator()

    bus.subscribe('should.not.appear', () => {})

    // Module saves to aggregator then throws
    aggregator.save([{
      eventName: 'should.not.appear',
      data: {},
      metadata: { timestamp: Date.now() },
    }])

    // Simulate error → clear messages
    aggregator.clearMessages()

    // No events in aggregator
    expect(aggregator.getMessages()).toHaveLength(0)

    // Events never released to bus
    expect(spy.received('should.not.appear')).toBe(false)
  })
})
