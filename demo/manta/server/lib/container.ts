// Shared container singleton — used by catch-all handler and crons
// Boots once per cold start, reused across all requests

let containerPromise: Promise<ContainerResult> | null = null

interface ContainerResult {
  container: any
  logger: any
  db: any
  rawSql: (query: string) => Promise<any>
  close: () => Promise<void>
}

export function getContainer(): Promise<ContainerResult> {
  if (!containerPromise) {
    containerPromise = bootstrapContainer()
  }
  return containerPromise
}

async function bootstrapContainer(): Promise<ContainerResult> {
  const { MantaContainer, ContainerRegistrationKeys, InMemoryEventBusAdapter, InMemoryCacheAdapter, InMemoryFileAdapter, WorkflowManager } = await import("@manta/core")
  const { PinoLoggerAdapter } = await import("@manta/adapter-logger-pino")
  const { createNeonDatabase } = await import("@manta/adapter-neon")

  const logger = new PinoLoggerAdapter({ level: "info", pretty: false })
  logger.info("[manta:nitro] Bootstrapping container (Drizzle + Neon)...")

  // Create Drizzle db instance via Neon adapter
  const { db, rawSql, close } = createNeonDatabase({ url: process.env.DATABASE_URL! })
  logger.info("[manta:nitro] Neon connected via Drizzle")

  // Run migrations only if tables don't exist yet
  try {
    await rawSql("SELECT 1 FROM products LIMIT 1")
    logger.info("[manta:nitro] Tables already exist — skipping migrations")
  } catch {
    logger.info("[manta:nitro] Running migrations (first boot)...")
    try {
      await rawSql(`DO $$ BEGIN CREATE TYPE product_status AS ENUM ('draft', 'published', 'archived', 'active'); EXCEPTION WHEN duplicate_object THEN null; END $$`)
      await rawSql(`CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, sku TEXT, price INTEGER NOT NULL DEFAULT 0, status product_status NOT NULL DEFAULT 'draft', image_urls TEXT[] DEFAULT '{}', catalog_file_url TEXT, metadata JSONB DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ)`)
      await rawSql(`CREATE TABLE IF NOT EXISTS inventory_items (id TEXT PRIMARY KEY, sku TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0, reorder_point INTEGER NOT NULL DEFAULT 10, warehouse TEXT NOT NULL DEFAULT 'default', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`)
      await rawSql(`CREATE INDEX IF NOT EXISTS idx_inventory_sku ON inventory_items(sku)`)
      await rawSql(`CREATE TABLE IF NOT EXISTS stats (key TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0)`)
      await rawSql(`CREATE TABLE IF NOT EXISTS workflow_checkpoints (id SERIAL PRIMARY KEY, transaction_id TEXT NOT NULL, step_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', data JSONB DEFAULT '{}', error TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(transaction_id, step_id))`)
      await rawSql(`CREATE INDEX IF NOT EXISTS idx_wf_checkpoints_tx ON workflow_checkpoints(transaction_id)`)
      await rawSql(`CREATE TABLE IF NOT EXISTS workflow_executions (transaction_id TEXT PRIMARY KEY, workflow_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running', input JSONB DEFAULT '{}', result JSONB, error TEXT, started_at TIMESTAMPTZ DEFAULT NOW(), completed_at TIMESTAMPTZ)`)
      await rawSql(`CREATE TABLE IF NOT EXISTS events (id SERIAL PRIMARY KEY, event_name TEXT NOT NULL, data JSONB DEFAULT '{}', metadata JSONB DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER DEFAULT 0, max_attempts INTEGER DEFAULT 3, last_error TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), processed_at TIMESTAMPTZ)`)
      await rawSql(`CREATE TABLE IF NOT EXISTS job_executions (id SERIAL PRIMARY KEY, job_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running', result JSONB, error TEXT, duration_ms INTEGER, started_at TIMESTAMPTZ DEFAULT NOW(), completed_at TIMESTAMPTZ)`)
      await rawSql(`CREATE TABLE IF NOT EXISTS cron_heartbeats (id SERIAL PRIMARY KEY, job_name TEXT NOT NULL, message TEXT, executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
      logger.info("[manta:nitro] All tables created")
    } catch (err) {
      logger.warn("[manta:nitro] Migration warning: " + (err as Error).message)
    }
  }

  // Container
  const container = new MantaContainer()
  container.register(ContainerRegistrationKeys.LOGGER, logger)
  container.register(ContainerRegistrationKeys.EVENT_BUS, new InMemoryEventBusAdapter())
  container.register(ContainerRegistrationKeys.CACHE, new InMemoryCacheAdapter())
  container.register("IFilePort", new InMemoryFileAdapter())
  container.register("db", db)

  logger.info("[manta:nitro] Core: Drizzle DB, InMemory EventBus/Cache/File")

  // Load services
  const { ProductService } = await import("~src/modules/product/index")
  const { InventoryService } = await import("~src/modules/inventory/index")
  const { StatsService } = await import("~src/modules/stats/index")
  const { FileService } = await import("~src/modules/file/service")

  container.register("productService", new ProductService(db))
  container.register("inventoryService", new InventoryService(db))
  container.register("statsService", new StatsService(db))
  container.register("fileService", new FileService(new InMemoryFileAdapter()))
  logger.info("[manta:nitro] Services: ProductService(DB), InventoryService(DB), StatsService(DB), FileService(memory)")

  // WorkflowManager with Drizzle checkpoint persistence
  const wm = new WorkflowManager(container, db)
  const wfImports = [
    import("~src/workflows/create-product-pipeline"),
    import("~src/workflows/initialize-inventory"),
  ]
  for (const wfPromise of wfImports) {
    const mod = await wfPromise
    for (const value of Object.values(mod)) {
      if (value && typeof value === "object" && "name" in value && "steps" in value) {
        wm.register(value as any)
        logger.info(`[manta:nitro] Workflow: ${(value as any).name}`)
      }
    }
  }
  container.register("workflowManager", wm)

  // Resume any incomplete workflows from previous crashes
  const resumed = await wm.resumeIncomplete()
  if (resumed > 0) {
    logger.info(`[manta:nitro] Resumed ${resumed} incomplete workflow(s)`)
  }

  // Subscribers
  const eventBus = container.resolve<any>(ContainerRegistrationKeys.EVENT_BUS)
  const resolve = <T>(key: string): T => container.resolve<T>(key)

  const subImports = [
    import("~src/subscribers/product-created"),
    import("~src/subscribers/inventory-stocked"),
    import("~src/subscribers/low-stock-alert"),
  ]
  for (const subPromise of subImports) {
    const mod = await subPromise
    const sub = mod.default
    if (sub?.event && typeof sub.handler === "function") {
      eventBus.subscribe(sub.event, (msg: any) => sub.handler(msg, resolve))
      logger.info(`[manta:nitro] Subscriber: ${sub.event}`)
    }
  }

  // Close DB connection on SIGTERM (serverless graceful shutdown)
  process.on("SIGTERM", () => {
    logger.info("[manta:nitro] SIGTERM received — closing DB connection")
    close().catch(() => {})
  })

  logger.info("[manta:nitro] Container ready — all services backed by Drizzle/Neon")
  return { container, logger, db, rawSql, close }
}
