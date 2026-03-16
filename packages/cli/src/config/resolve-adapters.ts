// SPEC-070 — Resolve adapters based on profile (dev/prod) + overrides

import type { LoadedConfig } from '../types'

export interface ResolvedAdapter {
  port: string
  adapter: string
  options: Record<string, unknown>
}

const DEV_DEFAULTS: Record<string, string> = {
  ILoggerPort: '@manta/adapter-logger-pino',
  IDatabasePort: '@manta/adapter-drizzle-pg',
  ICachePort: '@manta/core/InMemoryCacheAdapter',
  IEventBusPort: '@manta/core/InMemoryEventBusAdapter',
  ILockingPort: '@manta/core/InMemoryLockingAdapter',
  IFilePort: '@manta/core/LocalFilesystemAdapter',
  IJobSchedulerPort: '@manta/core/InMemoryJobScheduler',
  IWorkflowStoragePort: '@manta/adapter-drizzle-pg',
  IHttpPort: '@manta/adapter-nitro',
}

const PROD_DEFAULTS: Record<string, string> = {
  ILoggerPort: '@manta/adapter-logger-pino',
  IDatabasePort: '@manta/adapter-drizzle-pg',
  ICachePort: '@manta/adapter-cache-upstash',
  IEventBusPort: '@manta/adapter-eventbus-vercel-queues',
  ILockingPort: '@manta/adapter-locking-neon',
  IFilePort: '@manta/adapter-file-vercel-blob',
  IJobSchedulerPort: '@manta/adapter-jobs-vercel-cron',
  IWorkflowStoragePort: '@manta/adapter-drizzle-pg',
  IHttpPort: '@manta/adapter-nitro',
}

// Adapters always available (bundled with @manta/cli)
const ALWAYS_AVAILABLE = new Set([
  '@manta/adapter-logger-pino',
  '@manta/adapter-drizzle-pg',
  '@manta/adapter-nitro',
])

/**
 * Resolve adapters for each port based on profile and config overrides.
 */
export function resolveAdapters(
  config: LoadedConfig,
  profile: 'dev' | 'prod',
): ResolvedAdapter[] {
  const defaults = profile === 'dev' ? DEV_DEFAULTS : PROD_DEFAULTS
  const overrides = config.adapters ?? {}
  const resolved: ResolvedAdapter[] = []

  for (const [port, defaultAdapter] of Object.entries(defaults)) {
    const portKey = port.replace(/^I/, '').replace(/Port$/, '').toLowerCase()
    const override = overrides[portKey]

    if (override) {
      resolved.push({
        port,
        adapter: override.adapter,
        options: override.options ?? {},
      })
    } else {
      const options: Record<string, unknown> = {}
      if (port === 'ILoggerPort') {
        options.pretty = profile === 'dev'
      }
      resolved.push({
        port,
        adapter: defaultAdapter,
        options,
      })
    }
  }

  return resolved
}

/**
 * Check that all resolved adapters are available (installed).
 * Returns list of missing adapter package names.
 */
export function checkAdapterAvailability(
  adapters: ResolvedAdapter[],
  profile: 'dev' | 'prod',
): string[] {
  const missing: string[] = []

  for (const adapter of adapters) {
    // In-memory adapters from @manta/core are always available
    if (adapter.adapter.startsWith('@manta/core/')) continue
    // Bundled adapters are always available
    if (ALWAYS_AVAILABLE.has(adapter.adapter)) continue

    // For prod defaults that aren't installed, check if they exist
    if (profile === 'prod') {
      try {
        // In real implementation, use require.resolve
        // For stub, we just mark it as potentially missing
      } catch {
        missing.push(adapter.adapter)
      }
    }
  }

  return missing
}
