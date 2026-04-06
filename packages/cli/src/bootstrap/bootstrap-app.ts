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

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  buildDrizzleRelations,
  DrizzlePgAdapter,
  DrizzleRelationalQuery,
  generateIntraModuleRelations,
  generateLinkRelations,
} from '@manta/adapter-database-pg'
import { H3Adapter } from '@manta/adapter-h3'
import { PinoLoggerAdapter } from '@manta/adapter-logger-pino'
import type { IEventBusPort, ILockingPort, ILoggerPort, MantaApp, Message, WorkflowStorage } from '@manta/core'
import {
  type CommandRegistry,
  createApp,
  InMemoryCacheAdapter,
  InMemoryEventBusAdapter,
  InMemoryFileAdapter,
  InMemoryJobScheduler,
  InMemoryLockingAdapter,
  InMemoryRepositoryFactory,
  instantiateServiceDescriptor,
  isServiceDescriptor,
  MantaError,
  WorkflowManager,
} from '@manta/core'
import type { ICachePort, IDatabasePort, IFilePort, IRepositoryFactory } from '@manta/core/ports'
import { resolveAdapters, resolvePreset } from '../config/resolve-adapters'
import { discoverResources } from '../resource-loader'
import { getRequestBody } from '../server-bootstrap'
import type { LoadedConfig } from '../types'

// ── DML entity type guard ─────────────────────────────────────────

interface DmlEntityLike {
  name: string
  schema: Record<string, unknown>
  getOptions?: () => Record<string, unknown>
}

function isDmlEntity(value: unknown): value is DmlEntityLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'schema' in value &&
    typeof (value as Record<string, unknown>).name === 'string'
  )
}

// ── Service class introspection type guard ────────────────────────

function hasModelObjects(
  cls: unknown,
): cls is (new (...args: unknown[]) => unknown) & { $modelObjects: Record<string, unknown> } {
  return typeof cls === 'function' && '$modelObjects' in cls
}

// ── Raw SQL with unsafe() ─────────────────────────────────────────

type PostgresSql = ReturnType<typeof postgres>

export interface BootstrapOptions {
  config: LoadedConfig
  cwd: string
  mode: 'dev' | 'prod'
  verbose?: boolean
  /** Custom import function for .ts files (e.g. jiti). Falls back to native import(). */
  importFn?: (path: string) => Promise<Record<string, unknown>>
}

export interface BootstrappedApp {
  app: MantaApp
  logger: ILoggerPort
  /** The H3 adapter with CQRS endpoints registered — pass to host for serving */
  adapter: H3Adapter
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
const ADAPTER_FACTORIES: Record<
  string,
  (options: Record<string, unknown>, infraMap?: Map<string, unknown>) => unknown | Promise<unknown>
> = {
  '@manta/adapter-logger-pino': (opts) => new PinoLoggerAdapter(opts),
  '@manta/adapter-database-pg': () => new DrizzlePgAdapter(),
  '@manta/adapter-database-neon': async () => {
    const { DrizzlePgAdapter: Adapter } = await import('@manta/adapter-database-pg')
    return new Adapter()
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

// ── Query handler helper ─────────────────────────────────────────────
// Shared logic for POST {basePath}/query/:entity endpoints.
// Handles: findById, list, search, filter, order, paginate, field selection,
// and context-aware relation stripping with warnings.

interface QueryHandlerOptions {
  contextName: string
  exposedModules: Set<string>
  logger?: { warn: (msg: string) => void }
}

async function handleQueryRequest(
  service: Record<string, unknown>,
  entity: string,
  body: Record<string, unknown>,
  options?: QueryHandlerOptions,
): Promise<Response> {
  const { id, fields, filters, limit, offset, order, q } = body as {
    id?: string
    fields?: string[]
    filters?: Record<string, unknown>
    limit?: number
    offset?: number
    order?: string
    q?: string
  }

  // Strip relation fields pointing to unmounted modules + collect warnings
  const warnings: string[] = []
  let filteredFields = fields
  if (fields && options?.exposedModules) {
    const allowed: string[] = []
    for (const f of fields) {
      if (f.includes('.')) {
        // Dotted field = relation (e.g. 'variants.id', 'inventory.quantity')
        const relationModule = f.split('.')[0]
        if (!options.exposedModules.has(relationModule)) {
          warnings.push(
            `relation '${relationModule}' unavailable in context '${options.contextName}' — module '${relationModule}' not mounted`,
          )
          options.logger?.warn(
            `[query] Stripped relation '${relationModule}' from ${entity} query — not mounted in context '${options.contextName}'`,
          )
          continue // Strip this field
        }
      }
      allowed.push(f)
    }
    filteredFields = allowed
  }

  // Detail query
  if (id) {
    if (typeof service.findById !== 'function') {
      return Response.json(
        { type: 'NOT_FOUND', message: `Entity "${entity}" does not support findById` },
        { status: 404 },
      )
    }
    const item = await service.findById(id)
    if (!item) return Response.json({ type: 'NOT_FOUND', message: `${entity} "${id}" not found` }, { status: 404 })
    const response: Record<string, unknown> = { data: item }
    if (warnings.length > 0) response.warnings = warnings
    return Response.json(response)
  }

  // List query
  if (typeof service.list !== 'function') {
    return Response.json({ type: 'NOT_FOUND', message: `Entity "${entity}" does not support list` }, { status: 404 })
  }
  let data: Record<string, unknown>[] = (await (service.list as () => Promise<unknown[]>)()) as Record<
    string,
    unknown
  >[]

  // Search
  if (q) {
    const lower = (q as string).toLowerCase()
    data = data.filter(
      (item) =>
        String(item.title ?? '')
          .toLowerCase()
          .includes(lower) ||
        String(item.description ?? '')
          .toLowerCase()
          .includes(lower) ||
        String(item.sku ?? '')
          .toLowerCase()
          .includes(lower),
    )
  }

  // Filters
  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      if (Array.isArray(value)) {
        data = data.filter((item) => value.includes(String(item[key])))
      } else {
        data = data.filter((item) => String(item[key]) === String(value))
      }
    }
  }

  // Ordering
  if (order) {
    let field: string
    let descending: boolean
    if ((order as string).startsWith('-')) {
      field = (order as string).slice(1)
      descending = true
    } else if ((order as string).includes(':')) {
      const [f, d] = (order as string).split(':')
      field = f
      descending = d === 'desc'
    } else {
      field = order as string
      descending = false
    }
    data.sort((a, b) => {
      const rawA = a[field] ?? ''
      const rawB = b[field] ?? ''
      if (typeof rawA === 'number' && typeof rawB === 'number') return descending ? rawB - rawA : rawA - rawB
      if (field.endsWith('_at')) {
        const ta = new Date(rawA as string | number | Date).getTime()
        const tb = new Date(rawB as string | number | Date).getTime()
        return descending ? tb - ta : ta - tb
      }
      const sa = String(rawA).toLowerCase()
      const sb = String(rawB).toLowerCase()
      return descending ? sb.localeCompare(sa) : sa.localeCompare(sb)
    })
  }

  // Paginate + field selection
  const count = data.length
  const sliced = data.slice(offset ?? 0, (offset ?? 0) + (limit ?? 100))
  let result = sliced
  if (filteredFields && filteredFields.length > 0) {
    result = sliced.map((item) => {
      const picked: Record<string, unknown> = {}
      for (const f of filteredFields) picked[f] = item[f]
      return picked
    })
  }

  const response: Record<string, unknown> = { data: result, count, limit: limit ?? 100, offset: offset ?? 0 }
  if (warnings.length > 0) response.warnings = warnings
  return Response.json(response)
}

/**
 * Register global symbols (defineModel, defineService, defineLink, defineCommand, field, many)
 * so that user code can use them without explicit imports.
 * Must be called BEFORE any user module is imported.
 */
async function registerGlobals() {
  const core = await import('@manta/core')
  const g = globalThis as Record<string, unknown>
  if (!g.defineModel) g.defineModel = core.defineModel
  if (!g.defineService) g.defineService = core.defineService
  if (!g.defineLink) g.defineLink = core.defineLink
  if (!g.defineCommand) g.defineCommand = core.defineCommand
  if (!g.defineAgent) g.defineAgent = core.defineAgent
  if (!g.defineSubscriber) g.defineSubscriber = core.defineSubscriber
  if (!g.defineJob) g.defineJob = core.defineJob
  if (!g.defineUserModel) g.defineUserModel = core.defineUserModel
  if (!g.defineQuery) g.defineQuery = core.defineQuery
  if (!g.defineQueryGraph) g.defineQueryGraph = core.defineQueryGraph
  if (!g.defineWorkflow) g.defineWorkflow = core.defineWorkflow
  if (!g.defineConfig) g.defineConfig = core.defineConfig
  if (!g.definePreset) g.definePreset = core.definePreset
  if (!g.defineMiddleware) g.defineMiddleware = core.defineMiddleware
  if (!g.field) g.field = core.field
  if (!g.many) g.many = core.many
}

/**
 * Bootstrap the Manta application — portable, zero HTTP.
 * Loads config, presets, adapters, modules, subscribers, jobs, workflows.
 * Returns the ready MantaApp.
 */
export async function bootstrapApp(options: BootstrapOptions): Promise<BootstrappedApp> {
  const { config, cwd, mode, verbose } = options
  const doImport = options.importFn ?? ((path: string) => import(`${path}?t=${Date.now()}`))

  // Register globals BEFORE any user code is imported
  await registerGlobals()

  // [1] Resolve preset and adapters
  const preset = resolvePreset(config)
  const resolvedAdapters = resolveAdapters(config, preset)

  // [2] Initialize logger
  const loggerEntry = resolvedAdapters.find((a) => a.port === 'ILoggerPort')
  const loggerOpts = { level: verbose ? 'debug' : 'info', pretty: mode === 'dev', ...loggerEntry?.options }
  const loggerFactory = ADAPTER_FACTORIES[loggerEntry?.adapter ?? '@manta/adapter-logger-pino']
  const logger = (loggerFactory ? loggerFactory(loggerOpts) : new PinoLoggerAdapter(loggerOpts)) as ILoggerPort

  // [3] Initialize database
  logger.info('Connecting to database...')
  const dbEntry = resolvedAdapters.find((a) => a.port === 'IDatabasePort')
  const dbFactory = dbEntry ? ADAPTER_FACTORIES[dbEntry.adapter] : undefined
  const db = (dbFactory ? dbFactory(dbEntry!.options) : new DrizzlePgAdapter()) as DrizzlePgAdapter

  await db.initialize({
    url: config.database!.url!,
    pool: config.database?.pool,
  })

  const healthy = await db.healthCheck()
  if (!healthy) throw new MantaError('INVALID_STATE', 'Database health check failed. Is PostgreSQL running?')
  logger.info('Database connected')

  // [4] Auto-create tables (dev mode only)
  if (mode === 'dev') {
    await ensureFrameworkTables(db.getPool(), logger)
  }

  // [5] Collect infra adapters, then build app via MantaAppBuilder
  // Temporary map for adapter factories that need to resolve other infra during creation
  const infraMap = new Map<string, unknown>()
  infraMap.set('ILoggerPort', logger)
  infraMap.set('IDatabasePort', db)

  // Register remaining adapters (sorted: IJobSchedulerPort last)
  const sortedAdapters = [...resolvedAdapters].sort((a, b) => {
    if (a.port === 'IJobSchedulerPort') return 1
    if (b.port === 'IJobSchedulerPort') return -1
    return 0
  })
  for (const entry of sortedAdapters) {
    if (['ILoggerPort', 'IDatabasePort', 'IHttpPort'].includes(entry.port)) continue
    const factory = ADAPTER_FACTORIES[entry.adapter]
    if (!factory) {
      throw new MantaError(
        'UNKNOWN_MODULES',
        `No factory for adapter "${entry.adapter}" (port: ${entry.port}). Is the package installed?`,
      )
    }
    const instance = await factory(entry.options, infraMap)
    infraMap.set(entry.port, instance)
    logger.info(`  ${entry.port} → ${entry.adapter}`)
  }

  // [5b] Create the repository factory — single source of truth for all repo creation
  const { DrizzleRepositoryFactory } = await import('@manta/adapter-database-pg')
  const repoFactory: IRepositoryFactory = db
    ? ((infraMap.get('IRepositoryFactory') as IRepositoryFactory) ?? new DrizzleRepositoryFactory({ db }))
    : new InMemoryRepositoryFactory()
  infraMap.set('IRepositoryFactory', repoFactory)

  // Build the MantaApp using the builder
  const builder = createApp({
    infra: {
      eventBus: (infraMap.get('IEventBusPort') ?? new InMemoryEventBusAdapter()) as IEventBusPort,
      logger,
      cache: (infraMap.get('ICachePort') ?? new InMemoryCacheAdapter()) as ICachePort,
      locking: (infraMap.get('ILockingPort') ?? new InMemoryLockingAdapter()) as ILockingPort,
      file: (infraMap.get('IFilePort') ?? new InMemoryFileAdapter()) as IFilePort,
      db: db.getClient(),
    },
  })

  // Register extra infra keys
  builder.registerInfra('IDatabasePort', db)
  builder.registerInfra('pgPool', db.getPool())
  for (const [key, value] of infraMap) {
    if (
      !['ILoggerPort', 'IDatabasePort', 'db', 'IEventBusPort', 'ICachePort', 'ILockingPort', 'IFilePort'].includes(key)
    ) {
      builder.registerInfra(key, value)
    }
  }

  // [6] Discover resources (app + plugins — Nuxt Layers style)
  logger.info('Discovering resources...')
  const { resolvePlugins } = await import('../plugins/resolve-plugins')
  const { mergePluginResources } = await import('../plugins/merge-resources')

  const resolvedPlugins = resolvePlugins(config, cwd)
  if (resolvedPlugins.length > 0) {
    logger.info(`  Plugins: ${resolvedPlugins.map((p) => p.name).join(', ')}`)
  }

  const appResources = await discoverResources(cwd)
  const resources = await mergePluginResources(resolvedPlugins, appResources)

  // [6b] Pre-load table generation utilities
  const { generatePgTableFromDml, generateLinkPgTable } = await import('@manta/adapter-database-pg')

  // Auto-generated table map: entityName → pgTable (built from DML entities, NOT hardcoded)
  const generatedTables = new Map<string, unknown>()

  // Entity registry: entityName → DmlEntity (for deferred service descriptor resolution)
  const entityRegistry = new Map<string, DmlEntityLike>()

  // [7] Load modules — discover DML entities, generate tables, instantiate services
  // Each module has entities discovered from entities/*/model.ts (no index.ts needed).
  for (const modInfo of resources.modules) {
    let entityCount = 0
    for (const entity of modInfo.entities) {
      try {
        // Import model.ts — must export a DmlEntity
        const modelMod = await doImport(entity.modelPath)

        // Find the DML entity in the model module exports
        let dmlEntity: DmlEntityLike | null = null
        for (const value of Object.values(modelMod)) {
          if (isDmlEntity(value) && typeof value.getOptions === 'function') {
            dmlEntity = value
            break
          }
          // Handle defineUserModel() exports — extract the .model DmlEntity
          if (
            typeof value === 'object' &&
            value !== null &&
            (value as Record<string, unknown>).__type === 'user' &&
            isDmlEntity((value as Record<string, unknown>).model) &&
            typeof ((value as Record<string, unknown>).model as DmlEntityLike).getOptions === 'function'
          ) {
            dmlEntity = (value as Record<string, unknown>).model as DmlEntityLike
            break
          }
        }
        if (!dmlEntity) continue

        // Tag entity with its module name + register in entity registry
        ;(dmlEntity as DmlEntityLike & { __module?: string }).__module = modInfo.name
        entityRegistry.set(dmlEntity.name, dmlEntity)

        const entityName = dmlEntity.name

        // External entity — skip table generation, migrations, and auto-service.
        // The entity stays in entityRegistry (visible to query graph, describe_entity, links),
        // but the resolver comes from a module-level `extendQueryGraph()`.
        const entityOptions =
          (dmlEntity as DmlEntityLike & { getOptions?: () => Record<string, unknown> }).getOptions?.() ?? {}
        if ((entityOptions as { external?: boolean }).external === true) {
          entityCount++
          logger.info(`  Module: ${modInfo.name}/${entity.name} → ${entityName} (external — no table)`)
          continue
        }

        // Import service.ts if it exists — may export a ServiceDescriptor (default) or class
        let serviceDescriptor: ReturnType<typeof isServiceDescriptor> extends true ? unknown : unknown = null
        let ServiceClass: (new (...args: unknown[]) => unknown) | null = null
        if (entity.servicePath) {
          try {
            const serviceMod = await doImport(entity.servicePath)
            const defaultExport = serviceMod.default
            if (isServiceDescriptor(defaultExport)) {
              // Detect empty service — factory returns no custom methods
              try {
                const fakeRepo = new Proxy({}, { get: () => async () => [] })
                const fakeLog = new Proxy({}, { get: () => () => {} })
                const methods = (defaultExport as { factory: (ctx: unknown) => Record<string, unknown> }).factory({
                  db: fakeRepo,
                  log: fakeLog,
                })
                if (Object.keys(methods).length === 0) {
                  logger.warn(
                    `Module "${modInfo.name}/${entity.name}": service.ts has no custom methods — delete it.\n` +
                      `    CRUD (create, update, delete, list, retrieve) is auto-generated from the model.`,
                  )
                }
              } catch {
                // Factory introspection failed — not critical
              }
              serviceDescriptor = defaultExport
            } else {
              // Legacy: class-based service
              for (const [key, value] of Object.entries(serviceMod)) {
                if (typeof value === 'function' && key.endsWith('Service')) {
                  ServiceClass = value as new (...args: unknown[]) => unknown
                  break
                }
              }
            }
          } catch {
            // service.ts failed to import — continue with model-only (CRUD auto-generated)
          }
        }

        // Generate table from DML entity
        if (db) {
          const { tableName, table } = generatePgTableFromDml(
            dmlEntity as unknown as Parameters<typeof generatePgTableFromDml>[0],
          )
          generatedTables.set(tableName, table)
          generatedTables.set(entityToTableKey(entityName), table)
        }

        // Resolve deferred entity on service descriptor (new API: entitySelector but no entity)
        if (serviceDescriptor && isServiceDescriptor(serviceDescriptor)) {
          const desc = serviceDescriptor as {
            _entityName?: string
            entity: unknown
            $modelObjects: Record<string, unknown>
          }
          if (desc._entityName && !desc.entity) {
            const resolved = entityRegistry.get(desc._entityName)
            if (resolved) {
              desc.entity = resolved
              desc.$modelObjects = { [resolved.name]: resolved }
            } else {
              // Fallback: use the current dmlEntity (service.ts is co-located with model.ts)
              desc.entity = dmlEntity
              desc.$modelObjects = { [dmlEntity.name]: dmlEntity }
            }
          }
        }

        // Instantiate service
        let instance: Record<string, unknown> | null = null

        if (serviceDescriptor && isServiceDescriptor(serviceDescriptor)) {
          // service.define() — functional API
          const tableKey = entityToTableKey(entityName)
          const table = generatedTables.get(tableKey)
          if (table) repoFactory.registerTable!(tableKey, table)
          const repo = repoFactory.createRepository(tableKey)
          instance = instantiateServiceDescriptor(serviceDescriptor, repo, undefined, logger)
        } else if (ServiceClass) {
          // Legacy: class-based service
          instance = tryInstantiateService(ServiceClass, infraMap, repoFactory) as Record<string, unknown> | null
        } else {
          // No service.ts — auto-generate CRUD from DML entity
          const tableKey = entityToTableKey(entityName)
          const table = generatedTables.get(tableKey)
          if (table) repoFactory.registerTable!(tableKey, table)
          try {
            const repo = repoFactory.createRepository(tableKey)
            instance = instantiateServiceDescriptor(
              {
                __type: 'service',
                entity: dmlEntity,
                factory: () => ({}),
                $modelObjects: { [entityName]: dmlEntity },
              } as unknown as Parameters<typeof instantiateServiceDescriptor>[0],
              repo,
              undefined,
              logger,
            )
          } catch {
            // Table not yet registered — skip (happens in InMemory or when table gen fails)
            const { InMemoryRepository } = await import('@manta/core')
            const repo = new InMemoryRepository(entityName.toLowerCase())
            instance = instantiateServiceDescriptor(
              {
                __type: 'service',
                entity: dmlEntity,
                factory: () => ({}),
                $modelObjects: { [entityName]: dmlEntity },
              } as unknown as Parameters<typeof instantiateServiceDescriptor>[0],
              repo,
              undefined,
              logger,
            )
          }
        }

        if (instance) {
          // Register under canonical camelCase key only
          const { toCamel } = await import('@manta/core')
          const camelEntity = toCamel(entityName)
          builder.registerModule(camelEntity, instance)
          // First entity of a module also registers under the module name
          if (entityCount === 0) {
            builder.registerModule(modInfo.name, instance)
            builder.registerModule(`${modInfo.name}Service`, instance)
          }
          entityCount++
          logger.info(`  Module: ${modInfo.name}/${entity.name} → ${camelEntity}`)
        }
      } catch (err) {
        logger.warn(
          `Failed to load entity '${modInfo.name}/${entity.name}': ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }

  // [7a] Load links (src/links/*.ts) and generate pivot tables
  // We collect the resolved links directly from the imports, NOT from the global registry
  // (the global registry may be a different module instance in Nitro/tsx bundler context)
  const loadedLinks: Array<Record<string, unknown>> = []
  for (const linkInfo of resources.links) {
    try {
      const mod = await doImport(linkInfo.path)
      const link = mod.default ?? mod
      if (link?.tableName && link?.leftFk && link?.rightFk) {
        loadedLinks.push(link)
        const { tableName, table } = generateLinkPgTable(link)
        generatedTables.set(tableName, table)
        if (repoFactory.registerTable) repoFactory.registerTable(tableName, table)
        logger.info(`  Link: ${link.leftEntity} ↔ ${link.rightEntity} → ${tableName}`)
      }
    } catch (err) {
      logger.warn(`Failed to load link '${linkInfo.id}': ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // [7b] Load intra-module links (modules/*/links/*.ts)
  // The framework detects if both entities are in the same module:
  //   - 1:1 or 1:N → direct FK on the child entity (no pivot table)
  //   - M:N → pivot table (even intra-module)
  const moduleEntityMap = new Map<string, string>() // entityName → moduleName
  for (const modInfo of resources.modules) {
    for (const entity of modInfo.entities) {
      moduleEntityMap.set(entity.name.toLowerCase(), modInfo.name)
    }
  }

  for (const modInfo of resources.modules) {
    for (const linkInfo of modInfo.intraLinks) {
      try {
        const mod = await doImport(linkInfo.path)
        const link = mod.default ?? mod
        if (link?.leftEntity && link?.rightEntity) {
          const leftName =
            typeof link.leftEntity === 'string'
              ? link.leftEntity
              : (link.leftEntity?.entityName ?? String(link.leftEntity))
          const rightName =
            typeof link.rightEntity === 'string'
              ? link.rightEntity
              : (link.rightEntity?.entityName ?? String(link.rightEntity))
          const leftMod = moduleEntityMap.get(leftName.toLowerCase())
          const rightMod = moduleEntityMap.get(rightName.toLowerCase())
          const isIntraModule = leftMod === rightMod && leftMod === modInfo.name

          if (isIntraModule && link.cardinality !== 'M:N') {
            // Direct FK — no pivot table needed
            // The FK column (e.g. customer_id) is added to the child entity table by the schema generator
            link.isDirectFk = true
            loadedLinks.push(link)
            logger.info(
              `  Link: ${link.leftEntity} → ${link.rightEntity} (FK direct, ${link.cardinality}, module: ${modInfo.name})`,
            )
          } else {
            // Pivot table — M:N or cross-module
            loadedLinks.push(link)
            if (link.tableName && link.leftFk && link.rightFk) {
              const { tableName, table } = generateLinkPgTable(link)
              generatedTables.set(tableName, table)
              if (repoFactory.registerTable) repoFactory.registerTable(tableName, table)
            }
            logger.info(
              `  Link: ${link.leftEntity} ↔ ${link.rightEntity} → ${link.tableName} (pivot, module: ${modInfo.name})`,
            )
          }
        }
      } catch (err) {
        logger.warn(
          `Failed to load intra-module link '${linkInfo.id}' in module '${modInfo.name}': ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }

  // Also register links in the app for step.delete() cascade resolution
  const linkRegistry = loadedLinks

  // [7c] Auto-create entity tables + link tables in dev mode (from DML entities, NOT hardcoded)
  if (mode === 'dev') {
    // Collect DML entities from discovered modules
    const discoveredEntities: Array<{ name: string; schema: Record<string, unknown> }> = []
    for (const modInfo of resources.modules) {
      for (const entity of modInfo.entities) {
        try {
          const mod = await doImport(entity.modelPath)
          for (const value of Object.values(mod)) {
            if (isDmlEntity(value) && typeof value.getOptions === 'function') {
              // Skip external entities — they live in third-party systems (PostHog, Stripe, …)
              // and are resolved via extendQueryGraph() resolvers, not backed by our database.
              // Creating a local Postgres table for them would be nonsense and pollutes the schema.
              const v = value as { isExternal?: () => boolean; name: string; schema: Record<string, unknown> }
              if (typeof v.isExternal === 'function' && v.isExternal()) continue
              discoveredEntities.push({ name: v.name, schema: v.schema })
            }
          }
        } catch {
          /* skip */
        }
      }
    }

    const { getRegisteredLinks } = await import('@manta/core')
    const discoveredLinks = getRegisteredLinks().map((l) => ({
      tableName: l.tableName,
      leftFk: l.leftFk,
      rightFk: l.rightFk,
    }))

    await ensureEntityTables(db.getPool(), discoveredEntities, discoveredLinks, logger)

    // [7d] Generate .manta/types.ts — typed step proxy from discovered entities
    await generateMantaTypes(cwd, resources.modules, doImport, logger)
  }

  // [7e] Register generated tables + links + entity registry in the app for step functions
  builder.registerInfra('__generatedTables', generatedTables)
  builder.registerInfra('__linkRegistry', linkRegistry)
  builder.registerInfra('__entityRegistry', entityRegistry)

  // [7f] Auto-generate entity commands from discovered modules
  // Each DML entity gets 5 atomic commands: create, update, delete, retrieve, list
  // These are registered as entity commands — no workflow, direct service call + emit
  const { generateEntityCommands: genEntityCmds } = await import('@manta/core')
  type EntityCommandDef = Awaited<ReturnType<typeof genEntityCmds>>[number]
  const entityCommandRegistry = new Map<string, EntityCommandDef>()
  for (const [entityName, dmlEntity] of entityRegistry.entries()) {
    // Skip external entities — they have no local storage, so auto-generated CRUD commands
    // (create/update/delete) would fail at runtime and confuse the AI tool registry with
    // unusable operations. External entities are read-only via their extendQueryGraph resolver.
    const ext = dmlEntity as { isExternal?: () => boolean }
    if (typeof ext.isExternal === 'function' && ext.isExternal()) continue
    const moduleName = (dmlEntity as { __module?: string }).__module
    if (!moduleName) continue
    try {
      const entityCmds = genEntityCmds(moduleName, dmlEntity as Parameters<typeof genEntityCmds>[1])
      for (const cmd of entityCmds) {
        entityCommandRegistry.set(cmd.name, cmd)
      }
      logger.info(`  Entity commands: ${moduleName}/${entityName} (${entityCmds.length} auto-generated)`)
    } catch (err) {
      logger.warn(
        `Failed to generate entity commands for '${moduleName}/${entityName}': ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  // [7g] Auto-generate link/unlink commands from defineLink() definitions
  // Each defineLink() gets 2 atomic commands: link-{a}-{b} and unlink-{a}-{b}
  const { generateLinkCommands: genLinkCmds } = await import('@manta/core')
  let linkCmdCount = 0
  for (const link of loadedLinks) {
    // Skip direct FK links (1:N intra-module) — no pivot table, no link/unlink commands
    if ((link as { isDirectFk?: boolean }).isDirectFk) continue
    try {
      const linkCmds = genLinkCmds(link as Parameters<typeof genLinkCmds>[0])
      for (const cmd of linkCmds) {
        entityCommandRegistry.set(cmd.name, cmd)
        linkCmdCount++
      }
    } catch (err) {
      logger.warn(`Failed to generate link commands: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (linkCmdCount > 0) {
    logger.info(`  Link commands: ${linkCmdCount} auto-generated (${linkCmdCount / 2} links)`)
  }

  builder.registerInfra('__entityCommandRegistry', entityCommandRegistry)

  // [8] Load workflows
  for (const wfInfo of resources.workflows) {
    try {
      const imported = await doImport(wfInfo.path)
      for (const [key, value] of Object.entries(imported)) {
        if (typeof value === 'function' && !key.startsWith('_')) {
          builder.registerWorkflow(key, value as (...args: unknown[]) => Promise<unknown>)
          logger.info(`  Workflow: ${key}`)
        }
      }
    } catch (err) {
      logger.warn(`Failed to load workflow '${wfInfo.id}': ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // [9] Load subscribers
  let app: MantaApp
  const resolveFromApp = <T>(key: string): T => app.resolve<T>(key)

  for (const subInfo of resources.subscribers) {
    try {
      const imported = await doImport(subInfo.path)
      const sub = imported.default
      if (sub?.event && typeof sub.handler === 'function') {
        const eventBus = infraMap.get('IEventBusPort') as IEventBusPort
        if (sub.__type === 'subscriber') {
          // defineSubscriber() — typed handler receives (event, { command, log })
          eventBus.subscribe(sub.event, async (msg: Message) => {
            try {
              await sub.handler(msg, { command: app.commands, log: logger })
            } catch (err) {
              throw MantaError.wrap(err, `subscriber:${subInfo.id}`)
            }
          })
        } else {
          // Legacy — handler receives (msg, resolve)
          eventBus.subscribe(sub.event, async (msg: Message) => {
            try {
              await sub.handler(msg, resolveFromApp)
            } catch (err) {
              throw MantaError.wrap(err, `subscriber:${subInfo.id}`)
            }
          })
        }
        logger.info(`  Subscriber: ${sub.event} → ${subInfo.id}`)
      }
    } catch (err) {
      logger.warn(`Failed to load subscriber '${subInfo.id}': ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // [10] Load jobs
  if (resources.jobs.length > 0) {
    let scheduler: {
      register: (name: string, schedule: string, handler: (...args: unknown[]) => unknown) => void
    } | null = null
    try {
      const s = infraMap.get('IJobSchedulerPort')
      if (s)
        scheduler = s as {
          register: (name: string, schedule: string, handler: (...args: unknown[]) => unknown) => void
        }
    } catch {
      logger.warn('IJobSchedulerPort not registered — skipping job loading')
    }

    if (scheduler) {
      for (const jobInfo of resources.jobs) {
        try {
          const imported = await doImport(jobInfo.path)
          const job = imported.default as {
            name: string
            schedule: string
            handler: (scope: { command: unknown; log: unknown }) => Promise<unknown>
          }
          if (job?.name && job.schedule && typeof job.handler === 'function') {
            scheduler.register(job.name, job.schedule, async () => {
              try {
                const result = await job.handler({ command: app.commands, log: logger })
                return { status: 'success' as const, data: result, duration_ms: 0 }
              } catch (err) {
                throw MantaError.wrap(err, `job:${job.name}`)
              }
            })
            logger.info(`  Job: ${job.name} (${job.schedule})`)
          }
        } catch (err) {
          logger.warn(`Failed to load job '${jobInfo.id}': ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
  }

  // [11] Load agents (AI step definitions)
  // biome-ignore lint/suspicious/noExplicitAny: agent definition
  const agentRegistry = new Map<string, any>()
  if (resources.agents && resources.agents.length > 0) {
    for (const agentInfo of resources.agents) {
      try {
        const imported = await doImport(agentInfo.path)
        const agentDef = imported.default
        if (agentDef?.name) {
          agentRegistry.set(agentDef.name, agentDef)
          logger.info(`  Agent: ${agentDef.name}`)
        }
      } catch (err) {
        logger.warn(`Failed to load agent '${agentInfo.id}': ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }
  builder.registerInfra('__agentRegistry', agentRegistry)

  // [12] Load commands — cross-module (src/commands/) + intra-module (modules/*/commands/)
  // Also detect defineCommandGraph() files for context-aware command exposure
  const { isCommandAllowed: isEntityCmdAllowed } = await import('@manta/core')
  type CommandGraphDef = import('@manta/core').CommandGraphDefinition
  const commandGraphDefs = new Map<string, CommandGraphDef>()
  const explicitCommandNames = new Set<string>()

  for (const cmdInfo of resources.commands) {
    try {
      const imported = await doImport(cmdInfo.path)
      const def = imported.default

      // Detect defineCommandGraph() exports
      if (def?.__type === 'command-graph') {
        const context = cmdInfo.context ?? 'admin'
        commandGraphDefs.set(context, def as CommandGraphDef)
        logger.info(
          `  CommandGraph: ${context} (${def.access === '*' ? 'wildcard' : Object.keys(def.access).join(', ')})`,
        )
        continue
      }

      if (def?.name && def?.description && def?.input && typeof def?.workflow === 'function') {
        builder.registerCommand(def)
        explicitCommandNames.add(def.name)
        logger.info(`  Command: ${def.name}`)
      }
    } catch (err) {
      logger.warn(`Failed to load command '${cmdInfo.id}': ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // [12b] Load intra-module commands (modules/*/commands/*.ts — commands scoped to this module)
  // Collect names as we go — V2 filesystem-derived contexts below need them to expose the
  // commands over HTTP. Without this, `POST /api/{ctx}/command/{modulePrefix}:{name}` would
  // 404 because ctx.commands wouldn't contain the module-scoped command.
  const moduleScopedCommandNames: string[] = []
  for (const modInfo of resources.modules) {
    for (const cmdInfo of modInfo.commands) {
      try {
        const imported = await doImport(cmdInfo.path)
        const def = imported.default
        const handlerFn = def?.workflow ?? def?.handler
        if (def?.name && def?.input && typeof handlerFn === 'function') {
          const normalizedDef = {
            __type: 'command' as const,
            name: def.name,
            description: def.description ?? '',
            input: def.input,
            __moduleScope: modInfo.name,
            workflow: handlerFn,
          }
          builder.registerCommand(normalizedDef)
          moduleScopedCommandNames.push(def.name)
          logger.info(`  Command: ${def.name} (module: ${modInfo.name})`)
        }
      } catch (err) {
        logger.warn(
          `Failed to load module command '${modInfo.name}/${cmdInfo.id}': ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }

  // [12c] Load queries + query graphs — V2 (src/queries/{context}/*.ts)
  const { QueryRegistry: QR, isEntityAllowed } = await import('@manta/core')
  const queryRegistry = new QR()
  const queryGraphDefs = new Map<string, { entities: '*' | string[] }>()
  if (resources.queries.length > 0) {
    for (const queryInfo of resources.queries) {
      try {
        const imported = await doImport(queryInfo.path)
        const def = imported.default
        if (def?.__type === 'query-graph') {
          queryGraphDefs.set(queryInfo.context, def)
          // `QueryGraphDefinition.access` is either '*' (wildcard) or an entity access map.
          // NB: older code read `def.entities` which doesn't exist on the type — that call
          // crashed on `.join` and dropped execution into the catch block below, producing
          // a misleading "Failed to load query 'graph'" warning even though the graph had
          // already been registered on the line above.
          const desc = def.access === '*' ? 'wildcard' : Object.keys(def.access).join(', ')
          logger.info(`  QueryGraph: ${queryInfo.context} (${desc})`)
        } else if (
          def?.name &&
          def?.description &&
          def?.input &&
          typeof def?.handler === 'function' &&
          def?.__type === 'query'
        ) {
          queryRegistry.register(def)
          logger.info(`  Query: ${def.name} (context: ${queryInfo.context})`)
        }
      } catch (err) {
        logger.warn(`Failed to load query '${queryInfo.id}': ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  // [12c.1] Load intra-module queries (modules/{name}/queries/*.ts)
  // A file in queries/ can export either a `defineQuery` OR an `extendQueryGraph` result —
  // the framework inspects the `__type` and routes accordingly. No special paths, no config.
  const queryExtensions: import('@manta/core').QueryGraphExtensionDefinition[] = []
  for (const modInfo of resources.modules) {
    for (const queryInfo of modInfo.queries) {
      try {
        const imported = await doImport(queryInfo.path)
        const def = imported.default

        if (def?.__type === 'query-extension' && Array.isArray(def.owns) && typeof def.resolve === 'function') {
          // Query graph extension (extendQueryGraph): registered later on QueryService
          ;(def as { __module?: string }).__module = modInfo.name
          queryExtensions.push(def as import('@manta/core').QueryGraphExtensionDefinition)
          logger.info(`  QueryGraph extension: ${modInfo.name}/${queryInfo.id} (owns: ${def.owns.join(', ')})`)
          continue
        }

        if (
          def?.name &&
          def?.description &&
          def?.input &&
          typeof def?.handler === 'function' &&
          def?.__type === 'query'
        ) {
          ;(def as { __moduleScope?: string }).__moduleScope = modInfo.name
          queryRegistry.register(def)
          logger.info(`  Query: ${def.name} (module: ${modInfo.name})`)
        }
      } catch (err) {
        logger.warn(
          `Failed to load module query '${modInfo.name}/${queryInfo.id}': ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }
  builder.registerInfra('queryRegistry', queryRegistry)

  // [12d] Load user definitions — V2 (modules/*-user/index.ts with defineUserModel)
  // biome-ignore lint/suspicious/noExplicitAny: user definition shape
  const userDefinitions: Array<{ contextName: string; def: any }> = []
  if (resources.users.length > 0) {
    for (const userInfo of resources.users) {
      try {
        const imported = await doImport(userInfo.path)
        const def = imported.default
        if (def?.__type === 'user' && def?.contextName) {
          userDefinitions.push({ contextName: def.contextName, def })
          logger.info(`  User: ${def.contextName} (module: ${userInfo.moduleName})`)
        }
      } catch (err) {
        logger.warn(
          `Failed to load user definition '${userInfo.moduleName}': ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }

  // [11b] Wire command callables (with WorkflowManager — uses deferred `app` reference)
  const cmdRegistry = builder.getCommandRegistry()
  if (cmdRegistry) {
    const wfStorageInstance = infraMap.get('IWorkflowStoragePort') as WorkflowStorage | undefined
    for (const entry of cmdRegistry.list()) {
      builder.registerCommandCallable(
        entry.name,
        async (input: unknown, httpCtx?: { auth?: unknown; headers?: Record<string, string | undefined> }) => {
          try {
            const parsed = entry.inputSchema.parse(input)
            const wm = new WorkflowManager(app, { storage: wfStorageInstance })
            wm.register({ name: `cmd:${entry.name}`, fn: entry.workflow })
            const { result } = await wm.run(`cmd:${entry.name}`, {
              input: parsed as Record<string, unknown>,
              // Pass HTTP context (auth + headers) — accessible in defineCommand but NOT in module workflows
              ...(httpCtx ? { __httpCtx: httpCtx } : {}),
            })
            return result
          } catch (err) {
            throw MantaError.wrap(err, `command:${entry.name}`)
          }
        },
      )
    }
    logger.info(`Commands: ${cmdRegistry.list().length} registered`)
  }

  // [11c] Wire entity command callables — direct service call, NO WorkflowManager
  // Entity commands are atomic (single CRUD + emit) — no compensation needed.
  let entityCmdCount = 0
  for (const [cmdName, entityCmd] of entityCommandRegistry.entries()) {
    // Skip if an explicit command with the same name exists (explicit > auto-generated)
    if (explicitCommandNames.has(cmdName)) {
      logger.info(`  Entity command skipped (overridden): ${cmdName}`)
      continue
    }
    builder.registerCommandCallable(
      cmdName,
      async (input: unknown, _httpCtx?: { auth?: unknown; headers?: Record<string, string | undefined> }) => {
        // Validate input — let ZodError propagate directly for proper 400 response
        const parsed = entityCmd.input.parse(input)
        try {
          // Direct call — no workflow, no compensation, no checkpointing
          return await entityCmd.workflow(parsed, { app } as unknown as import('@manta/core').StepContext)
        } catch (err) {
          throw MantaError.wrap(err, `entity-command:${cmdName}`)
        }
      },
    )
    entityCmdCount++
  }
  if (entityCmdCount > 0) {
    logger.info(`Entity commands: ${entityCmdCount} auto-generated`)
  }

  // [12] Wire up IRelationalQueryPort for native SQL JOINs
  // 1. Collect DML entity relations from all loaded modules
  // 2. Collect cross-module links
  // 3. Generate Drizzle relations() definitions
  // 4. Assemble full schema (tables + relations)
  // 5. Set schema on adapter → enables db.query.* API
  // 6. Register DrizzleRelationalQuery for query.graph() delegation
  try {
    if (db && typeof (db as DrizzlePgAdapter).setSchema === 'function') {
      // Use auto-generated tables + framework tables
      // Only keep ONE key per table object — prefer camelCase (Drizzle convention for db.query)
      const frameworkTables = await import('@manta/core/db').catch(() => ({}) as Record<string, unknown>)
      const allTables: Record<string, unknown> = { ...frameworkTables }
      const seenTableObjects = new Map<unknown, string>()
      // Iterate generatedTables — snake_case keys come first, then camelCase.
      // We want the camelCase to win, so we let it overwrite.
      for (const [key, table] of generatedTables) {
        const existing = seenTableObjects.get(table)
        if (existing) {
          // Same table under different key — keep whichever doesn't have underscores (camelCase)
          if (!key.includes('_') && existing.includes('_')) {
            delete allTables[existing]
            allTables[key] = table
            seenTableObjects.set(table, key)
          }
          // else keep existing (already camelCase or first-seen)
        } else {
          allTables[key] = table
          seenTableObjects.set(table, key)
        }
      }

      // Collect DML entity relation metadata from discovered modules
      const { parseDmlEntity, getRegisteredLinks } = await import('@manta/core')
      const entityInputs = []
      for (const modInfo of resources.modules) {
        for (const entity of modInfo.entities) {
          try {
            const mod = await doImport(entity.modelPath)
            for (const [_key, value] of Object.entries(mod)) {
              if (isDmlEntity(value) && typeof value.getOptions === 'function') {
                // Skip external entities — they have no table, Drizzle can't relate them
                const opts = value.getOptions() as { external?: boolean }
                if (opts.external === true) continue

                const parsed = parseDmlEntity(value)
                if (parsed.relations && parsed.relations.length > 0) {
                  entityInputs.push({
                    entityName: parsed.name,
                    tableName: `${parsed.name.toLowerCase()}s`,
                    relations: parsed.relations,
                  })
                }
              }
            }
          } catch {
            // Entity model may not export DML entities — skip silently
          }
        }
      }

      // Generate relation defs from DML entities + links
      const intraDefs = generateIntraModuleRelations(entityInputs)
      const linkDefs = generateLinkRelations(getRegisteredLinks())
      const allDefs = [...intraDefs, ...linkDefs]

      // Build real Drizzle relations() and assemble full schema
      // allTables values are PgTable instances at runtime — cast to satisfy buildDrizzleRelations signature
      const drizzleRelations = buildDrizzleRelations(allDefs, allTables as Parameters<typeof buildDrizzleRelations>[1])
      const fullSchema = { ...allTables, ...drizzleRelations }

      // Set schema on the adapter to enable db.query.* API
      ;(db as DrizzlePgAdapter).setSchema(fullSchema)

      // Create relational query adapter
      // Build relation alias map: entity → { userFriendlyName → drizzleRelName }
      // e.g. for customerGroup: { customers: 'customerCustomerGroup' }
      const { getRegisteredLinks: getLinks2 } = await import('@manta/core')
      const relationAliases = new Map<string, Record<string, string>>()
      const toCamelAlias = (s: string) => s.replace(/[_-]([a-z])/g, (_: string, c: string) => c.toUpperCase())
      const pluralizeAlias = (s: string) => {
        if (s.endsWith('s') || s.endsWith('x') || s.endsWith('ch') || s.endsWith('sh')) return `${s}es`
        if (s.endsWith('y') && !/[aeiou]y$/i.test(s)) return `${s.slice(0, -1)}ies`
        return `${s}s`
      }
      for (const link of getLinks2()) {
        const leftCamel = toCamelAlias(link.leftEntity.toLowerCase())
        const rightCamel = toCamelAlias(link.rightEntity.toLowerCase())
        const pivotCamel = toCamelAlias(link.tableName)
        const isMany = link.cardinality === 'M:N'

        // On leftEntity: 'customers' → 'customerCustomerGroup' (if M:N, use right entity name pluralized)
        const leftNorm = leftCamel.replace(/[_\s-]/g, '').toLowerCase()
        const rightNorm = rightCamel.replace(/[_\s-]/g, '').toLowerCase()

        const leftAliases = relationAliases.get(leftNorm) ?? {}
        leftAliases[isMany ? pluralizeAlias(rightCamel) : rightCamel] = pivotCamel
        relationAliases.set(leftNorm, leftAliases)

        const rightAliases = relationAliases.get(rightNorm) ?? {}
        rightAliases[isMany ? pluralizeAlias(leftCamel) : leftCamel] = pivotCamel
        relationAliases.set(rightNorm, rightAliases)
      }
      logger.info(
        `Relation aliases: ${[...relationAliases.entries()].map(([e, a]) => `${e}: ${JSON.stringify(a)}`).join(', ')}`,
      )

      const rqAdapter = new DrizzleRelationalQuery((db as DrizzlePgAdapter).getClient(), relationAliases)
      builder.registerInfra('IRelationalQueryPort', rqAdapter)
      logger.info(`IRelationalQueryPort → DrizzleRelationalQuery (${allDefs.length} relations, native SQL JOINs)`)
    }
  } catch (err) {
    logger.warn(`Failed to wire IRelationalQueryPort: ${err instanceof Error ? err.message : String(err)}`)
  }

  // [12e] Create and register QueryService for defineQueryGraph() support
  try {
    const { QueryService } = await import('@manta/core')
    const queryService = new QueryService()

    // Wire relational query for native SQL JOINs (dotted field paths)
    // rqAdapter was created in step [12] above — look it up from the builder's extraResolve map
    try {
      // biome-ignore lint/suspicious/noExplicitAny: accessing private builder state
      const rqPort = (builder as any)._extraResolve?.get('IRelationalQueryPort')
      if (rqPort) {
        queryService.registerRelationalQuery(rqPort as import('@manta/core').IRelationalQueryPort)
        logger.info('QueryService: relational query wired for dotted field paths')
      }
    } catch {
      /* IRelationalQueryPort not available */
    }

    // Register a resolver per module entity — uses the module's list method
    // Also extract searchable fields from DML schema
    for (const mod of resources.modules) {
      for (const entity of mod.entities) {
        // Derive canonical camelCase key from directory name: 'customer-group' → 'customerGroup'
        const { toCamel: toCamelName } = await import('@manta/core')
        const entityPascal = entity.name
          .split('-')
          .map((s: string) => s.charAt(0).toUpperCase() + s.slice(1))
          .join('')
        const entityCamel = toCamelName(entityPascal)
        const repoKey = entityToTableKey(entityPascal)

        queryService.registerResolver(entityCamel, async (config) => {
          try {
            const repo = repoFactory.createRepository(repoKey)
            // Map sort (lowercase) to order (uppercase) for Drizzle repo
            const order = config.sort
              ? Object.fromEntries(Object.entries(config.sort).map(([k, v]) => [k, (v as string).toUpperCase()]))
              : undefined
            return repo.find({
              where: config.filters,
              limit: config.pagination?.limit,
              offset: config.pagination?.offset,
              order: order as Record<string, 'ASC' | 'DESC'>,
            })
          } catch {
            return []
          }
        })

        // Extract searchable fields from DML schema
        try {
          const mod = await doImport(entity.modelPath)
          const dmlEntity = Object.values(mod).find((v: any) => v?.name && v?.schema) as any
          if (dmlEntity?.schema) {
            const searchableFields: string[] = []
            for (const [key, prop] of Object.entries(dmlEntity.schema)) {
              const meta = typeof (prop as any).parse === 'function' ? (prop as any).parse(key) : null
              if (meta?.searchable) searchableFields.push(key)
            }
            if (searchableFields.length > 0) {
              queryService.registerSearchableFields(entityCamel, searchableFields)
            }
          }
        } catch {
          /* schema extraction failed, searchable not available for this entity */
        }
      }
    }

    // Register resolvers for link/pivot tables (e.g., customer_customer_group)
    // These are needed for named queries that query the pivot table directly
    for (const link of [...resources.links, ...resources.modules.flatMap((m) => m.intraLinks)]) {
      try {
        const mod = await doImport(link.path)
        const linkDef = mod.default ?? mod
        if (linkDef?.tableName) {
          const pivotName = linkDef.tableName.replace(/-/g, '_')
          queryService.registerResolver(pivotName, async (config) => {
            try {
              const repo = repoFactory.createRepository(pivotName)
              return repo.find({
                where: config.filters,
                limit: config.pagination?.limit,
                offset: config.pagination?.offset,
              })
            } catch {
              return []
            }
          })
        }
      } catch {
        /* link not importable */
      }
    }

    // Also register resolvers for user models (defineUserModel entities)
    // User models use repos from repoFactory — we create repos lazily and query them directly
    for (const userDef of userDefinitions) {
      const entityLower = userDef.contextName.toLowerCase()
      const tableName = `${entityLower}s` // convention: customer → customers
      queryService.registerResolver(entityLower, async (config) => {
        try {
          // Use the repo factory directly — guaranteed to support limit/offset
          const repo = repoFactory.createRepository(tableName)
          const order = config.sort
            ? Object.fromEntries(Object.entries(config.sort).map(([k, v]) => [k, (v as string).toUpperCase()]))
            : undefined
          return repo.find({
            where: config.filters,
            limit: config.pagination?.limit,
            offset: config.pagination?.offset,
            order: order as Record<string, 'ASC' | 'DESC'>,
          })
        } catch {
          return []
        }
      })

      // Extract searchable fields from user model DML schema
      try {
        const dmlModel = userDef.def.model
        if (dmlModel?.schema) {
          const searchableFields: string[] = []
          for (const [key, prop] of Object.entries(dmlModel.schema)) {
            const meta = typeof (prop as any).parse === 'function' ? (prop as any).parse(key) : null
            if (meta?.searchable) searchableFields.push(key)
          }
          if (searchableFields.length > 0) {
            queryService.registerSearchableFields(entityLower, searchableFields)
            logger.info(`  Searchable fields for ${entityLower}: ${searchableFields.join(', ')}`)
          }
        }
      } catch {
        /* schema extraction failed */
      }
    }

    // Wire the query graph extensions discovered from modules/{name}/queries/*.ts
    for (const ext of queryExtensions) {
      queryService.registerExtension(ext)
    }

    builder.registerInfra('queryService', queryService)
    const totalResolvers = resources.modules.reduce((n, m) => n + m.entities.length, 0) + userDefinitions.length
    logger.info(
      `QueryService registered (${totalResolvers} entity resolvers${queryExtensions.length > 0 ? `, ${queryExtensions.length} extension(s)` : ''})`,
    )
  } catch (err) {
    logger.warn(`Failed to create QueryService: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Build the final immutable app
  app = builder.build()

  // Wire the extension context on the QueryService (so extension resolvers can access `app`).
  try {
    const qs = app.resolve<import('@manta/core').QueryService>('queryService')
    qs.setExtensionContext(app, logger)
  } catch {
    /* no queryService or no extensions */
  }

  // [12b] Wire AuthModuleService + auth verifier
  const { AuthModuleService, EmailpassAuthProvider, AuthIdentity, ProviderIdentity } = await import('@manta/core/auth')

  // Auth repos: generate Drizzle tables from DML models when DB available, else InMemory
  // biome-ignore lint/suspicious/noExplicitAny: repos assigned from different adapter paths
  let authIdentityRepo: any
  // biome-ignore lint/suspicious/noExplicitAny: repos assigned from different adapter paths
  let providerIdentityRepo: any
  let authIdentityTableName = 'auth_identity'
  let providerIdentityTableName = 'provider_identity'
  if (db) {
    // Generate pg tables from auth DML models and register them on the factory
    const aiTable = generatePgTableFromDml(AuthIdentity)
    const piTable = generatePgTableFromDml(ProviderIdentity)
    authIdentityTableName = aiTable.tableName
    providerIdentityTableName = piTable.tableName
    generatedTables.set(aiTable.tableName, aiTable.table)
    generatedTables.set(piTable.tableName, piTable.table)
    repoFactory.registerTable!(aiTable.tableName, aiTable.table)
    repoFactory.registerTable!(piTable.tableName, piTable.table)
    // Ensure auth tables exist in the database
    await ensureEntityTables(
      db.getPool(),
      [
        { name: AuthIdentity.name, schema: (AuthIdentity as any).schema },
        { name: ProviderIdentity.name, schema: (ProviderIdentity as any).schema },
      ],
      [],
      logger,
    )
    logger.info('[auth] Auth tables generated (Drizzle — persisted)')
  }
  authIdentityRepo = repoFactory.createRepository(authIdentityTableName)
  providerIdentityRepo = repoFactory.createRepository(providerIdentityTableName)

  const authService = new AuthModuleService({
    baseRepository: authIdentityRepo,
    authIdentityRepository: authIdentityRepo,
    providerIdentityRepository: providerIdentityRepo,
    cache: infraMap.get('ICachePort') as ICachePort,
  })
  authService.registerProvider('emailpass', new EmailpassAuthProvider())

  // JWT secret: required in prod, fallback in dev
  if (mode === 'prod' && !process.env.JWT_SECRET) {
    throw new MantaError(
      'INVALID_STATE',
      '[auth] JWT_SECRET environment variable is required in production. Set it before deploying.',
    )
  }
  const jwtSecret = process.env.JWT_SECRET ?? 'manta-dev-secret'

  // [13] Create H3 adapter and register CQRS endpoints
  const adapter = new H3Adapter({ port: 0, isDev: mode === 'dev' })

  // Wire auth verifier — enables step 6 of H3 pipeline
  adapter.setAuthVerifier(async (token: string) => {
    try {
      const payload = await authService.verifyToken(token, jwtSecret)
      const meta =
        (payload.metadata as Record<string, unknown>) ?? (payload.app_metadata as Record<string, unknown>) ?? {}
      return {
        id: (payload.id ?? payload.actor_id) as string,
        type: (payload.type ?? payload.actor_type) as string,
        auth_identity_id: payload.auth_identity_id as string,
        email: (meta.email as string) ?? undefined,
        metadata: meta,
      }
    } catch (err) {
      logger.warn(`[auth] Token verification failed: ${(err as Error).message}`)
      return null
    }
  })

  // [13b-v2] SPA warnings — warn if SPA exists without defineUserModel
  if (resources.spas.length > 0) {
    const userContexts = new Set(userDefinitions.map((u) => u.contextName))
    for (const spa of resources.spas) {
      if (!userContexts.has(spa.name) && spa.name !== 'public') {
        logger.warn(`SPA "${spa.name}" has no defineUserModel('${spa.name}') — no one can login to /${spa.name}`)
      } else {
        logger.info(`  SPA: /${spa.name} (from src/spa/${spa.name}/)`)
      }
    }
  }

  // Load context middleware overrides (src/middleware/{ctx}.ts)
  const contextMiddlewareMap = new Map<string, (req: unknown, authCtx: unknown) => Promise<unknown>>()
  for (const mw of resources.contextMiddlewares) {
    try {
      const imported = await doImport(mw.path)
      const def = imported.default
      if (def?.__type === 'middleware' && typeof def.handler === 'function') {
        contextMiddlewareMap.set(mw.context, def.handler)
        logger.info(`  Middleware override: ${mw.context} (${mw.path})`)
      }
    } catch (err) {
      logger.warn(`Failed to load middleware '${mw.context}': ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (userDefinitions.length > 0) {
    const { generateAllUserRoutes, getPublicPaths } = await import('@manta/core')

    for (const { contextName, def } of userDefinitions) {
      try {
        const userDmlEntity = def.model
        const inviteDmlEntity = def.inviteModel

        // Determine repos (DB or in-memory)
        // biome-ignore lint/suspicious/noExplicitAny: repo type varies between DrizzleRepository and InMemoryRepository
        let userRepo: any
        // biome-ignore lint/suspicious/noExplicitAny: repo type varies
        let inviteRepo: any

        let userRepoKey = userDmlEntity?.name?.toLowerCase() ?? contextName
        let inviteRepoKey = inviteDmlEntity?.name?.toLowerCase() ?? `${contextName}_invite`
        if (db && userDmlEntity && inviteDmlEntity) {
          const userTable = generatePgTableFromDml(
            userDmlEntity as unknown as Parameters<typeof generatePgTableFromDml>[0],
          )
          const inviteTable = generatePgTableFromDml(
            inviteDmlEntity as unknown as Parameters<typeof generatePgTableFromDml>[0],
          )
          userRepoKey = userTable.tableName
          inviteRepoKey = inviteTable.tableName
          generatedTables.set(userTable.tableName, userTable.table)
          generatedTables.set(inviteTable.tableName, inviteTable.table)
          repoFactory.registerTable!(userTable.tableName, userTable.table)
          repoFactory.registerTable!(inviteTable.tableName, inviteTable.table)
          // Ensure user + invite tables exist in DB
          await ensureEntityTables(
            db.getPool(),
            [
              { name: userDmlEntity.name, schema: (userDmlEntity as any).schema },
              { name: inviteDmlEntity.name, schema: (inviteDmlEntity as any).schema },
            ],
            [],
            logger,
          )
        }
        userRepo = repoFactory.createRepository(userRepoKey)
        inviteRepo = repoFactory.createRepository(inviteRepoKey)

        // Generate all routes for this user context
        const routes = generateAllUserRoutes({
          userDef: def,
          authService: authService as unknown as Parameters<typeof generateAllUserRoutes>[0]['authService'],
          userRepo,
          inviteRepo,
          cache: infraMap.get('ICachePort') as ICachePort,
          logger,
          jwtSecret,
        })

        // Check for user-defined overrides in commands/{ctx}/
        const overriddenNames = new Set(resources.commands.filter((c) => c.context === contextName).map((c) => c.id))

        for (const route of routes) {
          const routeName = route.path.split('/').pop() ?? ''
          if (overriddenNames.has(routeName)) {
            logger.info(`    Route ${route.path} overridden by commands/${contextName}/${routeName}.ts`)
            continue
          }
          adapter.registerRoute(route.method, route.path, route.handler)
        }

        // Register per-context auth rules on the adapter (with optional custom middleware)
        const publicPaths = getPublicPaths(contextName)
        // biome-ignore lint/suspicious/noExplicitAny: middleware handler types vary
        const customMw = contextMiddlewareMap.get(contextName) as any
        adapter.registerContextAuth(contextName, def.actorType, publicPaths, customMw ?? undefined)

        logger.info(`  User routes: ${contextName} (login, me, CRUD, invite) on /api/${contextName}/`)

        // Seed dev user
        if (mode === 'dev') {
          try {
            const seedEmail = `${contextName}@manta.local`
            const seedResult = await authService.register('emailpass', {
              url: '',
              headers: {},
              query: {},
              protocol: 'http',
              body: { email: seedEmail, password: process.env['MANTA_ADMIN_PASSWORD'] ?? 'admin' },
            })
            if (seedResult?.authIdentity) {
              await authService.updateAuthIdentity(seedResult.authIdentity.id, {
                app_metadata: { user_type: contextName },
              })
              // Also create the user record in the user table
              await userRepo.create({ email: seedEmail, first_name: 'Dev', last_name: 'Admin' })
              logger.info(`[auth:${contextName}] Dev user seeded — login with: ${seedEmail}`)
            }
          } catch (seedErr) {
            // Already exists or other error — log it for debugging
            logger.warn(
              `[auth:${contextName}] Dev seed: ${seedErr instanceof Error ? seedErr.message : String(seedErr)}`,
            )
          }
        }
      } catch (err) {
        logger.warn(
          `Failed to wire user routes for '${contextName}': ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }

  // [13b] Legacy auth routes removed — V2 per-context routes are in step [13b-v2]
  // Auth routes are now auto-generated per defineUserModel context (e.g., /api/admin/login)

  // [13d] Load contexts (src/contexts/*.ts)
  const { ContextRegistry } = await import('@manta/core')
  const contextRegistry = new ContextRegistry()
  // Include module names + entity names (as registered in the builder) for query access
  const moduleNames = [
    ...resources.modules.map((m) => m.name),
    ...Array.from(entityRegistry.keys()).map((k) => k.toLowerCase()),
  ]
  const commandNames = cmdRegistry ? cmdRegistry.list().map((e) => e.name) : []

  // Helper: resolve entity commands visible for a context based on its command graph
  const resolveEntityCommandsForContext = (ctxName: string): string[] => {
    const graphDef = commandGraphDefs.get(ctxName)
    if (!graphDef) return [] // No command graph → no entity commands exposed

    const visibleEntityCmds: string[] = []
    for (const [cmdName, entityCmd] of entityCommandRegistry.entries()) {
      // Skip if overridden by explicit command
      if (explicitCommandNames.has(cmdName)) continue
      // Check if this entity command is allowed by the graph
      if (isEntityCmdAllowed(graphDef, entityCmd.__module, entityCmd.__operation)) {
        visibleEntityCmds.push(cmdName)
      }
    }
    return visibleEntityCmds
  }

  if (resources.contexts.length > 0) {
    // V1 path: explicit defineContext files
    for (const ctxInfo of resources.contexts) {
      try {
        const imported = await doImport(ctxInfo.path)
        const def = imported.default
        if (def?.name && def?.basePath && def?.actors) {
          // Add entity commands from command graph
          const entityCmds = resolveEntityCommandsForContext(def.name)
          if (entityCmds.length > 0) {
            def.commands = [...(def.commands ?? []), ...entityCmds]
          }
          contextRegistry.register(def, moduleNames, [...commandNames, ...entityCmds])
          logger.info(
            `  Context: ${def.name} (${def.basePath}) [V1 explicit]${entityCmds.length > 0 ? ` +${entityCmds.length} entity commands` : ''}`,
          )
        }
      } catch (err) {
        logger.warn(`Failed to load context '${ctxInfo.id}': ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  } else if (resources.users.length > 0 || resources.queries.length > 0 || resources.commands.some((c) => c.context)) {
    // V2 path: derive contexts from filesystem structure
    const derivedContexts = new Set<string>()

    // From commands/{ctx}/
    for (const cmd of resources.commands) {
      if (cmd.context) derivedContexts.add(cmd.context)
    }
    // From queries/{ctx}/
    for (const q of resources.queries) {
      derivedContexts.add(q.context)
    }
    // From defineUserModel(ctx)
    for (const u of userDefinitions) {
      derivedContexts.add(u.contextName)
    }

    // Collect command IDs that are actually command-graph definitions (not real commands)
    const commandGraphIds = new Set<string>()
    for (const cmd of resources.commands) {
      if (cmd.context && commandGraphDefs.has(cmd.context) && cmd.id === 'graph') {
        commandGraphIds.add(`${cmd.context}:${cmd.id}`)
      }
    }

    // Helper: kebab file name → camelCase command name
    const kebabToCamel = (s: string) => s.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase())

    for (const ctxName of derivedContexts) {
      // Collect commands visible in this context (exclude command-graph files)
      // Convert file-based kebab names to camelCase to match registered command names
      const ctxCommands = resources.commands
        .filter((c) => c.context === ctxName && !commandGraphIds.has(`${c.context}:${c.id}`))
        .map((c) => kebabToCamel(c.id))
      // Add all command names if they have no context (flat V1 commands are visible everywhere)
      const flatCommands = resources.commands.filter((c) => !c.context).map((c) => kebabToCamel(c.id))
      // Add entity commands exposed via command graph
      const entityCmds = resolveEntityCommandsForContext(ctxName)
      // Module-scoped commands (e.g. `posthog:track-event` from modules/posthog/commands/)
      // are exposed to every context by the V2 filesystem-derived pipeline, same policy
      // as modules themselves. Registered with their raw name (including the ':' prefix)
      // so the HTTP handler can match `POST /api/{ctx}/command/posthog:track-event`.
      const allCtxCommands = [...ctxCommands, ...flatCommands, ...entityCmds, ...moduleScopedCommandNames]

      // Determine actors from user definitions
      const hasUser = userDefinitions.some((u) => u.contextName === ctxName)
      const actors = hasUser ? [ctxName] : []

      contextRegistry.register(
        {
          name: ctxName,
          basePath: `/api/${ctxName}`,
          actors,
          modules: Object.fromEntries(moduleNames.map((m) => [m, { expose: '*' }])),
          commands: allCtxCommands,
        },
        moduleNames,
        [...commandNames, ...entityCmds],
      )
      logger.info(
        `  Context: ${ctxName} (/api/${ctxName}) [V2 filesystem-derived]${entityCmds.length > 0 ? ` +${entityCmds.length} entity commands` : ''}`,
      )
    }
  } else {
    contextRegistry.registerDefault(moduleNames, commandNames)
    logger.info('  Context: admin (implicit, /api/admin)')
  }

  // [13e] Register context-aware CQRS endpoints
  for (const ctx of contextRegistry.list()) {
    // POST {basePath}/command/:name — filtered by context
    adapter.registerRoute('POST', `${ctx.basePath}/command/:name`, async (req: Request) => {
      try {
        const url = new URL(req.url, 'http://localhost')
        const segments = url.pathname.split('/')
        const nameIdx = segments.indexOf('command') + 1
        const name = segments[nameIdx]

        // Check command is visible in this context
        // Entity commands use dot notation (e.g. "catalog.create-product")
        const camelName = name.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase())
        if (!ctx.commands.has(name) && !ctx.commands.has(camelName)) {
          return Response.json(
            { type: 'NOT_FOUND', message: `Command "${name}" not found in context "${ctx.name}"` },
            { status: 404 },
          )
        }

        // Resolve callable — try exact name first (entity commands), then camelCase (legacy)
        const cmds = app.commands as Record<string, ((...args: unknown[]) => Promise<unknown>) | undefined>
        const callable = cmds[name] ?? cmds[camelName]
        if (!callable) {
          return Response.json({ type: 'NOT_FOUND', message: `Command "${name}" not found` }, { status: 404 })
        }
        const body = await getRequestBody(req)

        // Extract auth context from request for the command
        const authHeader = req.headers.get('authorization')
        const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
        let cmdAuth: unknown = null
        if (bearerToken) {
          try {
            cmdAuth = await authService.verifyToken(bearerToken, jwtSecret)
          } catch {
            /* no auth */
          }
        }
        const reqHeaders: Record<string, string | undefined> = {}
        req.headers.forEach((v, k) => {
          reqHeaders[k] = v
        })

        const result = await callable(body, { auth: cmdAuth, headers: reqHeaders })
        return Response.json({ data: result })
      } catch (err) {
        if ((err as { name?: string }).name === 'ZodError') {
          return Response.json(
            { type: 'INVALID_DATA', message: 'Validation failed', details: (err as { issues?: unknown }).issues },
            { status: 400 },
          )
        }
        const message = (err as Error).message
        logger.error(`[command] ${message}`)
        return Response.json({ type: 'UNEXPECTED_STATE', message }, { status: 500 })
      }
    })

    // POST {basePath}/query/:entity — filtered by context
    adapter.registerRoute('POST', `${ctx.basePath}/query/:entity`, async (req: Request) => {
      try {
        const url = new URL(req.url, 'http://localhost')
        const segments = url.pathname.split('/')
        const entityIdx = segments.indexOf('query') + 1
        const entity = segments[entityIdx]

        if (!entity) {
          return Response.json({ type: 'INVALID_DATA', message: 'entity is required in URL' }, { status: 400 })
        }

        // Check module is exposed in this context (normalize: camelCase → lowercase for lookup)
        const entityNormalized = entity.toLowerCase()
        if (!ctx.modules.has(entity) && !ctx.modules.has(entityNormalized)) {
          return Response.json(
            { type: 'NOT_FOUND', message: `Entity "${entity}" not available in context "${ctx.name}"` },
            { status: 404 },
          )
        }

        let service: Record<string, unknown> | null = null
        const modules = app.modules as Record<string, Record<string, unknown> | undefined>
        try {
          service = app.resolve<Record<string, unknown>>(`${entity}ModuleService`)
        } catch {
          // Try camelCase, then lowercase
          service = modules[entity] ?? modules[entityNormalized] ?? null
        }
        if (!service) {
          return Response.json({ type: 'NOT_FOUND', message: `Entity "${entity}" not found` }, { status: 404 })
        }

        const body = await getRequestBody<Record<string, unknown>>(req)

        // Use queryService.graphAndCount when available (supports relations via alias)
        const qs = (() => {
          try {
            return app.resolve('queryService') as { graphAndCount: Function }
          } catch {
            return null
          }
        })()
        if (qs && typeof qs.graphAndCount === 'function') {
          const { fields, filters, limit, offset, order, q, id } = body as Record<string, unknown>

          if (id) {
            // Single entity by ID — use service
            return handleQueryRequest(service, entity, body, {
              contextName: ctx.name,
              exposedModules: new Set(ctx.modules.keys()),
              logger,
            })
          }

          const sortObj =
            order && typeof order === 'string'
              ? { [order.startsWith('-') ? order.slice(1) : order]: order.startsWith('-') ? 'desc' : 'asc' }
              : undefined
          const [data, count] = await qs.graphAndCount({
            entity,
            fields: fields as string[] | undefined,
            filters: filters as Record<string, unknown> | undefined,
            sort: sortObj,
            pagination: { limit: (limit as number) ?? 15, offset: (offset as number) ?? 0 },
            q: q as string | undefined,
          })
          return Response.json({ data, count })
        }

        return handleQueryRequest(service, entity, body, {
          contextName: ctx.name,
          exposedModules: new Set(ctx.modules.keys()),
          logger,
        })
      } catch (err) {
        return Response.json({ type: 'UNEXPECTED_STATE', message: (err as Error).message }, { status: 500 })
      }
    })

    // GET {basePath}/tools — AI tool discovery (filtered by context)
    if (ctx.ai.enabled) {
      adapter.registerRoute('GET', `${ctx.basePath}/tools`, async () => {
        try {
          const registry = app.resolve<CommandRegistry>('commandRegistry')
          const aiCommands = ctx.ai.commands
          const filtered = registry.toToolSchemas().filter((t) => aiCommands.includes(t.name))
          return Response.json({ tools: filtered })
        } catch {
          return Response.json({ tools: [] })
        }
      })
    }

    logger.info(
      `[context] ${ctx.name}: ${ctx.basePath} (actors: ${ctx.actors.join(', ')}, modules: ${[...ctx.modules.keys()].join(', ')})`,
    )
  }

  // [14] AI + Dashboard registry
  let aiEnabled = false
  const aiProvider = process.env.MANTA_AI_PROVIDER || 'anthropic'
  const aiKeyEnv =
    aiProvider === 'openai'
      ? 'OPENAI_API_KEY'
      : aiProvider === 'google'
        ? 'GOOGLE_GENERATIVE_AI_API_KEY'
        : aiProvider === 'mistral'
          ? 'MISTRAL_API_KEY'
          : 'ANTHROPIC_API_KEY'

  if (process.env[aiKeyEnv]) {
    try {
      const { createAiChatHandler } = await import('../ai/chat-handler')
      // Pass ALL entity names (not just module names) + link graph to the AI
      const allEntityNames = Array.from(entityRegistry.keys()).map((k) => k.toLowerCase())
      // Also add module names for backward compat
      const discoveredModuleNames = [...new Set([...resources.modules.map((m) => m.name), ...allEntityNames])]
      // Build link graph for the AI system prompt
      const aiLinkGraph = loadedLinks
        .filter((l) => !(l as { isDirectFk?: boolean }).isDirectFk)
        .map((l) => ({
          left: (l as { leftEntity: string }).leftEntity.toLowerCase(),
          right: (l as { rightEntity: string }).rightEntity.toLowerCase(),
          pivot: (l as { tableName: string }).tableName,
          cardinality: (l as { cardinality: string }).cardinality,
        }))
      const aiHandler = createAiChatHandler(app, discoveredModuleNames, aiLinkGraph)
      adapter.registerRoute('POST', '/api/admin/ai/chat', aiHandler)
      aiEnabled = true
      logger.info('[ai] AI chat endpoint registered: POST /api/admin/ai/chat')
    } catch (err) {
      logger.warn(`[ai] AI chat not available: ${(err as Error).message}`)
    }
  } else {
    logger.info(`[ai] AI disabled (${aiKeyEnv} not set)`)
  }

  // ── PostHog HogQL relay endpoint ───────────────────────────────────────
  // POST /api/admin/posthog/hogql — executes a raw HogQL SELECT against the
  // PostHog Data Warehouse and returns normalized rows. Used by dashboard
  // blocks (DataTable / StatsCard / InfoCard with `query: { hogql: { ... } }`)
  // to render pure-analytics views without requiring a defineQuery() handler.
  //
  // Security: SELECT-only guard (same as the AI tool in chat-handler.ts),
  // requires admin context auth (enforced by the /api/admin/ prefix).
  // Requires POSTHOG_API_KEY env var with query:read scope.
  if (process.env.POSTHOG_API_KEY) {
    adapter.registerRoute('POST', '/api/admin/posthog/hogql', async (req: Request) => {
      try {
        const body = await getRequestBody<{ query?: string }>(req)
        const raw = typeof body.query === 'string' ? body.query.trim() : ''
        if (!raw) {
          return Response.json({ type: 'INVALID_DATA', message: 'query is required' }, { status: 400 })
        }
        if (!/^(with|select)\b/i.test(raw)) {
          return Response.json(
            {
              type: 'INVALID_DATA',
              message: 'Only SELECT or WITH…SELECT queries are allowed. This endpoint is read-only.',
            },
            { status: 400 },
          )
        }
        const host = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
        const key = process.env.POSTHOG_API_KEY
        const res = await fetch(`${host}/api/projects/@current/query/`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: { kind: 'HogQLQuery', query: raw } }),
        })
        if (!res.ok) {
          const text = await res.text()
          return Response.json(
            { type: 'UNEXPECTED_STATE', message: `PostHog HogQL ${res.status}`, detail: text },
            { status: 502 },
          )
        }
        const data = (await res.json()) as {
          results?: unknown[][]
          columns?: string[]
          types?: string[]
        }
        if (!data.results || !data.columns) {
          return Response.json({ data: { columns: [], rows: [], rowCount: 0 } })
        }
        // Cap result rows at 500 for dashboard block rendering (blocks paginate/slice client-side)
        const rows = data.results.slice(0, 500).map((row) => {
          const obj: Record<string, unknown> = {}
          data.columns?.forEach((col, idx) => {
            obj[col] = row[idx]
          })
          return obj
        })
        return Response.json({
          data: {
            columns: data.columns,
            rows,
            rowCount: data.results.length,
            truncated: data.results.length > 500,
          },
        })
      } catch (err) {
        return Response.json({ type: 'UNEXPECTED_STATE', message: (err as Error).message }, { status: 500 })
      }
    })
    logger.info('[posthog] HogQL relay endpoint registered: POST /api/admin/posthog/hogql')
  }

  // GET /api/admin/registry — dashboard config
  let adminRegistry: Record<string, unknown> = { pages: {}, components: {}, navigation: [] }
  try {
    const { existsSync } = await import('node:fs')
    const { resolve: resolvePath } = await import('node:path')
    const registryPath = resolvePath(cwd, 'src', 'admin', 'registry.ts')
    if (existsSync(registryPath)) {
      const mod = await doImport(registryPath)
      adminRegistry = mod.default ?? mod
      logger.info('[dashboard] Registry loaded from src/admin/registry.ts')
    }
  } catch (err) {
    logger.warn(`[dashboard] Failed to load registry: ${(err as Error).message}`)
  }

  // Auto-generate navigation from discovered modules if registry has none
  const navItems = adminRegistry.navigation as Array<Record<string, unknown>>
  if (navItems.length === 0 && resources.modules.length > 0) {
    for (const mod of resources.modules) {
      const label = mod.name.charAt(0).toUpperCase() + mod.name.slice(1)
      const subItems = mod.entities.map((e) => ({
        label: e.name.replace(/([A-Z])/g, ' $1').trim(),
        to: `/${mod.name}/${e.name
          .toLowerCase()
          .replace(/([a-z])([A-Z])/g, '$1-$2')
          .toLowerCase()}`,
      }))
      navItems.push({
        icon: 'Users',
        label,
        to: `/${mod.name}`,
        items: subItems.length > 1 ? subItems : [],
      })
    }
    logger.info(`[dashboard] Auto-generated navigation (${navItems.length} entries from modules)`)
  }

  adapter.registerRoute('GET', '/api/admin/registry', async () => {
    return Response.json({
      ...adminRegistry,
      endpoints: {
        query: '/api/admin/query',
        command: '/api/admin/command',
        tools: '/api/admin/tools',
      },
      ai: { enabled: aiEnabled },
    })
  })

  // [13f] V2: Register query endpoints — GET {basePath}/{query-name}
  if (resources.queries.length > 0) {
    for (const queryInfo of resources.queries) {
      const queryDef = queryRegistry.get(queryInfo.id)
      if (!queryDef) continue

      const ctx = contextRegistry.list().find((c) => c.name === queryInfo.context)
      if (!ctx) {
        logger.warn(`Query '${queryInfo.id}' has context '${queryInfo.context}' but no matching context found`)
        continue
      }

      adapter.registerRoute('GET', `${ctx.basePath}/${queryInfo.id}`, async (req: Request) => {
        try {
          const url = new URL(req.url, 'http://localhost')
          const rawParams: Record<string, unknown> = {}
          for (const [key, value] of url.searchParams.entries()) {
            // Auto-parse numbers and booleans from query string
            if (value === 'true') rawParams[key] = true
            else if (value === 'false') rawParams[key] = false
            else if (/^\d+$/.test(value)) rawParams[key] = Number(value)
            else rawParams[key] = value
          }

          // Extract auth context
          const authHeader = req.headers.get('authorization')
          const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
          let authCtx: import('@manta/core').AuthContext | null = null
          if (bearerToken) {
            try {
              authCtx = (await authService.verifyToken(
                bearerToken,
                jwtSecret,
              )) as unknown as import('@manta/core').AuthContext
            } catch {
              /* no auth */
            }
          }

          // Extract headers
          const reqHeaders: Record<string, string | undefined> = {}
          req.headers.forEach((v, k) => {
            reqHeaders[k] = v
          })

          const input = queryDef.input.parse(rawParams)
          const result = await queryDef.handler(input, {
            query: app.resolve('queryService'),
            log: logger,
            auth: authCtx,
            headers: reqHeaders,
          })
          return Response.json({ data: result })
        } catch (err) {
          if ((err as { name?: string }).name === 'ZodError') {
            return Response.json(
              { type: 'INVALID_DATA', message: 'Validation failed', details: (err as { issues?: unknown }).issues },
              { status: 400 },
            )
          }
          const message = (err as Error).message
          logger.error(`[query] ${queryInfo.id}: ${message}`)
          return Response.json({ type: 'UNEXPECTED_STATE', message }, { status: 500 })
        }
      })

      logger.info(`  Query endpoint: GET ${ctx.basePath}/${queryInfo.id}`)
    }
  }

  // [13g] Register query graph endpoints — POST {basePath}/graph
  if (queryGraphDefs.size > 0) {
    const { getEntityFilter } = await import('@manta/core')

    for (const [ctxName, graphDef] of queryGraphDefs) {
      const ctx = contextRegistry.list().find((c) => c.name === ctxName)
      if (!ctx) {
        logger.warn(`QueryGraph for context '${ctxName}' has no matching context`)
        continue
      }

      adapter.registerRoute('POST', `${ctx.basePath}/graph`, async (req: Request) => {
        try {
          const body = await getRequestBody<{
            entity?: string
            filters?: Record<string, unknown>
            pagination?: { limit?: number; offset?: number }
            sort?: { field?: string; order?: 'asc' | 'desc' }
            relations?: string[]
            fields?: string[]
          }>(req)

          if (!body.entity) {
            return Response.json({ type: 'INVALID_DATA', message: 'entity is required' }, { status: 400 })
          }

          // Extract auth context from request
          const authHeader = req.headers.get('authorization')
          const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
          let authCtx: import('@manta/core').AuthContext | null = null
          if (token) {
            try {
              authCtx = (await authService.verifyToken(
                token,
                jwtSecret,
              )) as unknown as import('@manta/core').AuthContext
            } catch {
              /* no auth */
            }
          }

          // Check entity access + get row-level filter
          const typedDef = graphDef as unknown as import('@manta/core').QueryGraphDefinition
          const entityFilter = getEntityFilter(typedDef, body.entity, authCtx)
          if (entityFilter === null) {
            return Response.json(
              { type: 'FORBIDDEN', message: `Entity "${body.entity}" is not accessible in this context` },
              { status: 403 },
            )
          }

          // Merge user filters with row-level scope filter
          const mergedFilters = { ...(body.filters ?? {}), ...(entityFilter ?? {}) }

          // Check relation access + apply scope filters
          const allowedRelations = (body.relations ?? []).filter((rel) => {
            const relFilter = getEntityFilter(typedDef, rel, authCtx)
            if (relFilter === null) {
              logger.warn(`[query-graph:${ctxName}] Relation "${rel}" not allowed — stripped from query`)
              return false
            }
            return true
          })

          const queryService = app.resolve('queryService') as import('@manta/core').QueryService
          const result = await queryService.graph({
            entity: body.entity,
            filters: Object.keys(mergedFilters).length > 0 ? mergedFilters : undefined,
            pagination: body.pagination ? { limit: body.pagination.limit, offset: body.pagination.offset } : undefined,
            sort: body.sort ? { [body.sort.field!]: body.sort.order ?? 'asc' } : undefined,
            fields: body.fields,
            relations: allowedRelations.length > 0 ? allowedRelations : undefined,
            q: body.q,
          })

          return Response.json({ data: result })
        } catch (err) {
          const message = (err as Error).message
          logger.error(`[query-graph:${ctxName}] ${message}`)
          return Response.json({ type: 'UNEXPECTED_STATE', message }, { status: 500 })
        }
      })

      logger.info(
        `  QueryGraph: POST ${ctx.basePath}/graph (${(graphDef as unknown as import('@manta/core').QueryGraphDefinition).access === '*' ? 'wildcard' : Object.keys((graphDef as unknown as import('@manta/core').QueryGraphDefinition).access).length + ' entities'})`,
      )
    }
  }

  logger.info('[cqrs] Context-aware endpoints registered')

  // [14b] Register custom API routes (plugins + local src/api/)
  {
    const { mergePluginApiRoutes } = await import('../plugins/merge-resources')
    const apiRoutes = await mergePluginApiRoutes(resolvedPlugins, cwd)
    for (const route of apiRoutes) {
      const mod = await doImport(route.file)
      const handler = mod[route.exportName] as (req: Request) => Promise<Response> | Response
      if (typeof handler !== 'function') continue

      adapter.registerRoute(route.method, route.path, async (req: Request) => {
        // Enrich request with app + scope (same pattern as CQRS routes)
        const mantaReq = req as Request & { app?: unknown; scope?: unknown; params?: Record<string, string> }
        if (!mantaReq.app) Object.defineProperty(mantaReq, 'app', { value: app, enumerable: true, configurable: true })
        if (!mantaReq.scope)
          Object.defineProperty(mantaReq, 'scope', {
            value: { resolve: <T>(k: string) => app.resolve<T>(k) },
            enumerable: true,
            configurable: true,
          })
        return handler(mantaReq)
      })
      logger.info(`  Route: ${route.method} ${route.path}`)
    }
    if (apiRoutes.length > 0) {
      logger.info(`[api] ${apiRoutes.length} custom route(s) registered`)
    }
  }

  // [14c] Register intra-module API routes (modules/{name}/api/**\/route.ts — escape hatch for non-CQRS)
  {
    const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'])
    let moduleRouteCount = 0
    for (const modInfo of resources.modules) {
      for (const routeInfo of modInfo.apiRoutes) {
        try {
          const mod = await doImport(routeInfo.file)
          // Derive URL path: /api/{moduleName}/{relativePath} with [param] → :param, [...x] → **
          const segments = routeInfo.relativePath
            ? routeInfo.relativePath
                .split('/')
                .map((seg) => {
                  if (seg.startsWith('[...') && seg.endsWith(']')) return '**'
                  if (seg.startsWith('[') && seg.endsWith(']')) return `:${seg.slice(1, -1)}`
                  return seg
                })
                .join('/')
            : ''
          const urlPath = segments ? `/api/${modInfo.name}/${segments}` : `/api/${modInfo.name}`

          for (const exportName of Object.keys(mod)) {
            if (!HTTP_METHODS.has(exportName)) continue
            const handler = mod[exportName] as (req: Request) => Promise<Response> | Response
            if (typeof handler !== 'function') continue

            adapter.registerRoute(exportName, urlPath, async (req: Request) => {
              const mantaReq = req as Request & { app?: unknown; scope?: unknown }
              if (!mantaReq.app)
                Object.defineProperty(mantaReq, 'app', { value: app, enumerable: true, configurable: true })
              if (!mantaReq.scope)
                Object.defineProperty(mantaReq, 'scope', {
                  value: { resolve: <T>(k: string) => app.resolve<T>(k) },
                  enumerable: true,
                  configurable: true,
                })
              return handler(mantaReq)
            })
            logger.info(`  Route: ${exportName} ${urlPath} (module: ${modInfo.name})`)
            moduleRouteCount++
          }
        } catch (err) {
          logger.warn(
            `Failed to load module route '${modInfo.name}/${routeInfo.relativePath}': ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
    }
    if (moduleRouteCount > 0) {
      logger.info(`[api] ${moduleRouteCount} module route(s) registered`)
    }
  }

  // [15] OpenAPI spec + Swagger UI
  try {
    const { generateOpenApiSpec, parseDmlEntityFields } = await import('../openapi/generate-spec')
    const { getSwaggerHtml } = await import('../openapi/swagger-html')

    // Collect discovered DML entities with parsed field metadata
    const openApiEntities: Array<{
      name: string
      moduleName?: string
      fields: Array<{ name: string; type: string; nullable?: boolean; values?: unknown }>
    }> = []
    for (const modInfo of resources.modules) {
      try {
        const mod = await doImport(modInfo.path)
        for (const value of Object.values(mod)) {
          if (isDmlEntity(value) && typeof value.getOptions === 'function') {
            openApiEntities.push({
              name: value.name,
              moduleName: modInfo.name,
              fields: parseDmlEntityFields(value.schema),
            })
          }
        }
      } catch {
        /* skip modules that fail to import */
      }
    }

    // Collect registered commands
    const openApiCommands = cmdRegistry
      ? cmdRegistry.list().map((entry) => ({
          name: entry.name,
          description: entry.description,
          inputSchema: entry.inputSchema,
        }))
      : []

    // Collect static routes from src/api/ (edge cases only)
    const staticRoutes: Array<{
      method: string
      path: string
      summary?: string
      tags?: string[]
      auth?: boolean
    }> = []

    // Resolve the primary context basePath for OpenAPI (use first context or /api)
    const primaryContext = contextRegistry.list()[0]
    const openApiBasePath = primaryContext?.basePath ?? '/api'

    // GET /api/openapi.json — serve the generated OpenAPI spec
    const configRecord = config as Record<string, unknown>
    adapter.registerRoute('GET', '/api/openapi.json', async () => {
      const spec = generateOpenApiSpec({
        title: (configRecord.name as string | undefined) ?? 'Manta API',
        version: (configRecord.version as string | undefined) ?? '1.0.0',
        description: configRecord.description as string | undefined,
        basePath: openApiBasePath,
        commands: openApiCommands,
        entities: openApiEntities,
        routes: staticRoutes.length > 0 ? staticRoutes : undefined,
      })
      return Response.json(spec)
    })

    // GET /api/docs — serve Swagger UI
    adapter.registerRoute('GET', '/api/docs', async () => {
      const html = getSwaggerHtml('/api/openapi.json')
      return new Response(html, { headers: { 'Content-Type': 'text/html' } })
    })

    logger.info('[openapi] Swagger UI: GET /api/docs | OpenAPI spec: GET /api/openapi.json')
  } catch (err) {
    logger.warn(`[openapi] Failed to register OpenAPI routes: ${(err as Error).message}`)
  }

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

// ====================================================================
// Helpers (internal)
// ====================================================================

/**
 * Entity name → table export name convention.
 * Product → products, InventoryItem → inventoryItems
 */
function entityToTableKey(entityName: string): string {
  const name = entityName.charAt(0).toLowerCase() + entityName.slice(1)
  if (name.endsWith('s') || name.endsWith('x') || name.endsWith('ch') || name.endsWith('sh')) return `${name}es`
  if (name.endsWith('y') && !/[aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`
  return `${name}s`
}

function tryInstantiateService(
  ServiceClass: new (...args: unknown[]) => unknown,
  infraMap: Map<string, unknown>,
  repoFactory: IRepositoryFactory,
): unknown | null {
  try {
    // Detect createService() classes — they have $modelObjects set by the framework
    const modelObjects = hasModelObjects(ServiceClass) ? ServiceClass.$modelObjects : undefined
    if (modelObjects) {
      const firstEntry = Object.entries(modelObjects)[0]
      if (firstEntry) {
        const entityName = isDmlEntity(firstEntry[1]) ? firstEntry[1].name : firstEntry[0]
        try {
          const repo = repoFactory.createRepository(entityToTableKey(entityName))
          return new ServiceClass({ baseRepository: repo })
        } catch {
          // Table not registered — fall through to other instantiation strategies
        }
      }
    }

    if (ServiceClass.length === 0) return new ServiceClass()
    const name = ServiceClass.name || ''
    if (name === 'FileService' || name === 'FileModuleService') {
      const file = infraMap.get('IFilePort')
      if (file) return new ServiceClass(file)
    }
    const portKeys = ['IFilePort', 'IDatabasePort', 'ILoggerPort', 'IEventBusPort', 'ICachePort']
    for (const key of portKeys) {
      const port = infraMap.get(key)
      if (port) {
        try {
          return new ServiceClass(port)
        } catch {}
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Generate .manta/types.ts — module augmentation for typed step proxy.
 * Scans discovered modules, finds DML entities, writes the type file.
 */
async function generateMantaTypes(
  cwd: string,
  modules: Array<{ name: string; entities: Array<{ name: string; modelPath: string }> }>,
  doImport: (path: string) => Promise<Record<string, unknown>>,
  logger: ILoggerPort,
): Promise<void> {
  const { existsSync, mkdirSync, writeFileSync } = await import('node:fs')
  const { resolve, relative } = await import('node:path')

  const mantaDir = resolve(cwd, '.manta', 'types')
  if (!existsSync(mantaDir)) mkdirSync(mantaDir, { recursive: true })

  // Collect entity info: module name → { entityExportName, entityName, relativePath }
  const entries: Array<{ moduleName: string; entityExportName: string; entityName: string; modulePath: string }> = []

  for (const modInfo of modules) {
    for (const entity of modInfo.entities) {
      try {
        const mod = await doImport(entity.modelPath)
        for (const [exportName, value] of Object.entries(mod)) {
          if (isDmlEntity(value) && typeof value.getOptions === 'function') {
            entries.push({
              moduleName: modInfo.name,
              entityExportName: exportName,
              entityName: value.name,
              modulePath: entity.modelPath,
            })
          }
        }
      } catch {
        // Entity model may not export DML entities
      }
    }
  }

  if (entries.length === 0) return

  // Build the type file
  const lines: string[] = [
    '// Auto-generated by manta dev — DO NOT EDIT',
    '// This file provides typed step.product.create(), step.inventoryItem.create(), etc.',
    '// Regenerated on every boot when modules change.',
    '',
  ]

  // Import statements
  for (const entry of entries) {
    const relPath = relative(mantaDir, entry.modulePath).replace(/\.ts$/, '')
    lines.push(`import type { ${entry.entityExportName} } from '${relPath}'`)
  }

  lines.push('')
  lines.push("declare module '@manta/core' {")
  lines.push('  interface MantaEntities {')
  for (const entry of entries) {
    lines.push(`    ${entry.moduleName}: typeof ${entry.entityExportName}`)
  }
  lines.push('  }')
  lines.push('}')
  lines.push('')

  const typesPath = resolve(mantaDir, 'types.ts')
  writeFileSync(typesPath, lines.join('\n'))
  logger.info(`[codegen] .manta/types.ts generated (${entries.length} entities)`)
}

/**
 * Ensure framework-internal tables exist (workflow, events, jobs, stats).
 * Application tables (products, inventory, links) are auto-created via ensureEntityTables().
 */
async function ensureFrameworkTables(sql: unknown, logger: ILoggerPort): Promise<void> {
  const pg = sql as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>
  try {
    await pg`CREATE TABLE IF NOT EXISTS stats (key TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0)`
    await pg`CREATE TABLE IF NOT EXISTS workflow_checkpoints (id SERIAL PRIMARY KEY, transaction_id TEXT NOT NULL, step_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', data JSONB DEFAULT '{}', error TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(transaction_id, step_id))`
    await pg`CREATE INDEX IF NOT EXISTS idx_wf_checkpoints_tx ON workflow_checkpoints(transaction_id)`
    await pg`CREATE TABLE IF NOT EXISTS workflow_executions (transaction_id TEXT PRIMARY KEY, workflow_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running', input JSONB DEFAULT '{}', result JSONB, error TEXT, started_at TIMESTAMPTZ DEFAULT NOW(), completed_at TIMESTAMPTZ)`
    await pg`CREATE TABLE IF NOT EXISTS events (id SERIAL PRIMARY KEY, event_name TEXT NOT NULL, data JSONB DEFAULT '{}', metadata JSONB DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER DEFAULT 0, max_attempts INTEGER DEFAULT 3, last_error TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), processed_at TIMESTAMPTZ)`
    await pg`CREATE TABLE IF NOT EXISTS job_executions (id SERIAL PRIMARY KEY, job_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running', result JSONB, error TEXT, duration_ms INTEGER, started_at TIMESTAMPTZ DEFAULT NOW(), completed_at TIMESTAMPTZ)`
    await pg`CREATE TABLE IF NOT EXISTS cron_heartbeats (id SERIAL PRIMARY KEY, job_name TEXT NOT NULL, message TEXT, executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
    logger.info('Framework tables ready')
  } catch (err) {
    logger.error('Failed to create framework tables', err)
    throw err
  }
}

/** DML type → SQL type mapping */
const DML_TO_SQL: Record<string, string> = {
  id: 'TEXT PRIMARY KEY',
  text: 'TEXT',
  number: 'INTEGER',
  boolean: 'BOOLEAN',
  float: 'REAL',
  bigNumber: 'NUMERIC',
  serial: 'SERIAL',
  dateTime: 'TIMESTAMPTZ',
  json: 'JSONB',
  enum: 'TEXT',
  array: 'JSONB',
}

/**
 * Auto-create tables from discovered DML entities + links.
 * No hardcoded application tables — everything comes from defineModel() and defineLink().
 */
async function ensureEntityTables(
  sql: unknown,
  entities: Array<{ name: string; schema: Record<string, unknown> }>,
  links: Array<{ tableName: string; leftFk: string; rightFk: string }>,
  logger: ILoggerPort,
): Promise<void> {
  const pg = sql as PostgresSql

  for (const entity of entities) {
    const _tableName = entityToTableKey(entity.name)
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '')
    // Convert camelCase to snake_case for table name
    const snakeTable = entity.name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
    const finalTable =
      snakeTable.endsWith('s') || snakeTable.endsWith('x') || snakeTable.endsWith('ch') || snakeTable.endsWith('sh')
        ? `${snakeTable}es`
        : snakeTable.endsWith('y') && !/[aeiou]y$/i.test(snakeTable)
          ? `${snakeTable.slice(0, -1)}ies`
          : `${snakeTable}s`

    const columns: string[] = ['id TEXT PRIMARY KEY']

    for (const [fieldName, value] of Object.entries(entity.schema)) {
      const v = value as Record<string, unknown>
      if (v?.__dmlRelation === true) continue
      if (typeof v?.parse !== 'function') continue

      const meta = (v.parse as (name: string) => Record<string, unknown>)(fieldName)
      if (meta.computed) continue

      const dataType = meta.dataType as { name: string } | undefined
      const sqlType = DML_TO_SQL[dataType?.name ?? ''] ?? 'TEXT'
      const notNull = !meta.nullable ? ' NOT NULL' : ''
      let defaultClause = ''
      if (meta.defaultValue !== undefined) {
        if (typeof meta.defaultValue === 'string') {
          const escaped = meta.defaultValue.replace(/'/g, "''")
          defaultClause = ` DEFAULT '${escaped}'`
        } else {
          defaultClause = ` DEFAULT ${meta.defaultValue}`
        }
      }
      const uniqueClause = meta.unique ? ' UNIQUE' : ''
      columns.push(`${fieldName} ${sqlType}${notNull}${defaultClause}${uniqueClause}`)
    }

    // Implicit columns — only add if not already defined by the schema
    const definedColumns = new Set(columns.map((c) => c.split(' ')[0].toLowerCase()))
    if (!definedColumns.has('metadata')) columns.push("metadata JSONB DEFAULT '{}'")
    if (!definedColumns.has('created_at')) columns.push('created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()')
    if (!definedColumns.has('updated_at')) columns.push('updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()')
    if (!definedColumns.has('deleted_at')) columns.push('deleted_at TIMESTAMPTZ')

    const ddl = `CREATE TABLE IF NOT EXISTS ${finalTable} (${columns.join(', ')})`
    try {
      await (pg as { unsafe: (query: string) => Promise<unknown[]> }).unsafe(ddl)
      logger.info(`  Table: ${finalTable} (auto-generated from ${entity.name})`)
    } catch (err) {
      // Table may already exist with different schema — skip
      logger.warn(`  Table ${finalTable}: ${(err as Error).message}`)
    }
  }

  // Create link pivot tables
  for (const link of links) {
    const ddl = `CREATE TABLE IF NOT EXISTS ${link.tableName} (id TEXT PRIMARY KEY, ${link.leftFk} TEXT NOT NULL, ${link.rightFk} TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), deleted_at TIMESTAMPTZ)`
    try {
      await (pg as { unsafe: (query: string) => Promise<unknown[]> }).unsafe(ddl)
      logger.info(`  Link table: ${link.tableName} (auto-generated)`)
    } catch (err) {
      logger.warn(`  Link table ${link.tableName}: ${(err as Error).message}`)
    }
  }
}
