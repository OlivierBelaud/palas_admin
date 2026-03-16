// Full pipeline test script — exercises all layers of the framework
// Run: npx vitest run demo/scripts/full-pipeline-test.test.ts
// Or import bootstrapDemo + run assertions directly

import type { ILoggerPort, WorkflowManager } from '@manta/core'
import type { ProductService } from '../src/modules/product'
import type { InventoryService } from '../src/modules/inventory'
import type { FileService } from '../src/modules/file/service'
import type { StatsService } from '../src/modules/stats/service'

export default async ({ container }: { container: { resolve: <T>(key: string) => T } }) => {
  const logger = container.resolve<ILoggerPort>('ILoggerPort')
  const workflowManager = container.resolve<WorkflowManager>('workflowManager')
  const productService = container.resolve<ProductService>('productService')
  const inventoryService = container.resolve<InventoryService>('inventoryService')
  const fileService = container.resolve<FileService>('fileService')
  const statsService = container.resolve<StatsService>('statsService')

  let passed = 0
  let failed = 0

  function assert(name: string, condition: boolean, detail?: string) {
    if (condition) {
      logger.info(`  ✓ ${name}`)
      passed++
    } else {
      logger.error(`  ✗ ${name}${detail ? ': ' + detail : ''}`)
      failed++
    }
  }

  logger.info('═══════════════════════════════════════')
  logger.info('  FULL PIPELINE TEST')
  logger.info('═══════════════════════════════════════')

  // ─── Test 1: Full pipeline — normal flow ───

  logger.info('\n── Test 1: Full pipeline — normal flow ──')

  const result1 = await workflowManager.run('create-product-pipeline', {
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

  assert('Workflow returns product', !!(result1 as Record<string, unknown>).product)
  const product1Result = (result1 as Record<string, unknown>).product as Record<string, unknown>
  assert('Product status is active', product1Result?.status === 'active')
  const events1 = (result1 as Record<string, unknown>).events as string[]
  assert('Events emitted', events1?.length === 2)

  // Verify in DB
  const product1 = await productService.findBySku('TEST-001')
  assert('Product persisted in DB', !!product1)
  assert('Product title correct', product1?.title === 'Test Widget')
  assert('Product has 2 images', product1?.image_urls?.length === 2)
  assert('Product has catalog URL', !!product1?.catalog_file_url)

  // Verify inventory
  const inventory1 = await inventoryService.findBySku('TEST-001')
  assert('Inventory created', !!inventory1)
  assert('Inventory quantity = 100', inventory1?.quantity === 100)
  assert('Reorder point = 10', inventory1?.reorder_point === 10)

  // Verify files
  const catalogExists = await fileService.exists(`catalog/TEST-001.json`)
  assert('Catalog file generated', catalogExists)

  // Verify stats (subscriber product.created)
  const totalProducts = await statsService.get('total_products')
  assert('Stats incremented', totalProducts >= 1)

  // ─── Test 2: Low stock triggers notification chain ───

  logger.info('\n── Test 2: Low stock — triggers notification chain ──')

  const result2 = await workflowManager.run('create-product-pipeline', {
    input: {
      title: 'Rare Item',
      sku: 'RARE-001',
      price: 199.99,
      initialStock: 5,     // below reorder point
      reorderPoint: 10,
    },
  })

  assert('Low stock product created', !!(result2 as Record<string, unknown>).product)

  // Wait for async subscribers
  await new Promise(r => setTimeout(r, 100))

  // Verify low-stock notification was written
  const notifications = await fileService.list('notifications/')
  const lowStockNotif = notifications.find(f => f.includes('low-stock-RARE-001'))
  assert('Low stock notification file created', !!lowStockNotif)

  // ─── Test 3: Validation errors ───

  logger.info('\n── Test 3: Validation errors ──')

  try {
    await workflowManager.run('create-product-pipeline', {
      input: { title: 'No SKU', price: 10 },
    })
    assert('Missing SKU throws', false)
  } catch (e: unknown) {
    assert('Missing SKU throws', (e as Error).message.includes('Missing required fields'))
  }

  try {
    await workflowManager.run('create-product-pipeline', {
      input: { title: 'Negative', sku: 'NEG-001', price: -5 },
    })
    assert('Negative price throws', false)
  } catch (e: unknown) {
    assert('Negative price throws', (e as Error).message.includes('non-negative'))
  }

  try {
    await workflowManager.run('create-product-pipeline', {
      input: { title: 'Duplicate', sku: 'TEST-001', price: 10 },
    })
    assert('Duplicate SKU throws', false)
  } catch (e: unknown) {
    assert('Duplicate SKU throws', (e as Error).message.includes('already exists'))
  }

  // ─── Test 4: Compensation (deletion cleanup) ───

  logger.info('\n── Test 4: Compensation — deletion ──')

  const productToDelete = await productService.findBySku('TEST-001')
  assert('Product to delete exists', !!productToDelete)

  await productService.delete(productToDelete!.id)
  const deletedProduct = await productService.findBySku('TEST-001')
  assert('Product deleted from DB', !deletedProduct)

  // ─── Test 5: Cleanup job ───

  logger.info('\n── Test 5: Cleanup job — removes old drafts ──')

  await productService.create({
    title: 'Old Draft',
    sku: 'DRAFT-001',
    price: 0,
    status: 'draft',
  })

  const draftExists = await productService.findBySku('DRAFT-001')
  assert('Draft product created', !!draftExists)

  // deleteDraftsOlderThan(0) = delete all drafts (created 0 hours ago = now)
  const cleaned = await productService.deleteDraftsOlderThan(0)
  assert('Cleanup found the draft', cleaned.includes(draftExists!.id))

  // ─── Test 6: Cross-module query ───

  logger.info('\n── Test 6: Cross-module — Product + Inventory ──')

  const result6 = await workflowManager.run('create-product-pipeline', {
    input: {
      title: 'Linked Product',
      sku: 'LINK-001',
      price: 49.99,
      initialStock: 50,
    },
  })

  const linkedProduct = (result6 as Record<string, unknown>).product as Record<string, unknown>
  assert('Linked product created', !!linkedProduct)

  // Verify both sides exist
  const productForLink = await productService.findBySku('LINK-001')
  const inventoryForLink = await inventoryService.findBySku('LINK-001')
  assert('Product exists for link', !!productForLink)
  assert('Inventory exists for link', !!inventoryForLink)
  assert('Inventory quantity = 50', inventoryForLink?.quantity === 50)

  // ─── Summary ───

  logger.info('\n═══════════════════════════════════════')
  logger.info(`  RESULTS: ${passed} passed, ${failed} failed`)
  logger.info('═══════════════════════════════════════')

  if (failed > 0) {
    throw new Error(`${failed} test(s) failed`)
  }

  return { passed, failed }
}
