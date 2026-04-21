// Phase 1: Initialize infrastructure — resolve preset, adapters, logger, DB, builder.

import { DrizzlePgAdapter } from '@manta/adapter-database-pg'
import { PinoLoggerAdapter } from '@manta/adapter-logger-pino'
import type { IEventBusPort, ILockingPort, ILoggerPort } from '@manta/core'
import {
  createApp,
  InMemoryCacheAdapter,
  InMemoryEventBusAdapter,
  InMemoryFileAdapter,
  InMemoryLockingAdapter,
  MantaError,
} from '@manta/core'
import type { ICachePort, IFilePort, IRepositoryFactory } from '@manta/core/ports'
import { resolveAdapters, resolvePreset } from '../../config/resolve-adapters'
import { ADAPTER_FACTORIES } from '../bootstrap-app'
import type { AppRef, BootstrapContext } from '../bootstrap-context'
import { ensureFrameworkSchema } from '../bootstrap-helpers'

export async function initializeInfra(ctx: BootstrapContext, _appRef: AppRef): Promise<void> {
  const { config, mode, verbose } = ctx

  // [1] Resolve preset and adapters
  const preset = resolvePreset(config)
  const resolvedAdapters = resolveAdapters(config, preset)

  // [2] Initialize logger
  const loggerEntry = resolvedAdapters.find((a: any) => a.port === 'ILoggerPort')
  const loggerOpts = { level: verbose ? 'debug' : 'info', pretty: mode === 'dev', ...loggerEntry?.options }
  const loggerFactory = ADAPTER_FACTORIES[loggerEntry?.adapter ?? '@manta/adapter-logger-pino']
  const logger = (loggerFactory ? loggerFactory(loggerOpts) : new PinoLoggerAdapter(loggerOpts)) as ILoggerPort
  ctx.logger = logger

  // [3] Initialize database
  logger.info('Connecting to database...')
  const dbEntry = resolvedAdapters.find((a: any) => a.port === 'IDatabasePort')
  const dbFactory = dbEntry ? ADAPTER_FACTORIES[dbEntry.adapter] : undefined
  const db = (dbFactory ? await dbFactory(dbEntry!.options) : new DrizzlePgAdapter()) as DrizzlePgAdapter
  ctx.db = db

  await db.initialize({
    url: config.database!.url!,
    pool: config.database?.pool,
  })

  const healthy = await db.healthCheck()
  if (!healthy) throw new MantaError('INVALID_STATE', 'Database health check failed. Is PostgreSQL running?')
  logger.info('Database connected')

  // [4] Framework schema — versioned migration, safe on every boot (serverless
  //     cold starts serialize on a Postgres advisory lock, and a version gate
  //     skips DDL when already applied).
  //
  //     Hardened against serverless weirdness: a migration failure here
  //     (timeout, pooler quirk, transient DB error) must NOT crash the whole
  //     app — other endpoints would go dark for cold-start reasons unrelated
  //     to their own concerns. Log loudly and continue; the migration retries
  //     on the next cold start, and framework-dependent endpoints surface the
  //     real problem on their first hit.
  try {
    await ensureFrameworkSchema(db.getPool(), logger)
  } catch (err) {
    logger.error(`[manta-schema] framework migration failed; continuing boot — ${(err as Error).message}`)
  }

  // [5] Collect infra adapters, then build app via MantaAppBuilder
  const infraMap = new Map<string, unknown>()
  infraMap.set('ILoggerPort', logger)
  infraMap.set('IDatabasePort', db)
  ctx.infraMap = infraMap

  // Register remaining adapters (sorted: IJobSchedulerPort last)
  const sortedAdapters = [...resolvedAdapters].sort((a: any, b: any) => {
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

  // [5b] Create the repository factory
  const { DrizzleRepositoryFactory } = await import('@manta/adapter-database-pg')
  const repoFactory: IRepositoryFactory = db
    ? ((infraMap.get('IRepositoryFactory') as IRepositoryFactory) ?? new DrizzleRepositoryFactory({ db }))
    : new (await import('@manta/core')).InMemoryRepositoryFactory()
  infraMap.set('IRepositoryFactory', repoFactory)
  ctx.repoFactory = repoFactory

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
  ctx.builder = builder

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
}
