// Section C — Adapter resolution
// Tests: C-01 → C-10

import { describe, it, expect } from 'vitest'
import { resolveAdapters, checkAdapterAvailability } from '../src/config/resolve-adapters'
import type { LoadedConfig } from '../src/types'

describe('C — Adapter resolution', () => {
  it('C-01 — dev profile uses in-memory adapters for cache, events, locking', () => {
    const config: LoadedConfig = {}
    const adapters = resolveAdapters(config, 'dev')

    const cache = adapters.find((a) => a.port === 'ICachePort')
    expect(cache).toBeDefined()
    expect(cache!.adapter).toContain('InMemory')

    const events = adapters.find((a) => a.port === 'IEventBusPort')
    expect(events).toBeDefined()
    expect(events!.adapter).toContain('InMemory')

    const locking = adapters.find((a) => a.port === 'ILockingPort')
    expect(locking).toBeDefined()
    expect(locking!.adapter).toContain('InMemory')
  })

  it('C-02 — dev profile uses pino for logger with pretty: true', () => {
    const config: LoadedConfig = {}
    const adapters = resolveAdapters(config, 'dev')

    const logger = adapters.find((a) => a.port === 'ILoggerPort')
    expect(logger).toBeDefined()
    expect(logger!.adapter).toContain('pino')
    expect(logger!.options.pretty).toBe(true)
  })

  it('C-03 — prod profile uses pino for logger with pretty: false', () => {
    const config: LoadedConfig = {}
    const adapters = resolveAdapters(config, 'prod')

    const logger = adapters.find((a) => a.port === 'ILoggerPort')
    expect(logger).toBeDefined()
    expect(logger!.adapter).toContain('pino')
    expect(logger!.options.pretty).toBe(false)
  })

  it('C-04 — prod profile uses upstash for cache', () => {
    const config: LoadedConfig = {}
    const adapters = resolveAdapters(config, 'prod')

    const cache = adapters.find((a) => a.port === 'ICachePort')
    expect(cache).toBeDefined()
    expect(cache!.adapter).toContain('upstash')
  })

  it('C-05 — override in config replaces default adapter', () => {
    const config: LoadedConfig = {
      adapters: {
        cache: {
          adapter: '@manta/adapter-cache-custom',
          options: { url: 'redis://localhost' },
        },
      },
    }
    const adapters = resolveAdapters(config, 'dev')

    const cache = adapters.find((a) => a.port === 'ICachePort')
    expect(cache).toBeDefined()
    expect(cache!.adapter).toBe('@manta/adapter-cache-custom')
    expect(cache!.options.url).toBe('redis://localhost')
  })

  it('C-06 — resolves all 9 ports', () => {
    const config: LoadedConfig = {}
    const adapters = resolveAdapters(config, 'dev')

    const ports = adapters.map((a) => a.port)
    expect(ports).toContain('ILoggerPort')
    expect(ports).toContain('IDatabasePort')
    expect(ports).toContain('ICachePort')
    expect(ports).toContain('IEventBusPort')
    expect(ports).toContain('ILockingPort')
    expect(ports).toContain('IFilePort')
    expect(ports).toContain('IJobSchedulerPort')
    expect(ports).toContain('IWorkflowStoragePort')
    expect(ports).toContain('IHttpPort')
  })

  it('C-07 — bundled adapters (pino, drizzle, nitro) are always available', () => {
    const config: LoadedConfig = {}
    const adapters = resolveAdapters(config, 'prod')
    const missing = checkAdapterAvailability(adapters, 'prod')

    // Bundled adapters should not be in the missing list
    // (pino, drizzle-pg, nitro are bundled with @manta/cli)
    const bundled = adapters.filter(
      (a) =>
        a.adapter.includes('pino') ||
        a.adapter.includes('drizzle-pg') ||
        a.adapter.includes('nitro'),
    )
    for (const b of bundled) {
      expect(missing).not.toContain(b.adapter)
    }
  })

  it('C-08 — dev profile uses drizzle-pg for database', () => {
    const config: LoadedConfig = {}
    const adapters = resolveAdapters(config, 'dev')

    const db = adapters.find((a) => a.port === 'IDatabasePort')
    expect(db).toBeDefined()
    expect(db!.adapter).toContain('drizzle-pg')
  })

  it('C-09 — dev profile uses nitro for HTTP', () => {
    const config: LoadedConfig = {}
    const adapters = resolveAdapters(config, 'dev')

    const http = adapters.find((a) => a.port === 'IHttpPort')
    expect(http).toBeDefined()
    expect(http!.adapter).toContain('nitro')
  })

  it('C-10 — dev profile uses LocalFilesystemAdapter for files (NOT InMemory)', () => {
    const config: LoadedConfig = {}
    const adapters = resolveAdapters(config, 'dev')

    const file = adapters.find((a) => a.port === 'IFilePort')
    expect(file).toBeDefined()
    expect(file!.adapter).toContain('LocalFilesystem')
  })
})
