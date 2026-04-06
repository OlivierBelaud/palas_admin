import type { TestMantaApp } from '@manta/core'
import {
  clearLinkRegistry,
  createService,
  createStep,
  createTestMantaApp,
  createWorkflow,
  defineLink,
  InMemoryCacheAdapter,
  InMemoryFileAdapter,
  InMemoryLockingAdapter,
  QueryService,
  TestLogger,
  WorkflowManager,
} from '@manta/core'
import { InMemoryEventBusAdapter, InMemoryRepository, MessageAggregator } from '@manta/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('Service + Workflow Integration', () => {
  let testApp: TestMantaApp
  let manager: WorkflowManager
  let bus: InMemoryEventBusAdapter
  let repo: InMemoryRepository

  beforeEach(() => {
    bus = new InMemoryEventBusAdapter()
    testApp = createTestMantaApp({
      infra: {
        eventBus: bus,
        logger: new TestLogger(),
        cache: new InMemoryCacheAdapter(),
        locking: new InMemoryLockingAdapter(),
        file: new InMemoryFileAdapter(),
        db: {},
      },
    })
    manager = new WorkflowManager(testApp)
    testApp.register('workflowManager', manager)
    repo = new InMemoryRepository('products')
  })

  afterEach(async () => {
    clearLinkRegistry()
  })

  // INT-01 — createService + workflow: create product via workflow
  it('workflow creates product via service', async () => {
    const ProductServiceClass = createService({ Product: { name: 'Product' } })
    const aggregator = new MessageAggregator()
    const productService = new ProductServiceClass({
      baseRepository: repo,
      messageAggregator: aggregator,
    }) as Record<string, Function>

    testApp.register('productService', productService)

    const createProductStep = createStep('create', async (input: { data: Record<string, unknown> }, { app }) => {
      const svc = app.resolve<Record<string, Function>>('productService')
      const products = await svc.createProducts([input.data])
      return { product: products[0] }
    })

    const wf = createWorkflow('create-product', async (input: { data: Record<string, unknown> }, { app }) => {
      return await createProductStep(input, { app })
    })

    manager.register(wf)
    const { result } = await manager.run('create-product', { input: { data: { title: 'Widget', price: 999 } } })

    const output = result as { product: Record<string, unknown> }
    expect(output.product.title).toBe('Widget')

    // Verify persisted
    const all = await repo.find({})
    expect(all).toHaveLength(1)

    // Verify events buffered
    const messages = aggregator.getMessages()
    expect(messages).toHaveLength(1)
    expect(messages[0].eventName).toBe('product.created')
  })

  // INT-02 — Workflow compensation cleans up created resources
  it('workflow compensation rolls back creation', async () => {
    const ProductServiceClass = createService({ Product: { name: 'Product' } })
    const productService = new ProductServiceClass({ baseRepository: repo }) as Record<string, Function>

    testApp.register('productService', productService)

    const createProductStep = createStep(
      'create-product',
      async (_input: unknown, { app }) => {
        const svc = app.resolve<Record<string, Function>>('productService')
        const products = await svc.createProducts([{ title: 'Temp' }])
        return { productId: products[0].id }
      },
      async (output, { app }) => {
        const svc = app.resolve<Record<string, Function>>('productService')
        await svc.deleteProducts([(output as { productId: string }).productId])
      },
    )

    const failStep = createStep('fail-step', async () => {
      throw new Error('Payment failed')
    })

    const wf = createWorkflow('order-flow', async (_input: unknown, { app }) => {
      await createProductStep({}, { app })
      await failStep({}, { app })
    })

    manager.register(wf)
    await expect(manager.run('order-flow')).rejects.toThrow('Payment failed')

    // Product should be deleted by compensation
    const remaining = await repo.find({})
    expect(remaining).toHaveLength(0)
  })

  // INT-04 — defineLink creates valid link definition
  it('defineLink + getRegisteredLinks', () => {
    const link = defineLink((m) => [m.Product, m.Category])

    expect(link.tableName).toBe('product_category')
    expect(link.leftFk).toBe('product_id')
    expect(link.rightFk).toBe('category_id')
  })

  // INT-05 — QueryService with resolver and subscriber
  it('QueryService + EventBus subscriber', async () => {
    const query = new QueryService()
    const products = [{ id: '1', title: 'Widget' }]

    query.registerResolver('product', async () => products)

    let eventReceived = false
    bus.subscribe('product.queried', () => {
      eventReceived = true
    })

    const result = await query.graph({ entity: 'product' })
    expect(result).toEqual(products)

    await bus.emit({
      eventName: 'product.queried',
      data: { count: result.length },
      metadata: { timestamp: Date.now() },
    })

    expect(eventReceived).toBe(true)
  })
})
