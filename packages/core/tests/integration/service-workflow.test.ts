import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createTestContainer,
  resetAll,
  spyOnEvents,
  InMemoryContainer,
  InMemoryWorkflowEngine,
  InMemoryEventBusAdapter,
  InMemoryRepository,
  InMemoryMessageAggregator,
} from '@manta/test-utils'
import {
  createService,
  createWorkflow,
  step,
  Module,
  defineLink,
  clearLinkRegistry,
  QueryService,
} from '@manta/core'

describe('Service + Workflow Integration', () => {
  let container: InMemoryContainer
  let engine: InMemoryWorkflowEngine
  let bus: InMemoryEventBusAdapter
  let repo: InMemoryRepository

  beforeEach(() => {
    container = createTestContainer()
    engine = container.resolve<InMemoryWorkflowEngine>('IWorkflowEnginePort')
    bus = container.resolve<InMemoryEventBusAdapter>('IEventBusPort')
    repo = new InMemoryRepository('products')
    engine.configure({ container })
  })

  afterEach(async () => {
    await resetAll(container)
    clearLinkRegistry()
  })

  // INT-01 — createService + workflow: create product via workflow
  it('workflow creates product via service', async () => {
    const ProductServiceClass = createService({ Product: { name: 'Product' } })
    const aggregator = new InMemoryMessageAggregator()
    const productService = new ProductServiceClass({
      repository: repo,
      messageAggregator: aggregator,
    }) as Record<string, Function>

    container.register('productService', productService)

    const wf = createWorkflow({
      name: 'create-product',
      steps: [
        step({
          name: 'create',
          handler: async ({ input, context }) => {
            const svc = context.resolve<Record<string, Function>>('productService')
            const products = await svc.createProducts({}, [input.data as Record<string, unknown>])
            return { product: products[0] }
          },
        }),
      ],
    })

    engine.registerWorkflow(wf)
    const result = await engine.run('create-product', {
      input: { data: { title: 'Widget', price: 999 } },
    })

    expect(result.status).toBe('done')
    const output = result.output as { product: Record<string, unknown> }
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
    const productService = new ProductServiceClass({ repository: repo }) as Record<string, Function>

    container.register('productService', productService)

    const wf = createWorkflow({
      name: 'order-flow',
      steps: [
        step({
          name: 'create-product',
          handler: async ({ context }) => {
            const svc = context.resolve<Record<string, Function>>('productService')
            const products = await svc.createProducts({}, [{ title: 'Temp' }])
            return { productId: products[0].id }
          },
          compensation: async ({ output, context }) => {
            const svc = context.resolve<Record<string, Function>>('productService')
            await svc.deleteProducts({}, [output.productId as string])
          },
        }),
        step({
          name: 'fail-step',
          handler: async () => { throw new Error('Payment failed') },
        }),
      ],
    })

    engine.registerWorkflow(wf)
    await engine.run('order-flow', { input: {}, throwOnError: false })

    // Product should be deleted by compensation
    const remaining = await repo.find({})
    expect(remaining).toHaveLength(0)
  })

  // INT-03 — Module() + createService integration
  it('Module wraps a service class', () => {
    const ServiceClass = createService({ Product: { name: 'Product' } })

    class ProductService extends ServiceClass {}

    const mod = Module(ProductService, { name: 'product', version: '1.0.0' })

    expect(mod.name).toBe('product')
    expect(mod.version).toBe('1.0.0')
    expect(mod.service).toBe(ProductService)
  })

  // INT-04 — defineLink creates valid link definition
  it('defineLink + getRegisteredLinks', () => {
    const link = defineLink({
      leftModule: 'product',
      leftEntity: 'Product',
      rightModule: 'category',
      rightEntity: 'Category',
    })

    expect(link.tableName).toBe('product_product_category_category')
    expect(link.leftFk).toBe('product_id')
    expect(link.rightFk).toBe('category_id')
  })

  // INT-05 — QueryService with resolver and subscriber
  it('QueryService + EventBus subscriber', async () => {
    const query = new QueryService()
    const products = [{ id: '1', title: 'Widget' }]

    query.registerResolver('product', async () => products)

    // Subscribe to product events
    let eventReceived = false
    bus.subscribe('product.queried', () => { eventReceived = true })

    const result = await query.graph({ entity: 'product' })
    expect(result).toEqual(products)

    // Emit query event
    await bus.emit({
      eventName: 'product.queried',
      data: { count: result.length },
      metadata: { timestamp: Date.now() },
    })

    expect(eventReceived).toBe(true)
  })
})
