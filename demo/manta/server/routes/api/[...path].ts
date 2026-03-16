// Catch-all Nitro handler for /api/** routes
// Boots the Manta container once with Drizzle + Neon, then dispatches

import { defineEventHandler, getMethod, readBody, getRequestURL } from "h3"

// Lazy-loaded route modules
const routeModules = {
  "admin/products": () => import("~src/api/admin/products/route"),
  "admin/products/[id]": () => import("~src/api/admin/products/[id]/route"),
  "admin/registry": () => import("~src/api/admin/registry/route"),
  "admin/test": () => import("~src/api/admin/test/route"),
}

// Lazy-loaded container bootstrap
let containerPromise: Promise<any> | null = null

async function getContainer() {
  if (!containerPromise) {
    containerPromise = bootstrapContainer()
  }
  return containerPromise
}

async function bootstrapContainer() {
  const { MantaContainer, ContainerRegistrationKeys, InMemoryEventBusAdapter, InMemoryCacheAdapter, InMemoryFileAdapter, WorkflowManager } = await import("@manta/core")
  const { PinoLoggerAdapter } = await import("@manta/adapter-logger-pino")
  const { createNeonDatabase } = await import("@manta/adapter-neon")

  const logger = new PinoLoggerAdapter({ level: "info", pretty: false })
  logger.info("[manta:nitro] Bootstrapping container (Drizzle + Neon)...")

  // Create Drizzle db instance via Neon adapter
  const { db, sql, close } = createNeonDatabase({ url: process.env.DATABASE_URL! })
  logger.info("[manta:nitro] Neon connected via Drizzle")

  // Run migrations (create tables if not exist)
  // Using raw SQL for DDL since Drizzle doesn't handle CREATE TABLE IF NOT EXISTS
  try {
    await sql`
      DO $$ BEGIN
        CREATE TYPE product_status AS ENUM ('draft', 'published', 'archived', 'active');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$
    `
    await sql`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, sku TEXT,
        price INTEGER NOT NULL DEFAULT 0, status product_status NOT NULL DEFAULT 'draft',
        image_urls TEXT[] DEFAULT '{}', catalog_file_url TEXT, metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `
    await sql`
      CREATE TABLE IF NOT EXISTS inventory_items (
        id TEXT PRIMARY KEY, sku TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0,
        reorder_point INTEGER NOT NULL DEFAULT 10, warehouse TEXT NOT NULL DEFAULT 'default',
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `
    await sql`CREATE INDEX IF NOT EXISTS idx_inventory_sku ON inventory_items(sku)`
    await sql`CREATE TABLE IF NOT EXISTS stats (key TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0)`
    await sql`
      CREATE TABLE IF NOT EXISTS workflow_checkpoints (
        id SERIAL PRIMARY KEY, transaction_id TEXT NOT NULL, step_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', data JSONB DEFAULT '{}', error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(transaction_id, step_id)
      )
    `
    await sql`CREATE INDEX IF NOT EXISTS idx_wf_checkpoints_tx ON workflow_checkpoints(transaction_id)`
    await sql`
      CREATE TABLE IF NOT EXISTS workflow_executions (
        transaction_id TEXT PRIMARY KEY, workflow_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running', input JSONB DEFAULT '{}',
        result JSONB, error TEXT, started_at TIMESTAMPTZ DEFAULT NOW(), completed_at TIMESTAMPTZ
      )
    `
    await sql`
      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY, event_name TEXT NOT NULL, data JSONB DEFAULT '{}',
        metadata JSONB DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER DEFAULT 0, max_attempts INTEGER DEFAULT 3, last_error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(), processed_at TIMESTAMPTZ
      )
    `
    await sql`CREATE INDEX IF NOT EXISTS idx_events_status ON events(status)`
    await sql`CREATE INDEX IF NOT EXISTS idx_events_name ON events(event_name)`
    await sql`
      CREATE TABLE IF NOT EXISTS job_executions (
        id SERIAL PRIMARY KEY, job_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running',
        result JSONB, error TEXT, duration_ms INTEGER,
        started_at TIMESTAMPTZ DEFAULT NOW(), completed_at TIMESTAMPTZ
      )
    `
    logger.info("[manta:nitro] All tables ready")
  } catch (err) {
    logger.warn("[manta:nitro] Migration warning: " + (err as Error).message)
  }

  // Container
  const container = new MantaContainer()
  container.register(ContainerRegistrationKeys.LOGGER, logger)
  container.register(ContainerRegistrationKeys.EVENT_BUS, new InMemoryEventBusAdapter())
  container.register(ContainerRegistrationKeys.CACHE, new InMemoryCacheAdapter())
  container.register("IFilePort", new InMemoryFileAdapter())
  container.register("db", db)  // Drizzle db instance — used by all services

  logger.info("[manta:nitro] Core: Drizzle DB, InMemory EventBus/Cache/File")

  // Load services — all take `db` (Drizzle instance) as constructor arg
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

  logger.info("[manta:nitro] Container ready — all services backed by Drizzle/Neon")
  return { container, logger, db }
}

// Route matching
function matchRoute(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean)
  const pathParts = pathname.split("/").filter(Boolean)
  if (patternParts.length !== pathParts.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i]
    if (p.startsWith("[") && p.endsWith("]")) {
      params[p.slice(1, -1)] = pathParts[i]
    } else if (p !== pathParts[i]) {
      return null
    }
  }
  return params
}

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event)
  const method = getMethod(event)
  const fullPath = url.pathname
  const apiPath = fullPath.replace(/^\/api\//, "")

  // Health check
  if (fullPath === "/api/health/live" || fullPath === "/health/live") {
    return { status: "alive", uptime_ms: Math.round(process.uptime() * 1000) }
  }
  if (fullPath === "/api/health/ready" || fullPath === "/health/ready") {
    return { status: "ready", uptime_ms: Math.round(process.uptime() * 1000) }
  }

  // Match route
  for (const [pattern, loader] of Object.entries(routeModules)) {
    const params = matchRoute(pattern, apiPath)
    if (!params) continue

    const mod = await loader()
    const handlerFn = (mod as any)[method] || (mod as any)[method.toUpperCase()]
    if (!handlerFn) continue

    const { container } = await getContainer()
    const scope = { resolve: <T = unknown>(key: string): T => container.resolve<T>(key) }

    let body = undefined
    if (method !== "GET" && method !== "HEAD") {
      try { body = await readBody(event) } catch {}
    }

    const req = new Request(url.toString(), { method })
    Object.defineProperty(req, "validatedBody", { value: body, enumerable: true })
    Object.defineProperty(req, "params", { value: params, enumerable: true })
    Object.defineProperty(req, "scope", { value: scope, enumerable: true })
    Object.defineProperty(req, "requestId", { value: crypto.randomUUID(), enumerable: true })

    console.log(`[manta:nitro] ${method} ${fullPath}`)
    const response = await handlerFn(req)

    const responseBody = await response.text()
    event.node.res.statusCode = response.status || 200
    response.headers?.forEach((value: string, key: string) => {
      event.node.res.setHeader(key, value)
    })
    return responseBody
  }

  event.node.res.statusCode = 404
  return { type: "NOT_FOUND", message: "Route not found" }
})
