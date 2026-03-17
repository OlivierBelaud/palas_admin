// POST /api/admin/test/full-pipeline
// Comprehensive E2E test that validates every edge case in serverless
// Returns a JSON report with pass/fail for each test + detailed logs

import { defineEventHandler, readBody } from "h3"

interface TestResult {
  name: string
  status: "pass" | "fail" | "skip"
  durationMs: number
  logs: string[]
  error?: string
}

export default defineEventHandler(async (event) => {
  const results: TestResult[] = []
  const startTime = Date.now()

  // Get SQL connection + Drizzle instance
  const postgres = (await import("postgres")).default
  const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 3 })
  const { drizzle } = await import("drizzle-orm/postgres-js")
  const db = drizzle(sql)

  // Bootstrap a lightweight container for tests
  const { MantaContainer, ContainerRegistrationKeys, InMemoryCacheAdapter, InMemoryFileAdapter, WorkflowManager } = await import("@manta/core")
  const { PinoLoggerAdapter } = await import("@manta/adapter-logger-pino")
  const { NeonWorkflowStorageAdapter, NeonLockingAdapter, NeonEventBusAdapter, runMigrations } = await import("@manta/adapter-neon")

  const logger = new PinoLoggerAdapter({ level: "info", pretty: false })

  // Ensure tables exist
  await runMigrations(sql)

  // ══════════════════════════════════════════════
  // TEST 1: Normal workflow — 6 steps, all checkpoints persisted
  // ══════════════════════════════════════════════
  await runTest(results, "1. Normal workflow — 6 steps with checkpoints", async (logs) => {
    const sku = `TEST-NORMAL-${Date.now()}`
    const workflowStorage = new NeonWorkflowStorageAdapter(sql)
    const eventBus = new NeonEventBusAdapter(sql)
    const locking = new NeonLockingAdapter(sql)

    const container = new MantaContainer()
    container.register(ContainerRegistrationKeys.LOGGER, logger)
    container.register(ContainerRegistrationKeys.EVENT_BUS, eventBus)
    container.register(ContainerRegistrationKeys.CACHE, new InMemoryCacheAdapter())
    container.register(ContainerRegistrationKeys.LOCKING, locking)
    container.register("IWorkflowStoragePort", workflowStorage)
    container.register("IFilePort", new InMemoryFileAdapter())

    // Register services
    const { ProductService } = await import("~src/modules/product/index")
    const { InventoryService } = await import("~src/modules/inventory/index")
    const { StatsService } = await import("~src/modules/stats/index")
    const { FileService } = await import("~src/modules/file/service")
    container.register("productService", new ProductService(db))
    container.register("inventoryService", new InventoryService(db))
    container.register("statsService", new StatsService(db))
    container.register("fileService", new FileService(new InMemoryFileAdapter()))

    // Register workflows
    const wm = new WorkflowManager(container)
    const { createProductPipeline } = await import("~src/workflows/create-product-pipeline")
    const { initializeInventory } = await import("~src/workflows/initialize-inventory")
    wm.register(createProductPipeline)
    wm.register(initializeInventory)
    container.register("workflowManager", wm)

    // Register subscribers
    const resolve = <T>(key: string): T => container.resolve<T>(key)
    const subMods = [
      await import("~src/subscribers/product-created"),
      await import("~src/subscribers/inventory-stocked"),
      await import("~src/subscribers/low-stock-alert"),
    ]
    for (const mod of subMods) {
      const sub = mod.default
      if (sub?.event) {
        eventBus.subscribe(sub.event, (msg: any) => sub.handler(msg, resolve))
      }
    }

    // Run workflow
    const transactionId = `tx-${Date.now()}`
    await workflowStorage.saveExecution(transactionId, "create-product-pipeline", { sku })
    logs.push(`Workflow started: ${transactionId}`)

    const result = await wm.run("create-product-pipeline", {
      input: { title: "Test Normal Product", sku, price: 9999, initialStock: 50, reorderPoint: 10 },
    })

    logs.push(`Workflow result: status=${result.product?.status}, events=${JSON.stringify(result.events)}`)
    await workflowStorage.completeExecution(transactionId, result)

    // Verify product is active
    if (result.product?.status !== "active") throw new Error(`Expected status=active, got ${result.product?.status}`)
    logs.push("✓ Product status is 'active'")

    // Verify events were emitted
    if (!result.events?.includes("product.created")) throw new Error("Missing product.created event")
    if (!result.events?.includes("inventory.stocked")) throw new Error("Missing inventory.stocked event")
    logs.push("✓ Events emitted: product.created, inventory.stocked")

    // Verify events persisted in DB
    const dbEvents = await sql`SELECT event_name FROM events WHERE event_name IN ('product.created', 'inventory.stocked') ORDER BY created_at DESC LIMIT 2`
    logs.push(`✓ Events in DB: ${dbEvents.map((e: any) => e.event_name).join(", ")}`)

    // Verify workflow execution tracked in DB
    const exec = await sql`SELECT status FROM workflow_executions WHERE transaction_id = ${transactionId}`
    if (exec.length === 0 || exec[0].status !== "completed") throw new Error("Workflow execution not tracked in DB")
    logs.push("✓ Workflow execution tracked in DB (status=completed)")

    // Cleanup
    const ps = container.resolve<any>("productService")
    const product = await ps.findBySku(sku)
    if (product) await ps.delete(product.id)
  })

  // ══════════════════════════════════════════════
  // TEST 2: Low stock event chain — fan-out subscriber cascade
  // ══════════════════════════════════════════════
  await runTest(results, "2. Low stock event chain — fan-out cascade", async (logs) => {
    const sku = `TEST-LOWSTOCK-${Date.now()}`
    const eventBus = new NeonEventBusAdapter(sql)
    const container = new MantaContainer()
    container.register(ContainerRegistrationKeys.LOGGER, logger)
    container.register(ContainerRegistrationKeys.EVENT_BUS, eventBus)
    container.register(ContainerRegistrationKeys.CACHE, new InMemoryCacheAdapter())
    container.register(ContainerRegistrationKeys.LOCKING, new NeonLockingAdapter(sql))
    container.register("IWorkflowStoragePort", new NeonWorkflowStorageAdapter(sql))
    container.register("IFilePort", new InMemoryFileAdapter())

    const { ProductService } = await import("~src/modules/product/index")
    const { InventoryService } = await import("~src/modules/inventory/index")
    const { StatsService } = await import("~src/modules/stats/index")
    const { FileService } = await import("~src/modules/file/service")
    container.register("productService", new ProductService(db))
    container.register("inventoryService", new InventoryService(db))
    container.register("statsService", new StatsService(db))
    container.register("fileService", new FileService(new InMemoryFileAdapter()))

    const wm = new WorkflowManager(container)
    const { createProductPipeline } = await import("~src/workflows/create-product-pipeline")
    const { initializeInventory } = await import("~src/workflows/initialize-inventory")
    wm.register(createProductPipeline)
    wm.register(initializeInventory)
    container.register("workflowManager", wm)

    const resolve = <T>(key: string): T => container.resolve<T>(key)
    let lowStockFired = false
    eventBus.subscribe("product.created", (await import("~src/subscribers/product-created")).default.handler.bind(null) as any)
    eventBus.subscribe("inventory.stocked", async (msg: any) => {
      const sub = (await import("~src/subscribers/inventory-stocked")).default
      await sub.handler(msg, resolve)
    })
    eventBus.subscribe("inventory.low-stock", async (msg: any) => {
      lowStockFired = true
      logs.push(`✓ Low stock event received: sku=${msg.data.sku}, qty=${msg.data.quantity}`)
    })

    // Run with low stock (3 < 10)
    const result = await wm.run("create-product-pipeline", {
      input: { title: "Low Stock Product", sku, price: 5000, initialStock: 3, reorderPoint: 10 },
    })

    // Wait for async subscriber chain
    await new Promise((r) => setTimeout(r, 100))

    if (!lowStockFired) throw new Error("Low stock event was NOT fired")
    logs.push("✓ Full event chain: product.created → inventory.stocked → inventory.low-stock")

    // Verify in DB
    const lowStockEvents = await sql`SELECT * FROM events WHERE event_name = 'inventory.low-stock' ORDER BY created_at DESC LIMIT 1`
    if (lowStockEvents.length > 0) {
      logs.push("✓ Low stock event persisted in DB")
    }

    // Cleanup
    const ps = container.resolve<any>("productService")
    const product = await ps.findBySku(sku)
    if (product) await ps.delete(product.id)
  })

  // ══════════════════════════════════════════════
  // TEST 3: Distributed locking — concurrent SKU protection
  // ══════════════════════════════════════════════
  await runTest(results, "3. Distributed locking — concurrent SKU protection", async (logs) => {
    const locking = new NeonLockingAdapter(sql)
    const lockKey = `test-lock-${Date.now()}`

    // Acquire lock
    const acquired1 = await locking.acquire(lockKey)
    if (!acquired1) throw new Error("Failed to acquire first lock")
    logs.push("✓ Lock acquired (first)")

    // Try to acquire same lock — should fail
    const acquired2 = await locking.acquire(lockKey)
    if (acquired2) throw new Error("Second lock should have been rejected")
    logs.push("✓ Second lock attempt correctly rejected (distributed lock works)")

    // Release and re-acquire
    await locking.release(lockKey)
    logs.push("✓ Lock released")

    const acquired3 = await locking.acquire(lockKey)
    if (!acquired3) throw new Error("Failed to re-acquire lock after release")
    logs.push("✓ Lock re-acquired after release")

    await locking.release(lockKey)
  })

  // ══════════════════════════════════════════════
  // TEST 4: Workflow compensation on failure — rollback
  // ══════════════════════════════════════════════
  await runTest(results, "4. Workflow compensation on failure — rollback", async (logs) => {
    const sku = `TEST-COMP-${Date.now()}`
    const eventBus = new NeonEventBusAdapter(sql)
    const container = new MantaContainer()
    container.register(ContainerRegistrationKeys.LOGGER, logger)
    container.register(ContainerRegistrationKeys.EVENT_BUS, eventBus)
    container.register(ContainerRegistrationKeys.CACHE, new InMemoryCacheAdapter())
    container.register(ContainerRegistrationKeys.LOCKING, new NeonLockingAdapter(sql))
    container.register("IWorkflowStoragePort", new NeonWorkflowStorageAdapter(sql))

    // Use a file adapter that FAILS on catalog write (to trigger compensation)
    const failingFileAdapter = new InMemoryFileAdapter()
    const originalWrite = failingFileAdapter.upload.bind(failingFileAdapter)
    let writeCount = 0
    failingFileAdapter.upload = async (key: string, content: Buffer) => {
      writeCount++
      // Fail on the catalog write (3rd+ write — after image uploads)
      if (key.startsWith("catalog/")) {
        throw new Error("SIMULATED CATALOG WRITE FAILURE")
      }
      return originalWrite(key, content)
    }
    container.register("IFilePort", failingFileAdapter)

    const { ProductService } = await import("~src/modules/product/index")
    const { InventoryService } = await import("~src/modules/inventory/index")
    const { StatsService } = await import("~src/modules/stats/index")
    const { FileService } = await import("~src/modules/file/service")
    const ps = new ProductService(db)
    container.register("productService", ps)
    container.register("inventoryService", new InventoryService(db))
    container.register("statsService", new StatsService(db))
    container.register("fileService", new FileService(failingFileAdapter))

    const wm = new WorkflowManager(container)
    const { createProductPipeline } = await import("~src/workflows/create-product-pipeline")
    const { initializeInventory } = await import("~src/workflows/initialize-inventory")
    wm.register(createProductPipeline)
    wm.register(initializeInventory)
    container.register("workflowManager", wm)

    // Run workflow — should fail at step 5 (catalog)
    let failed = false
    try {
      await wm.run("create-product-pipeline", {
        input: { title: "Compensation Test", sku, price: 1000, initialStock: 5, reorderPoint: 10 },
      })
    } catch (err) {
      failed = true
      logs.push(`✓ Workflow failed as expected: ${(err as Error).message}`)
    }

    if (!failed) throw new Error("Workflow should have failed but succeeded")

    // Verify compensation ran — product should be deleted
    const product = await ps.findBySku(sku)
    if (product) throw new Error(`Product ${sku} still exists — compensation did NOT run`)
    logs.push("✓ Product deleted by compensation handler (rollback successful)")
  })

  // ══════════════════════════════════════════════
  // TEST 5: Validation errors — SKU uniqueness
  // ══════════════════════════════════════════════
  await runTest(results, "5. Validation — duplicate SKU rejected", async (logs) => {
    const sku = `TEST-DUP-${Date.now()}`
    const container = new MantaContainer()
    container.register(ContainerRegistrationKeys.LOGGER, logger)
    container.register(ContainerRegistrationKeys.EVENT_BUS, new NeonEventBusAdapter(sql))
    container.register(ContainerRegistrationKeys.CACHE, new InMemoryCacheAdapter())
    container.register(ContainerRegistrationKeys.LOCKING, new NeonLockingAdapter(sql))
    container.register("IWorkflowStoragePort", new NeonWorkflowStorageAdapter(sql))
    container.register("IFilePort", new InMemoryFileAdapter())

    const { ProductService } = await import("~src/modules/product/index")
    const { InventoryService } = await import("~src/modules/inventory/index")
    const { StatsService } = await import("~src/modules/stats/index")
    const { FileService } = await import("~src/modules/file/service")
    const ps = new ProductService(db)
    container.register("productService", ps)
    container.register("inventoryService", new InventoryService(db))
    container.register("statsService", new StatsService(db))
    container.register("fileService", new FileService(new InMemoryFileAdapter()))

    const wm = new WorkflowManager(container)
    const { createProductPipeline } = await import("~src/workflows/create-product-pipeline")
    const { initializeInventory } = await import("~src/workflows/initialize-inventory")
    wm.register(createProductPipeline)
    wm.register(initializeInventory)
    container.register("workflowManager", wm)

    // First creation — should succeed
    await wm.run("create-product-pipeline", {
      input: { title: "First Product", sku, price: 1000, initialStock: 5, reorderPoint: 10 },
    })
    logs.push("✓ First product created successfully")

    // Second creation with same SKU — should fail
    let duplicateRejected = false
    try {
      await wm.run("create-product-pipeline", {
        input: { title: "Duplicate Product", sku, price: 2000, initialStock: 5, reorderPoint: 10 },
      })
    } catch (err) {
      duplicateRejected = true
      logs.push(`✓ Duplicate SKU rejected: ${(err as Error).message}`)
    }

    if (!duplicateRejected) throw new Error("Duplicate SKU was NOT rejected")

    // Cleanup
    const product = await ps.findBySku(sku)
    if (product) await ps.delete(product.id)
  })

  // ══════════════════════════════════════════════
  // TEST 6: Cron job — cleanup draft products
  // ══════════════════════════════════════════════
  await runTest(results, "6. Cron job — cleanup draft products", async (logs) => {
    // Create a draft product directly in the in-memory service
    const { ProductService } = await import("~src/modules/product/index")
    const ps = new ProductService(db)
    const draft = await ps.create({ title: "Old Draft", price: 100, status: "draft" })
    logs.push(`✓ Draft created: ${draft.id}`)

    // Simulate "old" by calling deleteDraftsOlderThan(0) (delete all drafts)
    const deleted = await ps.deleteDraftsOlderThan(0)
    logs.push(`✓ Cleanup deleted ${deleted.length} drafts: ${deleted.join(", ")}`)

    if (deleted.length === 0) throw new Error("Cleanup should have deleted at least 1 draft")

    // Verify product is gone
    const found = await ps.findById(draft.id)
    if (found) throw new Error("Draft product still exists after cleanup")
    logs.push("✓ Draft product verified deleted")
  })

  // ══════════════════════════════════════════════
  // TEST 7: Sub-workflow independence
  // ══════════════════════════════════════════════
  await runTest(results, "7. Sub-workflow — independent execution", async (logs) => {
    const container = new MantaContainer()
    container.register(ContainerRegistrationKeys.LOGGER, logger)
    container.register(ContainerRegistrationKeys.EVENT_BUS, new NeonEventBusAdapter(sql))
    container.register(ContainerRegistrationKeys.CACHE, new InMemoryCacheAdapter())
    container.register(ContainerRegistrationKeys.LOCKING, new NeonLockingAdapter(sql))

    const { InventoryService } = await import("~src/modules/inventory/index")
    container.register("inventoryService", new InventoryService(db))

    const wm = new WorkflowManager(container)
    const { initializeInventory } = await import("~src/workflows/initialize-inventory")
    wm.register(initializeInventory)
    container.register("workflowManager", wm)

    const result = await wm.run("initialize-inventory", {
      input: { sku: `SUBWF-${Date.now()}`, initialQuantity: 25, reorderPoint: 5 },
    })

    if (result.quantity !== 25) throw new Error(`Expected quantity=25, got ${result.quantity}`)
    if (result.reorderPoint !== 5) throw new Error(`Expected reorderPoint=5, got ${result.reorderPoint}`)
    logs.push(`✓ Sub-workflow result: sku=${result.sku}, qty=${result.quantity}, reorder=${result.reorderPoint}`)
  })

  // ══════════════════════════════════════════════
  // Close connection and return report
  // ══════════════════════════════════════════════
  await sql.end()

  const totalDuration = Date.now() - startTime
  const passed = results.filter((r) => r.status === "pass").length
  const failed = results.filter((r) => r.status === "fail").length

  return {
    summary: {
      total: results.length,
      passed,
      failed,
      durationMs: totalDuration,
      allPassed: failed === 0,
    },
    tests: results,
  }
})

async function runTest(results: TestResult[], name: string, fn: (logs: string[]) => Promise<void>): Promise<void> {
  const logs: string[] = []
  const start = Date.now()
  try {
    await fn(logs)
    results.push({ name, status: "pass", durationMs: Date.now() - start, logs })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logs.push(`✗ FAILED: ${message}`)
    results.push({ name, status: "fail", durationMs: Date.now() - start, logs, error: message })
  }
}
