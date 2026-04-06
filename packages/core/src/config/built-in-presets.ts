// Built-in presets for common deployment targets

import type { PresetDefinition } from './presets'
import { definePreset } from './presets'

/**
 * Dev preset — PG local + Pino pretty + all in-memory except DB/HTTP.
 */
export const devPreset: PresetDefinition = definePreset({
  name: 'dev',
  profile: 'dev',
  adapters: {
    ILoggerPort: { adapter: '@manta/adapter-logger-pino', options: { pretty: true } },
    IDatabasePort: { adapter: '@manta/adapter-database-pg' },
    ISchemaGenerator: { adapter: '@manta/adapter-database-pg/DrizzleSchemaGenerator' },
    IRepositoryFactory: { adapter: '@manta/adapter-database-pg/DrizzleRepositoryFactory' },
    ICachePort: { adapter: '@manta/core/InMemoryCacheAdapter' },
    IEventBusPort: { adapter: '@manta/core/InMemoryEventBusAdapter' },
    ILockingPort: { adapter: '@manta/core/InMemoryLockingAdapter' },
    IFilePort: { adapter: '@manta/core/InMemoryFileAdapter' },
    IJobSchedulerPort: { adapter: '@manta/core/InMemoryJobScheduler' },
    IHttpPort: { adapter: '@manta/adapter-h3' },
  },
})

/**
 * Vercel preset — Neon + Pino JSON + Upstash + Vercel services.
 */
export const vercelPreset: PresetDefinition = definePreset({
  name: 'vercel',
  profile: 'prod',
  adapters: {
    ILoggerPort: { adapter: '@manta/adapter-logger-pino', options: { pretty: false } },
    IDatabasePort: { adapter: '@manta/adapter-database-neon' },
    ISchemaGenerator: { adapter: '@manta/adapter-database-pg/DrizzleSchemaGenerator' },
    IRepositoryFactory: { adapter: '@manta/adapter-database-pg/DrizzleRepositoryFactory' },
    ICachePort: { adapter: '@manta/adapter-cache-upstash' },
    IEventBusPort: { adapter: '@manta/adapter-eventbus-upstash' },
    ILockingPort: { adapter: '@manta/adapter-locking-neon' },
    IFilePort: { adapter: '@manta/adapter-file-vercel-blob' },
    IJobSchedulerPort: { adapter: '@manta/adapter-jobs-vercel-cron' },
    IHttpPort: { adapter: '@manta/adapter-h3' },
  },
})

/** Map of built-in preset names to their definitions */
export const BUILT_IN_PRESETS: Record<string, PresetDefinition> = {
  dev: devPreset,
  vercel: vercelPreset,
}
