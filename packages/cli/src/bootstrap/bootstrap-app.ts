// bootstrapApp() — Portable application initialization.
// Zero dep HTTP. Fonctionne dans Next.js, Nuxt, Nitro standalone, ou un simple script.
//
// Responsabilites :
// 1. Charge le preset et instancie les adapters d'infra
// 2. Charge les modules (src/modules/)
// 3. Charge les subscribers (src/subscribers/)
// 4. Charge les jobs (src/jobs/)
// 5. Charge les workflows (src/workflows/)
// 6. Retourne le MantaApp pret
//
// Ne gere PAS : le serveur HTTP, le routing, le dashboard admin.

import { DrizzlePgAdapter } from '@manta/adapter-database-pg'
import { PinoLoggerAdapter } from '@manta/adapter-logger-pino'
import type { ILockingPort, ILoggerPort, MantaApp } from '@manta/core'
// Static value imports for registerGlobals — these are bundled by Nitro at build time.
// CRITICAL: do NOT use `await import('@manta/core')` for globals registration — on Vercel,
// the dynamic import resolves to the RAW .ts files in node_modules/@manta/core (which we
// copy for jiti) instead of the bundled chunks. Node.js can't import .ts → globals not set
// → every user file import fails → 0 commands registered → everything 404s.
import {
  defineAgent as _defineAgent,
  defineCommand as _defineCommand,
  defineCommandGraph as _defineCommandGraph,
  defineConfig as _defineConfig,
  defineJob as _defineJob,
  defineLink as _defineLink,
  defineMiddleware as _defineMiddleware,
  defineMiddlewares as _defineMiddlewares,
  defineModel as _defineModel,
  definePreset as _definePreset,
  defineQuery as _defineQuery,
  defineQueryGraph as _defineQueryGraph,
  defineService as _defineService,
  defineSubscriber as _defineSubscriber,
  defineUserModel as _defineUserModel,
  defineWorkflow as _defineWorkflow,
  field as _field,
  MantaError as _MantaError,
  many as _many,
  NullableModifier as _NullableModifier,
  InMemoryCacheAdapter,
  InMemoryEventBusAdapter,
  InMemoryFileAdapter,
  InMemoryJobScheduler,
  InMemoryLockingAdapter,
  InMemoryRepositoryFactory,
} from '@manta/core'
import type { IDatabasePort } from '@manta/core/ports'
import type { Sql } from 'postgres'
import { z as _z } from 'zod'
import type { discoverResources } from '../resource-loader'
import type { LoadedConfig } from '../types'
import type { AppRef, BootstrapContext } from './bootstrap-context'
import {
  assembleModules,
  buildApp,
  discoverResourcesPhase,
  initializeInfra,
  seedDevUsers,
  wireHttpEndpoints,
} from './phases'

export interface BootstrapOptions {
  config: LoadedConfig
  cwd: string
  mode: 'dev' | 'prod'
  verbose?: boolean
  /** Custom import function for .ts files (e.g. jiti). Falls back to native import(). */
  importFn?: (path: string) => Promise<Record<string, unknown>>
  /** Pre-discovered resources (from build-time manifest). Skips filesystem scan when provided. */
  preloadedResources?: import('../resource-loader').DiscoveredResources
  /** Pre-loaded module exports map (from build-time manifest). Used as importFn fallback. */
  preloadedImports?: Record<string, Record<string, unknown>>
  /** Pre-loaded plugin resources (from build-time manifest). Merged into resources when provided. */
  preloadedPluginResources?: Array<{
    name: string
    resources: import('../resource-loader').DiscoveredResources
    rootDir: string
  }>
}

export interface BootstrappedApp {
  app: MantaApp
  logger: ILoggerPort
  /** The H3 adapter with CQRS endpoints registered — pass to host for serving */
  adapter: import('@manta/adapter-h3').H3Adapter
  db: IDatabasePort
  resources: Awaited<ReturnType<typeof discoverResources>>
  shutdown: () => Promise<void>
}

/**
 * Adapter factory map — maps adapter package names to factory functions.
 * Production adapters use dynamic imports so they are only loaded when the preset requires them.
 *
 * The `builder` parameter is used for adapters that need to resolve already-registered infra
 * (e.g. IJobSchedulerPort needs ILockingPort + ILoggerPort). During the build phase, we
 * collect instances in a temporary map and pass it via the builder's registerInfra.
 */
export const ADAPTER_FACTORIES: Record<
  string,
  (options: Record<string, unknown>, infraMap?: Map<string, unknown>) => unknown | Promise<unknown>
> = {
  '@manta/adapter-logger-pino': (opts) => new PinoLoggerAdapter(opts),
  '@manta/adapter-database-pg': () => new DrizzlePgAdapter(),
  '@manta/adapter-database-neon': async () => {
    const { NeonDrizzleAdapter } = await import('@manta/adapter-database-neon')
    return new NeonDrizzleAdapter()
  },
  '@manta/adapter-cache-upstash': async (opts) => {
    const { UpstashCacheAdapter } = await import('@manta/adapter-cache-upstash')
    return new UpstashCacheAdapter(opts)
  },
  '@manta/adapter-locking-neon': async (_opts, infraMap) => {
    const { NeonLockingAdapter } = await import('@manta/adapter-locking-neon')
    const db = infraMap!.get('IDatabasePort') as { getPool: () => Sql }
    return new NeonLockingAdapter(
      db.getPool() as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Array<Record<string, unknown>>>,
    )
  },
  '@manta/adapter-file-vercel-blob': async (opts) => {
    const { VercelBlobAdapter } = await import('@manta/adapter-file-vercel-blob')
    return new VercelBlobAdapter(opts)
  },
  '@manta/adapter-jobs-vercel-cron': async (_opts, infraMap) => {
    const { VercelCronAdapter } = await import('@manta/adapter-jobs-vercel-cron')
    const locking = infraMap!.get('ILockingPort') as ILockingPort
    const logger = infraMap!.get('ILoggerPort') as ILoggerPort
    return new VercelCronAdapter(locking, logger)
  },
  '@manta/adapter-eventbus-upstash': async (opts) => {
    const { UpstashEventBusAdapter } = await import('@manta/adapter-eventbus-upstash')
    return new UpstashEventBusAdapter(opts)
  },
  '@manta/adapter-database-pg/DrizzleSchemaGenerator': async () => {
    const { DrizzleSchemaGenerator } = await import('@manta/adapter-database-pg')
    return new DrizzleSchemaGenerator()
  },
  '@manta/adapter-database-pg/DrizzleRepositoryFactory': async (_opts, infraMap) => {
    const { DrizzleRepositoryFactory } = await import('@manta/adapter-database-pg')
    return new DrizzleRepositoryFactory({ db: infraMap!.get('IDatabasePort') as IDatabasePort })
  },
  '@manta/core/InMemoryCacheAdapter': () => new InMemoryCacheAdapter(),
  '@manta/core/InMemoryEventBusAdapter': () => new InMemoryEventBusAdapter(),
  '@manta/core/InMemoryLockingAdapter': () => new InMemoryLockingAdapter(),
  '@manta/core/InMemoryFileAdapter': () => new InMemoryFileAdapter(),
  '@manta/core/InMemoryRepositoryFactory': () => new InMemoryRepositoryFactory(),
  '@manta/core/InMemoryJobScheduler': (_opts, infraMap) => {
    return new InMemoryJobScheduler(
      infraMap!.get('ILockingPort') as ILockingPort,
      infraMap!.get('ILoggerPort') as ILoggerPort,
    )
  },
}

/**
 * Register global symbols (defineModel, defineService, defineLink, defineCommand, field, many)
 * so that user code can use them without explicit imports.
 * Must be called BEFORE any user module is imported.
 */
async function registerGlobals() {
  // Force-reference NullableModifier so the bundler doesn't tree-shake nullable.ts.
  // biome-ignore lint/correctness/noUnusedVariables: side-effect anchor
  const _nm = _NullableModifier

  // Register all define* functions + field/many as globals so user source files
  // (loaded by jiti at runtime) can use them without imports.
  // Uses STATIC imports (bundled by Nitro at build time), NOT dynamic import('@manta/core').
  const g = globalThis as Record<string, unknown>
  if (!g.defineModel) g.defineModel = _defineModel
  if (!g.defineService) g.defineService = _defineService
  if (!g.defineLink) g.defineLink = _defineLink
  if (!g.defineCommand) g.defineCommand = _defineCommand
  if (!g.defineCommandGraph) g.defineCommandGraph = _defineCommandGraph
  if (!g.defineAgent) g.defineAgent = _defineAgent
  if (!g.defineSubscriber) g.defineSubscriber = _defineSubscriber
  if (!g.defineJob) g.defineJob = _defineJob
  if (!g.defineUserModel) g.defineUserModel = _defineUserModel
  if (!g.defineQuery) g.defineQuery = _defineQuery
  if (!g.defineQueryGraph) g.defineQueryGraph = _defineQueryGraph
  if (!g.defineWorkflow) g.defineWorkflow = _defineWorkflow
  if (!g.defineConfig) g.defineConfig = _defineConfig
  if (!g.definePreset) g.definePreset = _definePreset
  if (!g.defineMiddleware) g.defineMiddleware = _defineMiddleware
  if (!g.defineMiddlewares) g.defineMiddlewares = _defineMiddlewares
  if (!g.field) g.field = _field
  if (!g.many) g.many = _many
  if (!g.z) g.z = _z
  if (!g.MantaError) g.MantaError = _MantaError
}

/**
 * Bootstrap the Manta application — portable, zero HTTP.
 * Loads config, presets, adapters, modules, subscribers, jobs, workflows.
 * Returns the ready MantaApp.
 */
export async function bootstrapApp(options: BootstrapOptions): Promise<BootstrappedApp> {
  const { config, cwd, mode, verbose } = options

  // Import function: when preloadedImports is available (build-time manifest), look up
  // the module from the static import map first. Falls back to importFn (jiti) or native
  // dynamic import. The preloaded map eliminates ALL runtime filesystem access.
  const preloaded = options.preloadedImports
  const baseFn = options.importFn ?? ((path: string) => import(`${path}?t=${Date.now()}`))
  const doImport = preloaded
    ? async (path: string): Promise<Record<string, unknown>> => {
        if (preloaded[path]) return preloaded[path]
        // Try without trailing extension variations
        const withoutTs = path.replace(/\.tsx?$/, '')
        for (const key of Object.keys(preloaded)) {
          if (key === path || key.replace(/\.tsx?$/, '') === withoutTs) return preloaded[key]
        }
        // Fallback to runtime import (for edge cases not in manifest)
        return baseFn(path)
      }
    : baseFn

  // Register globals BEFORE any user code is imported
  await registerGlobals()

  const appRef: AppRef = { current: null }

  // Create shared bootstrap context
  const ctx: BootstrapContext = {
    cwd,
    mode,
    verbose: verbose ?? false,
    doImport,
    config,
    options,

    // Phase 1 — populated by initializeInfra
    logger: null as any,
    db: null as any,
    infraMap: new Map(),
    repoFactory: null as any,
    builder: null as any,
    generatePgTableFromDml: null as any,
    generateLinkPgTable: null as any,

    // Phase 2 — populated by discoverResourcesPhase
    resources: null as any,
    resolvedPlugins: [],

    // Phase 3 — populated by assembleModules
    generatedTables: new Map(),
    entityRegistry: new Map(),
    loadedLinks: [],
    entityCommandRegistry: new Map(),
    explicitCommandNames: new Set(),
    commandGraphDefs: new Map(),
    queryRegistry: null as any,
    queryGraphDefs: new Map(),
    queryExtensions: [],
    userDefinitions: [],
    moduleScopedCommandNames: [],
    cmdRegistry: null as any,
    agentRegistry: new Map(),

    // Phase 5 — populated by wireHttpEndpoints
    adapter: null as any,
    authService: null as any,
    jwtSecret: '',
    contextRegistry: null as any,
  }

  await initializeInfra(ctx, appRef)
  await discoverResourcesPhase(ctx)
  await assembleModules(ctx, appRef)
  await buildApp(ctx, appRef)
  await wireHttpEndpoints(ctx, appRef)
  await seedDevUsers(ctx, appRef)

  const app = appRef.current!
  const { logger, db, adapter, resources } = ctx

  // Shutdown function
  const shutdown = async () => {
    logger.info('Shutting down...')
    try {
      await db.dispose()
    } catch (err) {
      logger.error(`DB dispose failed: ${(err as Error).message}`)
    }
    try {
      await app.dispose()
    } catch (err) {
      logger.error(`App dispose failed: ${(err as Error).message}`)
    }
  }

  return { app, adapter, logger, db, resources, shutdown }
}
