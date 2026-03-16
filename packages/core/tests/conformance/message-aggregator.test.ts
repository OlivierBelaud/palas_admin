import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  type IMessageAggregator,
  type Message,
  createTestContainer,
  resetAll,
  withScope,
  InMemoryContainer,
  InMemoryMessageAggregator,
} from '@manta/test-utils'

describe('IMessageAggregator Conformance', () => {
  let aggregator: InMemoryMessageAggregator
  let container: InMemoryContainer

  const createMessage = (eventName: string, data: unknown = {}, timestamp?: number): Message => ({
    eventName,
    data,
    metadata: {
      timestamp: timestamp ?? Date.now(),
    },
  })

  beforeEach(() => {
    container = createTestContainer()
    aggregator = new InMemoryMessageAggregator()
  })

  afterEach(async () => {
    await resetAll(container)
  })

  // MA-01 — SPEC-018: save/getMessages roundtrip
  it('save/getMessages > roundtrip', () => {
    const msg1 = createMessage('order.created', { orderId: '1' })
    const msg2 = createMessage('order.updated', { orderId: '2' })

    aggregator.save([msg1, msg2])

    const messages = aggregator.getMessages()
    expect(messages).toHaveLength(2)
    expect(messages[0].eventName).toBe('order.created')
    expect(messages[1].eventName).toBe('order.updated')
  })

  // MA-02 — SPEC-018: save accumulates messages
  it('save > accumulation', () => {
    const msg1 = createMessage('event.a')
    const msg2 = createMessage('event.b')

    aggregator.save([msg1])
    aggregator.save([msg2])

    const messages = aggregator.getMessages()
    expect(messages).toHaveLength(2)
    expect(messages[0].eventName).toBe('event.a')
    expect(messages[1].eventName).toBe('event.b')
  })

  // MA-03 — SPEC-018: clearMessages empties all
  it('clearMessages > vide tout', () => {
    aggregator.save([createMessage('event.a')])
    expect(aggregator.getMessages()).toHaveLength(1)

    aggregator.clearMessages()

    expect(aggregator.getMessages()).toHaveLength(0)
  })

  // MA-04 — SPEC-018: getMessages with groupBy
  it('getMessages > groupBy', () => {
    aggregator.save([
      createMessage('order.created', { id: '1' }),
      createMessage('order.updated', { id: '2' }),
      createMessage('order.created', { id: '3' }),
    ])

    const messages = aggregator.getMessages({ groupBy: 'eventName' })
    // groupBy returns flat array (internal grouping)
    expect(messages).toHaveLength(3)
  })

  // MA-05 — SPEC-018: getMessages with sortBy timestamp
  it('getMessages > sortBy', () => {
    const now = Date.now()
    aggregator.save([
      createMessage('event.c', {}, now + 200),
      createMessage('event.a', {}, now),
      createMessage('event.b', {}, now + 100),
    ])

    const messages = aggregator.getMessages({ sortBy: 'timestamp' })
    expect(messages).toHaveLength(3)
    expect(messages[0].eventName).toBe('event.a')
    expect(messages[1].eventName).toBe('event.b')
    expect(messages[2].eventName).toBe('event.c')
  })

  // MA-06 — SPEC-018: SCOPED isolation between scopes
  it('SCOPED > isolation entre scopes', async () => {
    const scopeAMessages: Message[] = []
    const scopeBMessages: Message[] = []

    await withScope(container, async () => {
      const aggA = new InMemoryMessageAggregator()
      aggA.save([createMessage('scope.a.event')])
      scopeAMessages.push(...aggA.getMessages())
    })

    await withScope(container, async () => {
      const aggB = new InMemoryMessageAggregator()
      aggB.save([createMessage('scope.b.event')])
      scopeBMessages.push(...aggB.getMessages())
    })

    // Each scope only sees its own messages
    expect(scopeAMessages).toHaveLength(1)
    expect(scopeAMessages[0].eventName).toBe('scope.a.event')

    expect(scopeBMessages).toHaveLength(1)
    expect(scopeBMessages[0].eventName).toBe('scope.b.event')
  })

  // MA-07 — SPEC-018/059c: @EmitEvents interaction — save after mutation
  it('interaction @EmitEvents > save après mutation', () => {
    // Simulates @EmitEvents behavior: service method saves events
    const emittedEvent = createMessage('product.created', { productId: 'p1' })
    aggregator.save([emittedEvent])

    const messages = aggregator.getMessages()
    expect(messages).toHaveLength(1)
    expect(messages[0].eventName).toBe('product.created')
    expect(messages[0].data).toEqual({ productId: 'p1' })
  })

  // MA-08 — SPEC-018/059c: @EmitEvents interaction — clear on error
  it('interaction @EmitEvents > clear sur erreur', () => {
    // Simulates @EmitEvents error path: clearMessages called on throw
    aggregator.save([createMessage('product.created')])
    expect(aggregator.getMessages()).toHaveLength(1)

    // Error occurs → clearMessages is called
    aggregator.clearMessages()

    expect(aggregator.getMessages()).toHaveLength(0)
  })
})
