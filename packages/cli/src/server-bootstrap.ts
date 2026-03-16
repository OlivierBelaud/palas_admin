// Shared server bootstrap logic used by both `manta dev` and `manta start`

import { discoverRoutes } from './route-discovery'
import { discoverResources } from './resource-loader'
import { PinoLoggerAdapter } from '@manta/adapter-logger-pino'
import { DrizzlePgAdapter } from '@manta/adapter-drizzle-pg'
import { NitroAdapter } from '@manta/adapter-nitro'
import {
  MantaContainer,
  ContainerRegistrationKeys,
  InMemoryEventBusAdapter,
  InMemoryCacheAdapter,
  InMemoryLockingAdapter,
  InMemoryFileAdapter,
  WorkflowManager,
} from '@manta/core'
import type { ILoggerPort, IEventBusPort, IFilePort, Message } from '@manta/core'
import type { LoadedConfig } from './types'

/**
 * MantaRequest -- the request object passed to route handlers.
 * Extends the standard Request with framework-specific properties.
 */
export interface MantaRequest extends Request {
  validatedBody: unknown
  params: Record<string, string>
  scope: {
    resolve<T = unknown>(key: string): T
  }
  requestId: string
}

export interface ServerBootstrapOptions {
  config: LoadedConfig
  port: number
  cwd: string
  mode: 'dev' | 'prod'
  verbose?: boolean
}

export interface BootstrappedServer {
  logger: ILoggerPort
  db: DrizzlePgAdapter
  http: NitroAdapter
  shutdown: () => Promise<void>
}

/**
 * Bootstrap and start the Manta server.
 * Shared between `manta dev` and `manta start`.
 */
export async function bootstrapAndStart(options: ServerBootstrapOptions): Promise<never> {
  const { config, port, cwd, mode, verbose } = options

  // [1] Initialize logger
  const logger = new PinoLoggerAdapter({
    level: verbose ? 'debug' : 'info',
    pretty: mode === 'dev',
  })

  try {
    // [2] Initialize database adapter
    logger.info('Connecting to database...')
    const db = new DrizzlePgAdapter()
    await db.initialize({
      url: config.database!.url!,
      pool: config.database?.pool,
    })

    const healthy = await db.healthCheck()
    if (!healthy) {
      throw new Error('Database health check failed. Is PostgreSQL running?')
    }
    logger.info('Database connected')

    // [3] Auto-create tables (dev mode only)
    if (mode === 'dev') {
      const sql = db.getPool()
      await ensureProductTable(sql, logger)
    }

    // [4] Create container and register infrastructure adapters
    const container = new MantaContainer()
    container.register(ContainerRegistrationKeys.LOGGER, logger)
    container.register(ContainerRegistrationKeys.EVENT_BUS, new InMemoryEventBusAdapter())
    container.register(ContainerRegistrationKeys.CACHE, new InMemoryCacheAdapter())
    container.register(ContainerRegistrationKeys.LOCKING, new InMemoryLockingAdapter())
    container.register('IFilePort', new InMemoryFileAdapter())
    container.register(ContainerRegistrationKeys.DATABASE, db)

    // [5-18] Discover and wire all resources via ResourceLoader (lazy boot)
    logger.info('Discovering resources...')
    const resources = await discoverResources(cwd)

    // [Step 9] Load modules — discover *Service exports, instantiate & register
    for (const modInfo of resources.modules) {
      try {
        const imported = await import(`${modInfo.path}?t=${Date.now()}`)
        for (const [key, value] of Object.entries(imported)) {
          if (typeof value === 'function' && key.endsWith('Service')) {
            const ServiceClass = value as new (...args: unknown[]) => unknown
            const instance = tryInstantiateService(ServiceClass, container)
            if (instance) {
              const serviceName = key.charAt(0).toLowerCase() + key.slice(1)
              container.register(serviceName, instance)
              logger.info(`  Module: ${modInfo.name} → ${serviceName}`)
            }
          }
        }
      } catch (err) {
        logger.warn(`Failed to load module '${modInfo.name}': ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // [Step 12] Load and register workflows
    const wm = new WorkflowManager(container)
    for (const wfInfo of resources.workflows) {
      try {
        const imported = await import(`${wfInfo.path}?t=${Date.now()}`)
        for (const value of Object.values(imported)) {
          if (value && typeof value === 'object' && 'name' in value && 'steps' in value) {
            const wfDef = value as { name: string; steps: unknown[] }
            wm.register(wfDef)
            logger.info(`  Workflow: ${wfDef.name}`)
          }
        }
      } catch (err) {
        logger.warn(`Failed to load workflow '${wfInfo.id}': ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    container.register('workflowManager', wm)

    // [Step 13] Load and wire subscribers
    const eventBus = container.resolve<IEventBusPort>(ContainerRegistrationKeys.EVENT_BUS)
    const resolveFromContainer = <T>(key: string): T => container.resolve<T>(key)

    for (const subInfo of resources.subscribers) {
      try {
        const imported = await import(`${subInfo.path}?t=${Date.now()}`)
        const sub = imported.default as { event: string; handler: (msg: Message, resolve: <T>(key: string) => T) => Promise<void> }
        if (sub?.event && typeof sub.handler === 'function') {
          eventBus.subscribe(sub.event, (msg: Message) => sub.handler(msg, resolveFromContainer))
          logger.info(`  Subscriber: ${sub.event} → ${subInfo.id}`)
        }
      } catch (err) {
        logger.warn(`Failed to load subscriber '${subInfo.id}': ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // Create scope resolver for HTTP requests
    const scope = {
      resolve<T = unknown>(key: string): T {
        return container.resolve<T>(key)
      },
    }

    // [6] Initialize HTTP adapter and discover routes
    const http = new NitroAdapter({ port, isDev: mode === 'dev' })

    logger.info('Discovering routes...')
    const routes = await discoverRoutes(cwd)

    for (const route of routes) {
      const mod = await import(`${route.file}?t=${Date.now()}`)
      const handlerFn = mod[route.exportName] as (req: MantaRequest) => Promise<Response> | Response

      http.registerRoute(route.method, route.path, async (req: Request) => {
        const mantaReq = req as MantaRequest
        Object.defineProperty(mantaReq, 'scope', { value: scope, enumerable: true, configurable: true })
        Object.defineProperty(mantaReq, 'params', {
          value: extractParams(route.path, new URL(req.url).pathname),
          enumerable: true,
          configurable: true,
        })
        return handlerFn(mantaReq)
      })

      logger.info(`  ${route.method} ${route.path}`)
    }

    if (routes.length === 0) {
      logger.warn('No routes found in src/api/')
    }

    // [6b] Admin dashboard dev server (Vite proxy)
    if (mode === 'dev') {
      await setupAdminProxy(http, cwd, logger)
    }

    // [7] Start HTTP server
    await http.listen()
    logger.info(`Server listening on http://localhost:${port}`)
    logger.info('Health: GET /health/live, GET /health/ready')

    // [8] Handle graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down...')
      await http.close()
      await db.dispose()
      await container.dispose()
      process.exit(0)
    }

    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)

    // Block forever
    await new Promise(() => {})
    throw new Error('unreachable')
  } catch (err) {
    logger.error(`Failed to start ${mode} server`, err)
    throw err
  }
}

/**
 * Try to instantiate a service class, resolving constructor dependencies from the container.
 */
function tryInstantiateService(
  ServiceClass: new (...args: unknown[]) => unknown,
  container: MantaContainer,
): unknown | null {
  try {
    if (ServiceClass.length === 0) {
      return new ServiceClass()
    }
    const portKeys = ['IFilePort', 'IDatabasePort', 'ILoggerPort', 'IEventBusPort', 'ICachePort']
    for (const key of portKeys) {
      try {
        const port = container.resolve(key)
        return new ServiceClass(port)
      } catch {
        continue
      }
    }
    return null
  } catch {
    return null
  }
}

function extractParams(pattern: string, path: string): Record<string, string> {
  const params: Record<string, string> = {}
  const patternParts = pattern.split('/')
  const pathParts = path.split('/')

  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      const paramName = patternParts[i].slice(1)
      params[paramName] = pathParts[i] ?? ''
    }
  }

  return params
}

/**
 * Setup admin dashboard proxy.
 * If src/admin/ exists, spawn a Vite dev server and proxy /admin/* to it.
 */
async function setupAdminProxy(
  http: NitroAdapter,
  cwd: string,
  logger: ILoggerPort,
): Promise<void> {
  const { existsSync } = await import('node:fs')
  const { resolve, join } = await import('node:path')

  const adminDir = resolve(cwd, 'src/admin')
  const viteConfigPath = resolve(cwd, 'vite.config.ts')

  if (!existsSync(adminDir) || !existsSync(join(adminDir, 'index.html'))) {
    return
  }

  logger.info('Admin dashboard detected, starting Vite dev server...')

  const VITE_PORT = 5199

  // Spawn Vite dev server as a child process
  const { spawn } = await import('node:child_process')
  const viteProcess = spawn('npx', ['vite', '--config', viteConfigPath, '--port', String(VITE_PORT)], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '1' },
  })

  viteProcess.stdout?.on('data', (data: Buffer) => {
    const msg = data.toString().trim()
    if (msg) logger.info(`[vite] ${msg}`)
  })
  viteProcess.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim()
    if (msg && !msg.includes('ExperimentalWarning')) logger.warn(`[vite] ${msg}`)
  })

  // Wait a bit for Vite to start
  await new Promise((r) => setTimeout(r, 2000))

  // Register a catch-all proxy for /admin
  const { createProxyEventHandler } = await import('h3')
    .then(m => m)
    .catch(() => null) as any

  // Proxy /admin/* to Vite dev server using h3 app.use
  const app = (http as any)._app
  if (app && app.use) {
    const { defineEventHandler, getRequestURL, sendProxy } = await import('h3')

    app.use('/admin', defineEventHandler(async (event: any) => {
      const url = getRequestURL(event)
      const targetPath = url.pathname.replace(/^\/admin/, '') || '/'
      const targetUrl = `http://localhost:${VITE_PORT}/admin${targetPath}${url.search}`
      return sendProxy(event, targetUrl)
    }))

    // Also proxy Vite HMR websocket and assets
    app.use('/@vite', defineEventHandler(async (event: any) => {
      const url = getRequestURL(event)
      return sendProxy(event, `http://localhost:${VITE_PORT}${url.pathname}${url.search}`)
    }))
    app.use('/@fs', defineEventHandler(async (event: any) => {
      const url = getRequestURL(event)
      return sendProxy(event, `http://localhost:${VITE_PORT}${url.pathname}${url.search}`)
    }))
    app.use('/node_modules', defineEventHandler(async (event: any) => {
      const url = getRequestURL(event)
      return sendProxy(event, `http://localhost:${VITE_PORT}${url.pathname}${url.search}`)
    }))

    logger.info(`Admin dashboard: http://localhost:${(http as any)._port}/admin`)
  }

  // Kill Vite on shutdown
  process.on('exit', () => {
    viteProcess.kill()
  })
}

async function ensureProductTable(sql: unknown, logger: ILoggerPort): Promise<void> {
  const pg = sql as { (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown> }
  try {
    await pg`
      DO $$ BEGIN
        CREATE TYPE product_status AS ENUM ('draft', 'published', 'archived');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$
    `
    await pg`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        price INTEGER NOT NULL,
        status product_status NOT NULL DEFAULT 'draft',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMP
      )
    `
    logger.info('Table "products" ready')
  } catch (err) {
    logger.error('Failed to create table', err)
    throw err
  }
}
