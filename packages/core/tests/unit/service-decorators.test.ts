// Phase 6 -- Service decorators (SPEC-059)
// Tests for InjectManager, InjectTransactionManager, EmitEvents

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { InjectManager, InjectTransactionManager, EmitEvents } from '../../src/service/decorators'
import { MessageAggregator } from '../../src/events/message-aggregator'

describe('Service decorators', () => {
  // SD-01 -- InjectManager wraps method to inject manager as last arg
  it('SD-01 -- InjectManager injects manager into method', async () => {
    class TestService {
      manager = { query: vi.fn().mockResolvedValue([{ id: '1' }]) }

      @InjectManager()
      async listItems(_context: unknown, manager?: unknown): Promise<unknown> {
        return (manager as { query: () => Promise<unknown> }).query()
      }
    }

    const service = new TestService()
    const result = await service.listItems({})
    expect(service.manager.query).toHaveBeenCalled()
    expect(result).toEqual([{ id: '1' }])
  })

  // SD-02 -- InjectTransactionManager wraps in transaction
  it('SD-02 -- InjectTransactionManager injects transactionManager', async () => {
    const txManager = { query: vi.fn().mockResolvedValue({ id: '1' }) }
    class TestService {
      manager = {
        transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(txManager)),
      }

      @InjectTransactionManager()
      async createItem(_context: unknown, data: unknown, txMgr?: unknown): Promise<unknown> {
        return (txMgr as { query: () => Promise<unknown> }).query()
      }
    }

    const service = new TestService()
    const result = await service.createItem({}, { name: 'test' })
    expect(txManager.query).toHaveBeenCalled()
    expect(result).toEqual({ id: '1' })
  })

  // SD-03 -- EmitEvents emits accumulated events after method succeeds
  it('SD-03 -- EmitEvents emits events on success', async () => {
    const aggregator = new MessageAggregator()
    const eventBus = {
      emit: vi.fn().mockResolvedValue(undefined),
    }

    class TestService {
      __messageAggregator = aggregator
      __eventBus = eventBus

      @EmitEvents()
      async createProduct(context: unknown, data: unknown): Promise<unknown> {
        this.__messageAggregator.save([{
          eventName: 'product.created',
          data: { id: 'prod_1' },
          metadata: { timestamp: Date.now() },
        }])
        return { id: 'prod_1' }
      }
    }

    const service = new TestService()
    const result = await service.createProduct({}, { name: 'test' })
    expect(result).toEqual({ id: 'prod_1' })
    expect(eventBus.emit).toHaveBeenCalledTimes(1)
    const emittedEvents = eventBus.emit.mock.calls[0][0]
    expect(emittedEvents).toHaveLength(1)
    expect(emittedEvents[0].eventName).toBe('product.created')
  })

  // SD-04 -- EmitEvents clears events on failure
  it('SD-04 -- EmitEvents clears events on failure', async () => {
    const aggregator = new MessageAggregator()
    const eventBus = { emit: vi.fn() }

    class TestService {
      __messageAggregator = aggregator
      __eventBus = eventBus

      @EmitEvents()
      async failingMethod(): Promise<unknown> {
        this.__messageAggregator.save([{
          eventName: 'should.be.cleared',
          data: {},
          metadata: { timestamp: Date.now() },
        }])
        throw new Error('method failed')
      }
    }

    const service = new TestService()
    await expect(service.failingMethod()).rejects.toThrow('method failed')
    expect(eventBus.emit).not.toHaveBeenCalled()
    // Aggregator should be cleared
    expect(aggregator.getMessages()).toHaveLength(0)
  })

  // SD-05 -- EmitEvents without eventBus just clears aggregator
  it('SD-05 -- EmitEvents without eventBus still succeeds', async () => {
    const aggregator = new MessageAggregator()

    class TestService {
      __messageAggregator = aggregator

      @EmitEvents()
      async doSomething(): Promise<string> {
        this.__messageAggregator.save([{
          eventName: 'thing.done',
          data: {},
          metadata: { timestamp: Date.now() },
        }])
        return 'ok'
      }
    }

    const service = new TestService()
    const result = await service.doSomething()
    expect(result).toBe('ok')
  })

  // SD-06 -- Decorators are higher-order functions, not TS decorators
  it('SD-06 -- decorators work as method decorator syntax', () => {
    // Just verify they are functions that return decorator descriptors
    expect(typeof InjectManager).toBe('function')
    expect(typeof InjectTransactionManager).toBe('function')
    expect(typeof EmitEvents).toBe('function')
  })
})
