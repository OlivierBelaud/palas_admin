// Module loader — registers Medusa COMMERCE modules into a MantaApp.
//
// ARCHITECTURE:
// 1. Manta boots its infra (EventBus, Cache, DB, Auth, etc.) via presets
// 2. This loader maps Medusa container keys to existing Manta ports
// 3. Only COMMERCE modules are loaded — framework modules (auth, locking, file, etc.)
//    are handled by Manta natively
//
// NO adapter instantiation here. The real adapters come from the Manta app infra.

import { InMemoryRepository, type MantaAppBuilder, type MantaInfra } from '@manta/core'
import { addAlert } from '../alerts'
import type { DiscoveredModule } from '../discovery/modules'

// ====================================================================
// Commerce vs Framework classification
// ====================================================================

/** Modules that are e-commerce specific — loaded by the plugin */
const COMMERCE_MODULES = new Set([
  'product',
  'order',
  'cart',
  'payment',
  'pricing',
  'fulfillment',
  'promotion',
  'inventory',
  'customer',
  'sales-channel',
  'tax',
  'currency',
  'region',
  'store',
  'stock-location',
])

/** Modules that are framework concerns — handled by Manta natively */
const FRAMEWORK_MODULES = new Set([
  'auth',
  'user',
  'api-key',
  'notification',
  'file',
  'locking',
  'analytics',
  'settings',
  'rbac',
  'translation',
])

export function isCommerceModule(name: string): boolean {
  return COMMERCE_MODULES.has(name)
}

export function isFrameworkModule(name: string): boolean {
  return FRAMEWORK_MODULES.has(name)
}

// ====================================================================
// Helpers
// ====================================================================

function createInternalService(repo: InMemoryRepository) {
  return {
    // biome-ignore lint/suspicious/noExplicitAny: Medusa InternalService compat
    async retrieve(id: string, _config?: any, _ctx?: any) {
      const results = await repo.find({ where: { id } })
      return results[0] ?? null
    },
    // biome-ignore lint/suspicious/noExplicitAny: Medusa InternalService compat
    async list(filters?: any, config?: any, _ctx?: any) {
      return repo.find({ where: filters, limit: config?.take, offset: config?.skip })
    },
    // biome-ignore lint/suspicious/noExplicitAny: Medusa InternalService compat
    async listAndCount(filters?: any, config?: any, _ctx?: any) {
      return repo.findAndCount({ where: filters, limit: config?.take, offset: config?.skip })
    },
    // biome-ignore lint/suspicious/noExplicitAny: Medusa InternalService compat
    async create(data: any, _ctx?: any) {
      return repo.create(Array.isArray(data) ? data : [data])
    },
    // biome-ignore lint/suspicious/noExplicitAny: Medusa InternalService compat
    async update(data: any, _ctx?: any) {
      if (Array.isArray(data)) {
        const results = []
        for (const item of data) {
          results.push(await repo.update(item))
        }
        return results
      }
      return repo.update(data)
    },
    // biome-ignore lint/suspicious/noExplicitAny: Medusa InternalService compat
    async delete(ids: any, _ctx?: any) {
      return repo.delete(Array.isArray(ids) ? ids : [ids])
    },
    // biome-ignore lint/suspicious/noExplicitAny: Medusa InternalService compat
    async softDelete(ids: any, _ctx?: any) {
      return repo.softDelete(Array.isArray(ids) ? ids : [ids])
    },
    // biome-ignore lint/suspicious/noExplicitAny: Medusa InternalService compat
    async restore(ids: any, _ctx?: any) {
      return repo.restore(Array.isArray(ids) ? ids : [ids])
    },
    __isMedusaInternalService: true,
    // biome-ignore lint/suspicious/noExplicitAny: ORM subscriber compat
    setEventSubscriber(_sub: any) {},
    // MikroORM compat — used by InjectManager shim
    getFreshManager() {
      return this
    },
    getActiveManager(ctx?: { transactionManager?: unknown; manager?: unknown }) {
      return ctx?.transactionManager ?? ctx?.manager ?? this
    },
  }
}

/**
 * Wrap a Manta IRepository with MikroORM-compatible methods.
 *
 * Medusa's InjectManager shim calls:
 *   1. baseRepository_.getFreshManager() → returns a "manager" (put in sharedContext.manager)
 *   2. Later, InternalService.create() calls manager.getEventManager() to register ORM event subscribers
 *
 * In Manta:
 *   - getFreshManager() returns the repo itself (Drizzle is stateless, no unit-of-work to fork)
 *   - getEventManager() returns a no-op event manager (events are handled by MessageAggregator, not ORM hooks)
 */
function wrapRepoForMedusa(repo: InMemoryRepository) {
  const wrapped = Object.create(repo)

  // MikroORM EntityManager compat
  wrapped.getFreshManager = function (_context?: Record<string, unknown>) {
    return this
  }
  wrapped.getActiveManager = function (context?: { transactionManager?: unknown; manager?: unknown }) {
    return context?.transactionManager ?? context?.manager ?? this.getFreshManager()
  }

  // MikroORM EntityManager.transaction() compat — used by @InjectTransactionManager decorator
  // In-memory: no real transactions, just call the callback with the repo itself as "manager"
  // biome-ignore lint/suspicious/noExplicitAny: MikroORM transaction compat
  wrapped.transaction = async function (callback: (manager: any) => Promise<any>, _options?: any) {
    return await callback(this)
  }

  // MikroORM EventManager compat — in Manta, events go through MessageAggregator, not ORM hooks
  // biome-ignore lint/suspicious/noExplicitAny: MikroORM subscriber compat
  const registeredSubscribers: any[] = []
  wrapped.getEventManager = () => ({
    subscribers: registeredSubscribers,
    // biome-ignore lint/suspicious/noExplicitAny: MikroORM subscriber compat
    registerSubscriber(sub: any) {
      registeredSubscribers.push(sub)
    },
    // biome-ignore lint/suspicious/noExplicitAny: MikroORM event compat
    dispatchEvent(_event: string, _args: any) {
      /* no-op — events handled by MessageAggregator */
    },
  })

  return wrapped
}

function lowerCaseFirst(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1)
}

// ====================================================================
// Module registration (MantaApp-based)
// ====================================================================

/**
 * Register all Medusa commerce modules into a MantaAppBuilder.
 * Uses a simple Map + Proxy for the Medusa cradle — no legacy container.
 */
export function registerAllModulesInApp(
  appBuilder: MantaAppBuilder,
  modules: DiscoveredModule[],
  infra: MantaInfra,
): { registered: number; skipped: number; failed: number; errors: string[] } {
  // Simple Map-based registry for Medusa cradle proxy
  const registry = new Map<string, unknown>()

  // Register infra
  registry.set('IEventBusPort', infra.eventBus)
  registry.set('event_bus', infra.eventBus)
  registry.set('eventBusModuleService', infra.eventBus)
  registry.set('ICachePort', infra.cache)
  registry.set('cache', infra.cache)
  registry.set('ILoggerPort', infra.logger)
  registry.set('logger', infra.logger)
  registry.set('ILockingPort', infra.locking)
  registry.set('IFilePort', infra.file)
  registry.set('db', (infra as unknown as Record<string, unknown>).db)
  registry.set('configModule', {
    projectConfig: {
      jwt_secret: process.env.JWT_SECRET ?? 'manta-dev-secret',
      cookie_secret: process.env.COOKIE_SECRET ?? 'manta-dev-cookie',
      database_url: process.env.DATABASE_URL ?? '',
    },
  })

  // Cradle Proxy — Medusa services receive this in their constructor
  // Access cradle.xxx → registry.get('xxx')
  const cradle = new Proxy({} as Record<string, unknown>, {
    get(_, key: string) {
      return registry.get(key)
    },
    has(_, key: string) {
      return registry.has(key)
    },
    ownKeys() {
      return [...registry.keys()]
    },
    getOwnPropertyDescriptor(_, key: string) {
      return registry.has(key) ? { configurable: true, enumerable: true, writable: false } : undefined
    },
  })

  // Register provider services
  for (const key of [
    'fulfillmentProviderService',
    'paymentProviderService',
    'notificationProviderService',
    'taxProviderService',
    'default_provider',
  ]) {
    if (!registry.has(key)) registry.set(key, createProviderRegistryStandalone(key))
  }

  // Register base repository
  if (!registry.has('baseRepository')) {
    registry.set('baseRepository', wrapRepoForMedusa(new InMemoryRepository()))
  }

  // Register custom repos
  if (!registry.has('pricingRepository')) {
    const repo = wrapRepoForMedusa(new InMemoryRepository())
    registry.set('pricingRepository', {
      ...createInternalService(repo),
      getFreshManager: repo.getFreshManager.bind(repo),
      getActiveManager: repo.getActiveManager.bind(repo),
      clearAvailableAttributes: () => {},
      setAvailableAttributes: () => {},
    })
  }

  let registered = 0
  let skipped = 0
  let failed = 0
  const errors: string[] = []

  for (const mod of modules) {
    if (!isCommerceModule(mod.name)) {
      skipped++
      continue
    }

    try {
      // Register sub-services for this module's models
      for (const model of mod.models) {
        const lowerName = lowerCaseFirst(model.name)
        if (!registry.has(`${lowerName}Repository`)) {
          registry.set(`${lowerName}Repository`, wrapRepoForMedusa(new InMemoryRepository()))
        }
        if (!registry.has(`${lowerName}Service`)) {
          registry.set(
            `${lowerName}Service`,
            createInternalService(registry.get(`${lowerName}Repository`) as InMemoryRepository),
          )
        }
      }

      const moduleDeclaration = {
        options: { worker_mode: 'shared' },
        jwt_secret: process.env.JWT_SECRET ?? 'manta-dev-secret',
        scope: mod.name,
      }

      // Instantiate with cradle proxy (same as Medusa does with Awilix)
      const service = new mod.service(cradle, moduleDeclaration)

      // Register in the Map (for other modules that may reference it)
      registry.set(mod.name, service)
      registry.set(`${mod.name}ModuleService`, service)

      // Register in the app builder
      appBuilder.registerModule(mod.name, service)
      registered++
    } catch (err) {
      addAlert({
        level: 'error',
        layer: 'module',
        artifact: mod.name,
        message: `Failed to register: ${(err as Error).message}`,
      })
      failed++
      errors.push(mod.name)
    }
  }

  return { registered, skipped, failed, errors }
}

function createProviderRegistryStandalone(name: string) {
  const providers = new Map<string, unknown>()
  return {
    register: (id: string, provider: unknown) => providers.set(id, provider),
    retrieve: (id: string) => providers.get(id) ?? null,
    list: () => [...providers.values()],
    listIdentifiers: () => [...providers.keys()],
  }
}
