// E2E test — bootstraps the demo container and runs the full pipeline
import { describe, it, expect, beforeEach } from 'vitest'
import {
  InMemoryEventBusAdapter,
  InMemoryFileAdapter,
  TestLogger,
  WorkflowManager,
} from '@manta/core'
import type { IContainer, ILoggerPort, IEventBusPort } from '@manta/core'

import { ProductService } from '../src/modules/product'
import { InventoryService } from '../src/modules/inventory'
import { StatsService } from '../src/modules/stats/service'
import { FileService } from '../src/modules/file/service'
import { ProductInventoryLinkStore } from '../src/links/product-inventory'

import { createProductPipeline } from '../src/workflows/create-product-pipeline'
import { initializeInventory } from '../src/workflows/initialize-inventory'

import productCreatedSub from '../src/subscribers/product-created'
import inventoryStockedSub from '../src/subscribers/inventory-stocked'
import lowStockAlertSub from '../src/subscribers/low-stock-alert'

import type { Message } from '@manta/core'

// Minimal container for testing
class TestContainer implements IContainer {
  id = crypto.randomUUID()
  private _registry = new Map<string, unknown>()

  resolve<T>(key: string): T {
    const val = this._registry.get(key)
    if (val === undefined) throw new Error(`Service "${key}" not registered`)
    return val as T
  }
  register(key: string, value: unknown): void { this._registry.set(key, value) }
  createScope(): IContainer { return this }
  registerAdd(): void {}
  aliasTo(): void {}
  async dispose(): Promise<void> {}
}

function createDemoContainer(): TestContainer {
  const container = new TestContainer()

  // Infrastructure
  const logger = new TestLogger()
  const eventBus = new InMemoryEventBusAdapter()
  const filePort = new InMemoryFileAdapter()

  container.register('ILoggerPort', logger)
  container.register('IEventBusPort', eventBus)
  container.register('IFilePort', filePort)

  // Services
  const productService = new ProductService()
  const inventoryService = new InventoryService()
  const statsService = new StatsService()
  const fileService = new FileService(filePort)
  const linkStore = new ProductInventoryLinkStore()

  container.register('productService', productService)
  container.register('inventoryService', inventoryService)
  container.register('statsService', statsService)
  container.register('fileService', fileService)
  container.register('linkStore', linkStore)

  // WorkflowManager
  const wm = new WorkflowManager(container)
  wm.register(createProductPipeline)
  wm.register(initializeInventory)
  container.register('workflowManager', wm)

  // Wire subscribers
  const resolve = <T>(key: string): T => container.resolve<T>(key)
  eventBus.subscribe(productCreatedSub.event, (msg: Message) => productCreatedSub.handler(msg, resolve))
  eventBus.subscribe(inventoryStockedSub.event, (msg: Message) => inventoryStockedSub.handler(msg, resolve))
  eventBus.subscribe(lowStockAlertSub.event, (msg: Message) => lowStockAlertSub.handler(msg, resolve))

  return container
}

describe('Full Pipeline E2E', () => {
  let container: TestContainer
  let wm: WorkflowManager
  let productService: ProductService
  let inventoryService: InventoryService
  let fileService: FileService
  let statsService: StatsService

  beforeEach(() => {
    container = createDemoContainer()
    wm = container.resolve<WorkflowManager>('workflowManager')
    productService = container.resolve<ProductService>('productService')
    inventoryService = container.resolve<InventoryService>('inventoryService')
    fileService = container.resolve<FileService>('fileService')
    statsService = container.resolve<StatsService>('statsService')
  })

  it('Test 1: Full pipeline — normal flow', async () => {
    const result = await wm.run('create-product-pipeline', {
      input: {
        title: 'Test Widget',
        sku: 'TEST-001',
        price: 29.99,
        description: 'A test widget',
        images: [
          { filename: 'front.jpg', content: Buffer.from('fake-image-front') },
          { filename: 'back.jpg', content: Buffer.from('fake-image-back') },
        ],
        initialStock: 100,
        reorderPoint: 10,
      },
    })

    // Workflow output
    const product = (result as Record<string, unknown>).product as Record<string, unknown>
    expect(product).toBeDefined()
    expect(product.status).toBe('active')
    expect((result as Record<string, unknown>).events).toEqual(['product.created', 'inventory.stocked'])

    // Verify persisted product
    const p = await productService.findBySku('TEST-001')
    expect(p).toBeTruthy()
    expect(p!.title).toBe('Test Widget')
    expect(p!.image_urls).toHaveLength(2)
    expect(p!.catalog_file_url).toBeTruthy()

    // Verify inventory
    const inv = await inventoryService.findBySku('TEST-001')
    expect(inv).toBeTruthy()
    expect(inv!.quantity).toBe(100)
    expect(inv!.reorder_point).toBe(10)

    // Verify catalog file
    const catalogExists = await fileService.exists('catalog/TEST-001.json')
    expect(catalogExists).toBe(true)

    // Verify stats subscriber fired
    const total = await statsService.get('total_products')
    expect(total).toBeGreaterThanOrEqual(1)
  })

  it('Test 2: Low stock triggers notification chain', async () => {
    await wm.run('create-product-pipeline', {
      input: {
        title: 'Rare Item',
        sku: 'RARE-001',
        price: 199.99,
        initialStock: 5,     // below reorder point of 10
        reorderPoint: 10,
      },
    })

    // Wait for async subscriber chain
    await new Promise(r => setTimeout(r, 50))

    // Verify low-stock notification file
    const notifications = await fileService.list('notifications/')
    const lowStockNotif = notifications.find(f => f.includes('low-stock-RARE-001'))
    expect(lowStockNotif).toBeTruthy()
  })

  it('Test 3: Validation — missing required fields', async () => {
    await expect(
      wm.run('create-product-pipeline', {
        input: { title: 'No SKU', price: 10 },
      }),
    ).rejects.toThrow('Missing required fields')
  })

  it('Test 3b: Validation — negative price', async () => {
    await expect(
      wm.run('create-product-pipeline', {
        input: { title: 'Negative', sku: 'NEG-001', price: -5 },
      }),
    ).rejects.toThrow('non-negative')
  })

  it('Test 3c: Validation — duplicate SKU', async () => {
    await wm.run('create-product-pipeline', {
      input: { title: 'First', sku: 'DUP-001', price: 10, initialStock: 10 },
    })

    await expect(
      wm.run('create-product-pipeline', {
        input: { title: 'Second', sku: 'DUP-001', price: 20 },
      }),
    ).rejects.toThrow("already exists")
  })

  it('Test 4: Product deletion', async () => {
    await wm.run('create-product-pipeline', {
      input: { title: 'ToDelete', sku: 'DEL-001', price: 10, initialStock: 10 },
    })

    const product = await productService.findBySku('DEL-001')
    expect(product).toBeTruthy()

    await productService.delete(product!.id)
    const deleted = await productService.findBySku('DEL-001')
    expect(deleted).toBeNull()
  })

  it('Test 5: Cleanup job removes old drafts', async () => {
    await productService.create({
      title: 'Old Draft',
      sku: 'DRAFT-001',
      price: 0,
      status: 'draft',
    })

    const draft = await productService.findBySku('DRAFT-001')
    expect(draft).toBeTruthy()

    // deleteDraftsOlderThan(0) deletes all drafts
    const cleaned = await productService.deleteDraftsOlderThan(0)
    expect(cleaned).toContain(draft!.id)

    const afterClean = await productService.findBySku('DRAFT-001')
    expect(afterClean).toBeNull()
  })

  it('Test 6: Cross-module — product + inventory both created', async () => {
    const result = await wm.run('create-product-pipeline', {
      input: {
        title: 'Linked Product',
        sku: 'LINK-001',
        price: 49.99,
        initialStock: 50,
      },
    })

    const product = await productService.findBySku('LINK-001')
    const inventory = await inventoryService.findBySku('LINK-001')

    expect(product).toBeTruthy()
    expect(inventory).toBeTruthy()
    expect(inventory!.quantity).toBe(50)
  })

  it('Test 7: Compensation — step failure triggers rollback of earlier steps', async () => {
    // Create a product pipeline that will fail at step 5 (generate-catalog-entry)
    // by making the file service throw on catalog write
    const originalUpload = container.resolve<InMemoryFileAdapter>('IFilePort').upload.bind(
      container.resolve<InMemoryFileAdapter>('IFilePort'),
    )

    const filePort = container.resolve<InMemoryFileAdapter>('IFilePort')
    let callCount = 0
    const originalFn = filePort.upload.bind(filePort)
    filePort.upload = async (key: string, data: Buffer | ReadableStream, contentType?: string) => {
      callCount++
      // Fail on the 3rd upload (catalog file, after 2 image uploads)
      if (key.startsWith('catalog/')) {
        throw new Error('Simulated catalog write failure')
      }
      return originalFn(key, data, contentType)
    }

    await expect(
      wm.run('create-product-pipeline', {
        input: {
          title: 'Will Fail',
          sku: 'FAIL-001',
          price: 10,
          images: [
            { filename: 'img.jpg', content: Buffer.from('data') },
          ],
          initialStock: 10,
        },
      }),
    ).rejects.toThrow('Simulated catalog write failure')

    // Product should have been compensated (deleted)
    const product = await productService.findBySku('FAIL-001')
    expect(product).toBeNull()

    // Restore original
    filePort.upload = originalFn
  })

  it('Test 8: Sub-workflow — initialize-inventory runs independently', async () => {
    const result = await wm.run('initialize-inventory', {
      input: {
        sku: 'SUB-001',
        initialQuantity: 42,
        reorderPoint: 5,
      },
    })

    const inv = await inventoryService.findBySku('SUB-001')
    expect(inv).toBeTruthy()
    expect(inv!.quantity).toBe(42)
    expect(inv!.reorder_point).toBe(5)
  })
})
