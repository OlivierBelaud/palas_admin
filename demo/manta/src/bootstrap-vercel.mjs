// Bootstrap for Vercel serverless — no HTTP server, just the DI container
// Lazy-initialized on first request, cached for subsequent invocations (warm start)

import {
  MantaContainer,
  ContainerRegistrationKeys,
  InMemoryEventBusAdapter,
  InMemoryCacheAdapter,
  InMemoryLockingAdapter,
  InMemoryFileAdapter,
  WorkflowManager,
} from '@manta/core'
import { PinoLoggerAdapter } from '@manta/adapter-logger-pino'
import { DrizzlePgAdapter } from '@manta/adapter-drizzle-pg'

export async function bootstrapContainer() {
  console.log('[manta:vercel] Bootstrapping container (cold start)...')

  // Logger — JSON in prod (no pretty)
  const logger = new PinoLoggerAdapter({ level: 'info', pretty: false })

  // Database
  const db = new DrizzlePgAdapter()
  await db.initialize({
    url: process.env.DATABASE_URL,
    pool: { min: 1, max: 5 }, // conservative for serverless
  })
  logger.info('[manta:vercel] Database connected')

  // Container
  const container = new MantaContainer()
  container.register(ContainerRegistrationKeys.LOGGER, logger)
  container.register(ContainerRegistrationKeys.EVENT_BUS, new InMemoryEventBusAdapter())
  container.register(ContainerRegistrationKeys.CACHE, new InMemoryCacheAdapter())
  container.register(ContainerRegistrationKeys.LOCKING, new InMemoryLockingAdapter())
  container.register('IFilePort', new InMemoryFileAdapter())
  container.register(ContainerRegistrationKeys.DATABASE, db)

  // Load modules
  const modules = [
    () => import('./modules/file/index.ts'),
    () => import('./modules/inventory/index.ts'),
    () => import('./modules/product/index.ts'),
    () => import('./modules/stats/index.ts'),
  ]

  for (const loadModule of modules) {
    try {
      const mod = await loadModule()
      for (const [key, value] of Object.entries(mod)) {
        if (typeof value === 'function' && key.endsWith('Service')) {
          const ServiceClass = value
          let instance = null
          try {
            instance = ServiceClass.length === 0
              ? new ServiceClass()
              : new ServiceClass(container.resolve('IFilePort'))
          } catch {
            try { instance = new ServiceClass(container.resolve(ContainerRegistrationKeys.DATABASE)) } catch {}
          }
          if (instance) {
            const serviceName = key.charAt(0).toLowerCase() + key.slice(1)
            container.register(serviceName, instance)
            logger.info(`[manta:vercel] Module: ${serviceName}`)
          }
        }
      }
    } catch (err) {
      logger.warn(`[manta:vercel] Failed to load module: ${err.message}`)
    }
  }

  // Load workflows
  const workflows = [
    () => import('./workflows/create-product-pipeline.ts'),
    () => import('./workflows/initialize-inventory.ts'),
  ]

  const wm = new WorkflowManager(container)
  for (const loadWf of workflows) {
    try {
      const mod = await loadWf()
      for (const value of Object.values(mod)) {
        if (value && typeof value === 'object' && 'name' in value && 'steps' in value) {
          wm.register(value)
          logger.info(`[manta:vercel] Workflow: ${value.name}`)
        }
      }
    } catch (err) {
      logger.warn(`[manta:vercel] Failed to load workflow: ${err.message}`)
    }
  }
  container.register('workflowManager', wm)

  // Load subscribers
  const eventBus = container.resolve(ContainerRegistrationKeys.EVENT_BUS)
  const resolveFromContainer = (key) => container.resolve(key)

  const subscribers = [
    () => import('./subscribers/product-created.ts'),
    () => import('./subscribers/inventory-stocked.ts'),
    () => import('./subscribers/low-stock-alert.ts'),
  ]

  for (const loadSub of subscribers) {
    try {
      const mod = await loadSub()
      const sub = mod.default
      if (sub?.event && typeof sub.handler === 'function') {
        eventBus.subscribe(sub.event, (msg) => sub.handler(msg, resolveFromContainer))
        logger.info(`[manta:vercel] Subscriber: ${sub.event}`)
      }
    } catch (err) {
      logger.warn(`[manta:vercel] Failed to load subscriber: ${err.message}`)
    }
  }

  logger.info('[manta:vercel] Container ready')
  return container
}
