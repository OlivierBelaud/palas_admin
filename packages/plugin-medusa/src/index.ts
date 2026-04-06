// @manta/plugin-medusa — Medusa V2 as a Manta plugin
// Discovers and re-encodes Medusa modules, workflows, routes, subscribers, links, and admin
// into the Manta plugin convention (file-based discovery).

export { getAlerts, hasErrors, printAlerts } from './_internal/alerts'
export { type DiscoveredLink, discoverLinks } from './_internal/discovery/links'
export {
  buildEntityRelationInputs,
  type DiscoveredModel,
  type DiscoveredModule,
  type DiscoveredRelation,
  discoverModules,
} from './_internal/discovery/modules'
export { type DiscoveredSubscriber, discoverSubscribers } from './_internal/discovery/subscribers'
export {
  type ConvertedLink,
  convertMedusaLinks,
  type LinkRegistrationResult,
  LinkService,
  registerLinksInApp,
} from './_internal/mapping/link-loader'
export {
  loadMedusaApp,
  type MedusaAppLoaderOptions,
  type MedusaAppLoaderResult,
} from './_internal/mapping/medusa-app-loader'
export {
  discoverMiddlewares,
  findMatchingMiddlewares,
  type MiddlewareDiscoveryResult,
  type MiddlewareMapping,
} from './_internal/mapping/middleware-loader'
export {
  isCommerceModule,
  isFrameworkModule,
  registerAllModulesInApp,
} from './_internal/mapping/module-loader'
export {
  createRemoteQueryCallable,
  MedusaQueryAdapter,
  type MedusaQueryGraphConfig,
  type MedusaQueryGraphResult,
  type RemoteQueryFunction,
} from './_internal/mapping/query-adapter'
export {
  applyMiddlewares,
  bridgeAllRoutes,
  loadRouteHandlers,
  MedusaScope,
  type RouteHandlerEntry,
  type RouteRegistrationResult,
  type WrapOptions,
  wrapMedusaRouteHandler,
} from './_internal/mapping/route-bridge'
export {
  adaptMedusaHandler,
  registerSubscribersInApp,
  type SubscriberRegistrationResult,
} from './_internal/mapping/subscriber-loader'
export { installShim } from './_internal/shim/install'
export {
  type ClassifiedStep,
  classificationStats,
  classifyAllSteps,
  classifyStep,
  type StepCategory,
} from './_internal/transpiler/step-classifier'

// ====================================================================
// Plugin initializer — orchestrates the full Medusa → Manta bridge
// ====================================================================

import type { MantaApp } from '@manta/core'
import { InMemoryRepository } from '@manta/core'
import { discoverLinks } from './_internal/discovery/links'
import { discoverRoutes } from './_internal/discovery/routes'
import { discoverSubscribers } from './_internal/discovery/subscribers'
import { registerLinksInApp } from './_internal/mapping/link-loader'
import type { MedusaAppLoaderResult } from './_internal/mapping/medusa-app-loader'
import { discoverMiddlewares } from './_internal/mapping/middleware-loader'
import { createRemoteQueryCallable, MedusaQueryAdapter } from './_internal/mapping/query-adapter'
import { bridgeAllRoutes, MedusaScope, type RouteHandlerEntry } from './_internal/mapping/route-bridge'

export interface MedusaPluginStats {
  routes: number
  middlewares: number
  modules: number
  links: number
  subscribers: number
  tables?: number
}

export interface MedusaPluginResult {
  /** All route handler entries ready for H3 registration */
  entries: RouteHandlerEntry[]
  /** The MedusaScope instance (for direct testing) */
  scope: MedusaScope
  /** Discovery + registration stats */
  stats: MedusaPluginStats
  /** Shutdown hook (for real DB mode) */
  shutdown?: () => Promise<void>
}

/**
 * Initialize the Medusa plugin with REAL Medusa modules backed by PostgreSQL.
 *
 * Uses `MedusaApp()` from `@medusajs/modules-sdk` to boot 19 commerce modules
 * with MikroORM + PostgreSQL. Routes get real services, not in-memory stubs.
 *
 * @param app - The MantaApp (used for infra: logger, eventBus, etc.)
 * @param medusaApp - Result from loadMedusaApp() — real module services + query + link
 */
export function initMedusaPluginWithDb(
  // biome-ignore lint/suspicious/noExplicitAny: dynamic app
  app: MantaApp<any>,
  medusaApp: MedusaAppLoaderResult,
): MedusaPluginResult {
  // The real Medusa services — backed by MikroORM + PG
  const modules = medusaApp.modules

  // Use Medusa's REAL query (supports .graph() with cross-module joins via MikroORM)
  // and real link service — don't use our adapters, they're only for in-memory mode
  const realQuery = medusaApp.query
  const realLink = medusaApp.link

  // For MedusaScope constructor, pass a dummy adapter — the real query is registered as extra
  const dummyAdapter = new MedusaQueryAdapter(modules)
  const dummyRemoteQuery = createRemoteQueryCallable(modules)

  // MedusaScope with real services
  const scope = new MedusaScope(app, dummyAdapter, dummyRemoteQuery, realLink)

  // Override 'query' and 'remoteQuery' with the REAL Medusa implementations
  if (realQuery) {
    scope.register('query', realQuery)
    scope.register('remoteQuery', realQuery)
  }

  // Register ALL module services in the scope for direct access
  for (const [name, service] of Object.entries(modules)) {
    scope.register(name, service)
    scope.register(`${name}ModuleService`, service)
  }

  // Middlewares
  const { mappings: middlewareMappings, total: middlewareCount } = discoverMiddlewares()

  // Routes
  const discoveredRoutes = discoverRoutes()
  const { entries, result: routeResult } = bridgeAllRoutes(discoveredRoutes, app, {
    scope,
    middlewareMappings,
  })

  // Stats
  const discoveredSubscribers = discoverSubscribers()
  const discoveredLinks = discoverLinks()

  return {
    entries,
    scope,
    stats: {
      routes: routeResult.registered,
      middlewares: middlewareCount,
      modules: Object.keys(modules).length,
      links: discoveredLinks.length,
      subscribers: discoveredSubscribers.length,
      tables: medusaApp.tableCount,
    },
    shutdown: medusaApp.shutdown,
  }
}

/**
 * Initialize the Medusa plugin in in-memory mode (no database).
 * Uses InMemoryRepository-backed services — good for testing route discovery.
 */
export function initMedusaPlugin(
  // biome-ignore lint/suspicious/noExplicitAny: dynamic app
  app: MantaApp<any>,
): MedusaPluginResult {
  const queryAdapter = new MedusaQueryAdapter(app.modules)
  const remoteQuery = createRemoteQueryCallable(app.modules)

  const discoveredLinks = discoverLinks()
  const { linkService, result: linkResult } = registerLinksInApp(
    discoveredLinks,
    (_tableName: string) => new InMemoryRepository(),
  )

  const scope = new MedusaScope(app, queryAdapter, remoteQuery, linkService)

  const { mappings: middlewareMappings, total: middlewareCount } = discoverMiddlewares()

  const discoveredRoutes = discoverRoutes()
  const { entries, result: routeResult } = bridgeAllRoutes(discoveredRoutes, app, {
    scope,
    middlewareMappings,
  })

  const discoveredSubscribers = discoverSubscribers()
  const moduleCount = Object.keys(app.modules).length

  return {
    entries,
    scope,
    stats: {
      routes: routeResult.registered,
      middlewares: middlewareCount,
      modules: moduleCount,
      links: linkResult.total,
      subscribers: discoveredSubscribers.length,
    },
  }
}
