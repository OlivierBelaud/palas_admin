import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createService, buildEventNamesFromModelName, MantaError } from '@manta/core'
import { InMemoryRepository, InMemoryMessageAggregator } from '@manta/core'

describe('createService()', () => {
  let repo: InMemoryRepository
  let aggregator: InMemoryMessageAggregator

  beforeEach(() => {
    repo = new InMemoryRepository('test_entity')
    aggregator = new InMemoryMessageAggregator()
  })

  // CS-01 — Generates CRUD methods for an entity
  it('generates CRUD methods', () => {
    const ServiceClass = createService({ Product: { name: 'Product' } })
    const service = new ServiceClass({ repository: repo, messageAggregator: aggregator })

    expect(typeof service.retrieveProduct).toBe('function')
    expect(typeof service.listProducts).toBe('function')
    expect(typeof service.listAndCountProducts).toBe('function')
    expect(typeof service.createProducts).toBe('function')
    expect(typeof service.updateProducts).toBe('function')
    expect(typeof service.deleteProducts).toBe('function')
    expect(typeof service.softDeleteProducts).toBe('function')
    expect(typeof service.restoreProducts).toBe('function')
  })

  // CS-02 — create inserts and emits events
  it('create inserts and emits events', async () => {
    const ServiceClass = createService({ Product: { name: 'Product' } })
    const service = new ServiceClass({ repository: repo, messageAggregator: aggregator }) as Record<string, Function>

    const result = await service.createProducts({}, [
      { title: 'Widget', price: 100 },
    ])

    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Widget')
    expect(result[0].id).toBeDefined()

    const messages = aggregator.getMessages()
    expect(messages).toHaveLength(1)
    expect(messages[0].eventName).toBe('product.created')
    expect(messages[0].data).toEqual({ id: result[0].id })
  })

  // CS-03 — retrieve returns entity by ID
  it('retrieve returns entity by ID', async () => {
    const ServiceClass = createService({ Product: { name: 'Product' } })
    const service = new ServiceClass({ repository: repo, messageAggregator: aggregator }) as Record<string, Function>

    const created = await service.createProducts({}, [{ title: 'Test' }])
    const retrieved = await service.retrieveProduct({}, created[0].id)

    expect(retrieved.title).toBe('Test')
  })

  // CS-04 — retrieve throws NOT_FOUND for missing entity
  it('retrieve throws NOT_FOUND for missing ID', async () => {
    const ServiceClass = createService({ Product: { name: 'Product' } })
    const service = new ServiceClass({ repository: repo }) as Record<string, Function>

    await expect(service.retrieveProduct({}, 'nonexistent')).rejects.toThrow('not found')
  })

  // CS-05 — list returns all entities
  it('list returns entities', async () => {
    const ServiceClass = createService({ Product: { name: 'Product' } })
    const service = new ServiceClass({ repository: repo }) as Record<string, Function>

    await repo.create([{ title: 'A' }, { title: 'B' }])
    const results = await service.listProducts({})

    expect(results).toHaveLength(2)
  })

  // CS-06 — update modifies and emits events
  it('update modifies and emits events', async () => {
    const ServiceClass = createService({ Product: { name: 'Product' } })
    const service = new ServiceClass({ repository: repo, messageAggregator: aggregator }) as Record<string, Function>

    const created = await service.createProducts({}, [{ title: 'Old' }])
    aggregator.clearMessages()

    const updated = await service.updateProducts({}, [{ id: created[0].id, title: 'New' }])

    expect(updated[0].title).toBe('New')

    const messages = aggregator.getMessages()
    expect(messages).toHaveLength(1)
    expect(messages[0].eventName).toBe('product.updated')
  })

  // CS-07 — delete removes and emits events
  it('delete removes and emits events', async () => {
    const ServiceClass = createService({ Product: { name: 'Product' } })
    const service = new ServiceClass({ repository: repo, messageAggregator: aggregator }) as Record<string, Function>

    const created = await service.createProducts({}, [{ title: 'Doomed' }])
    aggregator.clearMessages()

    await service.deleteProducts({}, [created[0].id])

    const remaining = await service.listProducts({})
    expect(remaining).toHaveLength(0)

    const messages = aggregator.getMessages()
    expect(messages).toHaveLength(1)
    expect(messages[0].eventName).toBe('product.deleted')
  })

  // CS-08 — softDelete sets deleted_at
  it('softDelete sets deleted_at', async () => {
    const ServiceClass = createService({ Product: { name: 'Product' } })
    const service = new ServiceClass({ repository: repo }) as Record<string, Function>

    const created = await service.createProducts({}, [{ title: 'Soft' }])
    await service.softDeleteProducts({}, [created[0].id])

    // Should not appear in regular list
    const results = await service.listProducts({})
    expect(results).toHaveLength(0)
  })

  // CS-09 — restore clears deleted_at
  it('restore clears deleted_at', async () => {
    const ServiceClass = createService({ Product: { name: 'Product' } })
    const service = new ServiceClass({ repository: repo }) as Record<string, Function>

    const created = await service.createProducts({}, [{ title: 'Restored' }])
    await service.softDeleteProducts({}, [created[0].id])
    await service.restoreProducts({}, [created[0].id])

    const results = await service.listProducts({})
    expect(results).toHaveLength(1)
  })

  // CS-10 — Override: throw before super prevents insert and events
  it('override throw before super prevents insert and events', async () => {
    const ServiceClass = createService({ Product: { name: 'Product' } })

    class CustomService extends ServiceClass {
      override async createProducts(context: unknown, data: Record<string, unknown>[]) {
        if ((data[0] as Record<string, unknown>).price === -1) {
          throw new MantaError('INVALID_DATA', 'Price cannot be negative')
        }
        return super.createProducts(context, data)
      }
    }

    const service = new CustomService({ repository: repo, messageAggregator: aggregator }) as Record<string, Function>

    await expect(service.createProducts({}, [{ title: 'Bad', price: -1 }])).rejects.toThrow('Price cannot be negative')

    // No entity created, no events
    const all = await repo.find({})
    expect(all).toHaveLength(0)
    expect(aggregator.getMessages()).toHaveLength(0)
  })
})

describe('buildEventNamesFromModelName()', () => {
  it('generates correct event names', () => {
    const events = buildEventNamesFromModelName('Product')
    expect(events).toEqual({
      created: 'product.created',
      updated: 'product.updated',
      deleted: 'product.deleted',
    })
  })
})
