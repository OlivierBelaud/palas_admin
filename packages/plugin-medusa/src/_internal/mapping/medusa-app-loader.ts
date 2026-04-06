// Medusa App Loader — boots real Medusa commerce modules via MedusaApp()
// with a local or remote PostgreSQL database.
//
// This replaces InMemoryRepository-backed services with REAL Medusa services
// backed by MikroORM + PostgreSQL. The services have full CRUD, relations,
// soft-delete, and all Medusa business logic.

import { createRequire } from 'node:module'

// Resolve from @medusajs/modules-sdk context so that awilix, knex, etc. are found
const sdkPath = createRequire(import.meta.url).resolve('@medusajs/modules-sdk')
const require = createRequire(sdkPath)

export interface MedusaAppLoaderOptions {
  /** PostgreSQL connection URL */
  databaseUrl: string
  /** DB schema (default: 'public') */
  schema?: string
  /** Run migrations before bootstrap (default: true) */
  runMigrations?: boolean
  /** JWT secret for UserModule (required) */
  jwtSecret?: string
  /** Modules to load (default: all commerce modules) */
  modules?: string[]
}

export interface MedusaAppLoaderResult {
  /** Module services keyed by module name (e.g. 'product', 'customer') */
  // biome-ignore lint/suspicious/noExplicitAny: Medusa module services
  modules: Record<string, any>
  /** The Medusa query object (for remoteQuery) */
  // biome-ignore lint/suspicious/noExplicitAny: Medusa query
  query: any
  /** The Medusa link service */
  // biome-ignore lint/suspicious/noExplicitAny: Medusa link
  link: any
  /** Shutdown hook */
  shutdown: () => Promise<void>
  /** Number of tables created */
  tableCount: number
}

/**
 * Boot all Medusa commerce modules with a real PostgreSQL database.
 *
 * Uses `MedusaApp()` from `@medusajs/modules-sdk` which handles:
 * - MikroORM entity registration
 * - Database migrations
 * - Module service instantiation
 * - Awilix container wiring
 */
export async function loadMedusaApp(options: MedusaAppLoaderOptions): Promise<MedusaAppLoaderResult> {
  const { ModulesSdkUtils, createMedusaContainer, Modules } = require('@medusajs/utils')
  const { asValue } = require('awilix')

  const dbUrl = options.databaseUrl
  const schema = options.schema ?? 'public'
  const jwtSecret = options.jwtSecret ?? process.env.JWT_SECRET ?? 'manta-dev-secret-32chars-minimum!'

  // Create PG connection the Medusa way (knex)
  const pgConnection = ModulesSdkUtils.createPgConnection({
    clientUrl: dbUrl,
    schema,
  })

  // Verify connection
  await pgConnection.raw('SELECT 1')

  // Build module config
  const modulesConfig = buildModulesConfig(Modules, jwtSecret, options.modules)

  // Dynamic import for ESM compat (MikroORM requires ESM-style loading)
  const modulesSdk = await import('@medusajs/modules-sdk')
  const { MedusaApp, MedusaModule } = modulesSdk

  // biome-ignore lint/suspicious/noConsole: bootstrap logging
  console.log('[medusa-app-loader] MedusaApp loaded, starting migrations...')

  // Phase 1: Migrations
  if (options.runMigrations !== false) {
    const container = createMedusaContainer()
    container.register({
      __pg_connection__: asValue(pgConnection),
      logger: asValue(silentLogger),
    })

    const migResult = await MedusaApp({
      sharedContainer: container,
      sharedResourcesConfig: { database: { clientUrl: dbUrl, schema } },
      modulesConfig,
      migrationOnly: true,
    })
    await migResult.runMigrations()
  }

  // biome-ignore lint/suspicious/noConsole: bootstrap logging
  console.log('[medusa-app-loader] Migrations done, bootstrapping modules...')

  // Phase 2: Bootstrap modules
  MedusaModule.clearInstances()

  const container2 = createMedusaContainer()
  container2.register({
    __pg_connection__: asValue(pgConnection),
    logger: asValue(silentLogger),
  })

  // MedusaApp uses cwd for module resolution. Pass plugin-medusa's dir
  // so @medusajs/* packages are resolvable.
  const { dirname } = await import('node:path')
  const ownRequire = createRequire(import.meta.url)
  let pluginCwd: string
  try {
    pluginCwd = dirname(ownRequire.resolve('../package.json'))
  } catch {
    pluginCwd = process.cwd()
  }

  const result = await MedusaApp({
    sharedContainer: container2,
    sharedResourcesConfig: { database: { clientUrl: dbUrl, schema } },
    modulesConfig,
    cwd: pluginCwd,
  })

  // Count tables
  let tableCount = 0
  try {
    const tableResult = await pgConnection.raw(`SELECT count(*) as cnt FROM pg_tables WHERE schemaname = '${schema}'`)
    tableCount = parseInt(tableResult.rows[0].cnt, 10)
  } catch {
    // non-critical
  }

  return {
    modules: result.modules,
    query: result.query,
    link: result.link,
    tableCount,
    shutdown: async () => {
      try {
        await result.onApplicationPrepareShutdown()
        await result.onApplicationShutdown()
      } catch {
        /* best effort */
      }
      await pgConnection.destroy()
    },
  }
}

// ── Helpers ──────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: Medusa Modules enum
function buildModulesConfig(Modules: any, jwtSecret: string, moduleFilter?: string[]) {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic config
  const config: Record<string, any> = {}

  const allModules: Array<{ key: string; value: unknown }> = [
    { key: Modules.PRODUCT, value: true },
    { key: Modules.CUSTOMER, value: true },
    { key: Modules.ORDER, value: true },
    { key: Modules.CART, value: true },
    { key: Modules.PRICING, value: true },
    { key: Modules.PROMOTION, value: true },
    { key: Modules.INVENTORY, value: true },
    { key: Modules.SALES_CHANNEL, value: true },
    { key: Modules.TAX, value: true },
    { key: Modules.CURRENCY, value: true },
    { key: Modules.REGION, value: true },
    { key: Modules.STORE, value: true },
    { key: Modules.STOCK_LOCATION, value: true },
    { key: Modules.FULFILLMENT, value: true },
    { key: Modules.PAYMENT, value: true },
    { key: Modules.API_KEY, value: true },
    { key: Modules.NOTIFICATION, value: true },
    {
      key: Modules.USER,
      value: { resolve: '@medusajs/user', options: { jwt_secret: jwtSecret } },
    },
    {
      key: Modules.AUTH,
      value: {
        resolve: '@medusajs/auth',
        options: { providers: [{ resolve: '@medusajs/auth-emailpass', id: 'emailpass', options: {} }] },
      },
    },
  ]

  for (const { key, value } of allModules) {
    if (!moduleFilter || moduleFilter.includes(key)) {
      config[key] = value
    }
  }

  return config
}

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: console.error,
  debug: () => {},
  activity: () => ({ succeed: () => {}, fail: () => {} }),
  progress: () => {},
}
