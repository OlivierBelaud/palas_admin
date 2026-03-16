// Catch-all Nitro handler for /api/** routes
// Boots the Manta container once, then dispatches to the matching route handler

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
  const { MantaContainer, ContainerRegistrationKeys, InMemoryCacheAdapter, InMemoryFileAdapter, WorkflowManager } = await import("@manta/core")
  const { PinoLoggerAdapter } = await import("@manta/adapter-logger-pino")
  const { DrizzlePgAdapter } = await import("@manta/adapter-drizzle-pg")
  const { NeonWorkflowStorageAdapter, NeonLockingAdapter, NeonEventBusAdapter, runMigrations } = await import("@manta/adapter-neon")
  const postgres = (await import("postgres")).default

  const logger = new PinoLoggerAdapter({ level: "info", pretty: false })
  logger.info("[manta:nitro] Bootstrapping container (serverless)...")

  // Raw SQL connection for Neon adapters
  const isServerless = !!process.env.VERCEL
  const sql = postgres(process.env.DATABASE_URL!, {
    ssl: "require",
    max: isServerless ? 1 : 5,
    idle_timeout: isServerless ? 0 : 30,
    connect_timeout: 5,
  })
  logger.info("[manta:nitro] PostgreSQL connected (Neon)")

  // Run all migrations (products table + adapter tables)
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
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        sku TEXT,
        price INTEGER NOT NULL DEFAULT 0,
        status product_status NOT NULL DEFAULT 'draft',
        image_urls TEXT[] DEFAULT '{}',
        catalog_file_url TEXT,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `
    logger.info("[manta:nitro] Table 'products' ready")

    // Neon adapter tables (workflow_checkpoints, events, job_executions)
    await runMigrations(sql)
    logger.info("[manta:nitro] Neon adapter tables ready")
  } catch (err) {
    logger.warn("[manta:nitro] Migration warning: " + (err as Error).message)
  }

  // Database adapter (for modules that use it)
  const db = new DrizzlePgAdapter()
  await db.initialize({
    url: process.env.DATABASE_URL!,
    pool: { min: 1, max: isServerless ? 1 : 5 },
  })

  // Neon-backed adapters (persistent, survive function crashes)
  const workflowStorage = new NeonWorkflowStorageAdapter(sql)
  const locking = new NeonLockingAdapter(sql)
  const eventBus = new NeonEventBusAdapter(sql)

  // Container
  const container = new MantaContainer()
  container.register(ContainerRegistrationKeys.LOGGER, logger)
  container.register(ContainerRegistrationKeys.EVENT_BUS, eventBus)
  container.register(ContainerRegistrationKeys.CACHE, new InMemoryCacheAdapter())
  container.register(ContainerRegistrationKeys.LOCKING, locking)
  container.register("IWorkflowStoragePort", workflowStorage)
  container.register("IFilePort", new InMemoryFileAdapter())
  container.register(ContainerRegistrationKeys.DATABASE, db)
  container.register("sql", sql) // Raw SQL for direct queries

  logger.info("[manta:nitro] Adapters: EventBus=Neon, Locking=Neon, WorkflowStorage=Neon, Cache=InMemory, File=InMemory")

  // Load modules
  const moduleImports = [
    import("~src/modules/file/index"),
    import("~src/modules/inventory/index"),
    import("~src/modules/product/index"),
    import("~src/modules/stats/index"),
  ]

  for (const modPromise of moduleImports) {
    const mod = await modPromise
    for (const [key, value] of Object.entries(mod)) {
      if (typeof value === "function" && key.endsWith("Service")) {
        const ServiceClass = value as new (...args: any[]) => any
        let instance = null
        try {
          instance = ServiceClass.length === 0 ? new ServiceClass() : new ServiceClass(container.resolve("IFilePort"))
        } catch {
          try { instance = new ServiceClass(container.resolve(ContainerRegistrationKeys.DATABASE)) } catch {}
        }
        if (instance) {
          const name = key.charAt(0).toLowerCase() + key.slice(1)
          container.register(name, instance)
          logger.info(`[manta:nitro] Module: ${name}`)
        }
      }
    }
  }

  // Workflows
  const wm = new WorkflowManager(container)
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

  // Subscribers
  const registeredEventBus = container.resolve<any>(ContainerRegistrationKeys.EVENT_BUS)
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
      registeredEventBus.subscribe(sub.event, (msg: any) => sub.handler(msg, resolve))
      logger.info(`[manta:nitro] Subscriber: ${sub.event}`)
    }
  }

  logger.info("[manta:nitro] Container ready")
  return { container, logger }
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
  // pathname after /api/ prefix
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

    // Parse body
    let body = undefined
    if (method !== "GET" && method !== "HEAD") {
      try { body = await readBody(event) } catch {}
    }

    // Build MantaRequest
    const req = new Request(url.toString(), { method })
    Object.defineProperty(req, "validatedBody", { value: body, enumerable: true })
    Object.defineProperty(req, "params", { value: params, enumerable: true })
    Object.defineProperty(req, "scope", { value: scope, enumerable: true })
    Object.defineProperty(req, "requestId", { value: crypto.randomUUID(), enumerable: true })

    console.log(`[manta:nitro] ${method} ${fullPath}`)
    const response = await handlerFn(req)

    // Convert Web Response to h3 response
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
