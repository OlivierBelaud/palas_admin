import {
  buildEventNamesFromModelName,
  createService,
  InMemoryRepository,
  MantaError,
  MessageAggregator,
} from '@manta/core'
import { beforeEach, describe, expect, it } from 'vitest'

describe('createService()', () => {
  let repo: InMemoryRepository
  let aggregator: MessageAggregator

  beforeEach(() => {
    repo = new InMemoryRepository('test_entity')
    aggregator = new MessageAggregator()
  })

  // CS-01 — Generates CRUD methods for an entity
  it('generates CRUD methods', () => {
    const ServiceClass = createService({ Product: { name: 'Product' } })
    const service = new ServiceClass({ baseRepository: repo, messageAggregator: aggregator })

    expect(typeof service.retrieveProduct).toBe('function')
    expect(typeof service.listProducts).toBe('function')
    expect(typeof service.listAndCountProducts).toBe('function')
    expect(typeof service.createProducts).toBe('function')
    expect(typeof service.updateProducts).toBe('function')
    expect(typeof service.deleteProducts).toBe('function')
    expect(typeof service.softDeleteProducts).toBe('function')
    expect(typeof service.restoreProducts).toBe('function')
  })

  // CS-02 — create inserts and emits events (Medusa signature: data, sharedContext?)
  it('create inserts and emits events', async () => {
    const ServiceClass = createService({ Product: { name: 'Product' } })
    // biome-ignore lint/suspicious/noExplicitAny: test
    const service = new ServiceClass({ baseRepository: repo, messageAggregator: aggregator }) as Record<string, any>

    const result = await service.createProducts([{ title: 'Widget', price: 100 }])

    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Widget')
    expect(result[0].id).toBeDefined()

    const messages = aggregator.getMessages()
    expect(messages).toHaveLength(1)
    expect(messages[0].eventName).toBe('product.created')
    expect(messages[0].data).toEqual({ id: result[0].id })
  })

  // CS-02b — create single item returns single object (not array)
  it('create single item returns single object', async () => {
    const ServiceClass = createService({ Product: { name: 'Product' } })
    // biome-ignore lint/suspicious/noExplicitAny: test
    const service = new ServiceClass({ baseRepository: repo }) as Record<string, any>

    const result = await service.createProducts({ title: 'Single' })

    expect(result.title).toBe('Single')
    expect(result.id).toBeDefined()
    expect(Array.isArray(result)).toBe(false)
  })

  // CS-03 — retrieve returns entity by ID
  it('retrieve returns entity by ID', async () => {
    const ServiceClass = createService({ Product: { name: 'Product' } })
    // biome-ignore lint/suspicious/noExplicitAny: test
    const service = new ServiceClass({ baseRepository: repo }) as Record<string, any>

    const created = await service.createProducts([{ title: 'Test' }])
    const retrieved = await service.retrieveProduct(created[0].id)

    expect(retrieved.title).toBe('Test')
  })

  // CS-04 — retrieve throws NOT_FOUND for missing entity
  it('retrieve throws NOT_FOUND for missing ID', async () => {
    const ServiceClass = createService({ Product: { name: 'Product' } })
    // biome-ignore lint/suspicious/noExplicitAny: test
    const service = new ServiceClass({ baseRepository: repo }) as Record<string, any>

    try {
      await service.retrieveProduct('nonexistent')
      expect.fail('Should have thrown')
    } catch (err) {
      expect(MantaError.is(err)).toBe(true)
      expect((err as MantaError).type).toBe('NOT_FOUND')
      expect((err as MantaError).message).toContain('nonexistent')
    }
  })

  // CS-05 — list returns all entities
  it('list returns entities', async () => {
    const ServiceClass = createService({ Product: { name: 'Product' } })
    // biome-ignore lint/suspicious/noExplicitAny: test
    const service = new ServiceClass({ baseRepository: repo }) as Record<string, any>

    await repo.create([{ title: 'A' }, { title: 'B' }])
    const results = await service.listProducts()

    expect(results).toHaveLength(2)
  })

  // CS-06 — update modifies and emits events
  it('update modifies and emits events', async () => {
    const ServiceClass = createService({ Product: { name: 'Product' } })
    // biome-ignore lint/suspicious/noExplicitAny: test
    const service = new ServiceClass({ baseRepository: repo, messageAggregator: aggregator }) as Record<string, any>

    const created = await service.createProducts([{ title: 'Old' }])
    aggregator.clearMessages()

    const updated = await service.updateProducts([{ id: created[0].id, title: 'New' }])

    expect(updated[0].title).toBe('New')

    const messages = aggregator.getMessages()
    expect(messages).toHaveLength(1)
    expect(messages[0].eventName).toBe('product.updated')
  })

  // CS-07 — delete removes and emits events
  it('delete removes and emits events', async () => {
    const ServiceClass = createService({ Product: { name: 'Product' } })
    // biome-ignore lint/suspicious/noExplicitAny: test
    const service = new ServiceClass({ baseRepository: repo, messageAggregator: aggregator }) as Record<string, any>

    const created = await service.createProducts([{ title: 'Doomed' }])
    aggregator.clearMessages()

    await service.deleteProducts([created[0].id])

    const remaining = await service.listProducts()
    expect(remaining).toHaveLength(0)

    const messages = aggregator.getMessages()
    expect(messages).toHaveLength(1)
    expect(messages[0].eventName).toBe('product.deleted')
  })

  // CS-08 — softDelete sets deleted_at
  it('softDelete sets deleted_at', async () => {
    const ServiceClass = createService({ Product: { name: 'Product' } })
    // biome-ignore lint/suspicious/noExplicitAny: test
    const service = new ServiceClass({ baseRepository: repo }) as Record<string, any>

    const created = await service.createProducts([{ title: 'Soft' }])
    await service.softDeleteProducts([created[0].id])

    const results = await service.listProducts()
    expect(results).toHaveLength(0)
  })

  // CS-09 — restore clears deleted_at
  it('restore clears deleted_at', async () => {
    const ServiceClass = createService({ Product: { name: 'Product' } })
    // biome-ignore lint/suspicious/noExplicitAny: test
    const service = new ServiceClass({ baseRepository: repo }) as Record<string, any>

    const created = await service.createProducts([{ title: 'Restored' }])
    await service.softDeleteProducts([created[0].id])
    await service.restoreProducts([created[0].id])

    const results = await service.listProducts()
    expect(results).toHaveLength(1)
  })

  // CS-10 — Override: throw before super prevents insert and events
  it('override throw before super prevents insert and events', async () => {
    const ServiceClass = createService({ Product: { name: 'Product' } })

    class CustomModuleService extends ServiceClass {
      // biome-ignore lint/suspicious/noExplicitAny: test override
      async createProducts(data: any, sharedContext?: any) {
        if (Array.isArray(data) && data[0]?.price === -1) {
          throw new MantaError('INVALID_DATA', 'Price cannot be negative')
        }
        // biome-ignore lint/suspicious/noExplicitAny: test override
        return (ServiceClass.prototype as any).createProducts.call(this, data, sharedContext)
      }
    }

    // biome-ignore lint/suspicious/noExplicitAny: test
    const service = new CustomModuleService({ baseRepository: repo, messageAggregator: aggregator }) as Record<
      string,
      any
    >

    await expect(service.createProducts([{ title: 'Bad', price: -1 }])).rejects.toThrow('Price cannot be negative')

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
