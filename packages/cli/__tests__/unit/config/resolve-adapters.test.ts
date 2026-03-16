// Section A3 — resolve-adapters
// Ref: CLI_SPEC §3.1-3.3, CLI_TESTS_SPEC §A3

import { describe, it, expect } from 'vitest'
import { resolveAdapters, checkAdapterAvailability } from '../../../src/config/resolve-adapters'
import type { LoadedConfig } from '../../../src/types'

describe('A3 — Adapter resolution', () => {
  // -------------------------------------------------------------------
  // ADAPT-01 — dev profile uses in-memory for cache, events, locking
  // -------------------------------------------------------------------
  it('ADAPT-01 — dev uses in-memory for cache, events, locking', () => {
    const adapters = resolveAdapters({}, 'dev')
    const cache = adapters.find(a => a.port === 'ICachePort')
    expect(cache!.adapter).toContain('InMemory')
    const events = adapters.find(a => a.port === 'IEventBusPort')
    expect(events!.adapter).toContain('InMemory')
    const locking = adapters.find(a => a.port === 'ILockingPort')
    expect(locking!.adapter).toContain('InMemory')
  })

  // -------------------------------------------------------------------
  // ADAPT-02 — dev uses pino with pretty: true
  // -------------------------------------------------------------------
  it('ADAPT-02 — dev uses pino for logger with pretty: true', () => {
    const adapters = resolveAdapters({}, 'dev')
    const logger = adapters.find(a => a.port === 'ILoggerPort')
    expect(logger!.adapter).toContain('pino')
    expect(logger!.options.pretty).toBe(true)
  })

  // -------------------------------------------------------------------
  // ADAPT-03 — prod uses pino with pretty: false
  // -------------------------------------------------------------------
  it('ADAPT-03 — prod uses pino for logger with pretty: false', () => {
    const adapters = resolveAdapters({}, 'prod')
    const logger = adapters.find(a => a.port === 'ILoggerPort')
    expect(logger!.adapter).toContain('pino')
    expect(logger!.options.pretty).toBe(false)
  })

  // -------------------------------------------------------------------
  // ADAPT-04 — prod uses upstash for cache
  // -------------------------------------------------------------------
  it('ADAPT-04 — prod uses upstash for cache', () => {
    const adapters = resolveAdapters({}, 'prod')
    const cache = adapters.find(a => a.port === 'ICachePort')
    expect(cache!.adapter).toContain('upstash')
  })

  // -------------------------------------------------------------------
  // ADAPT-05 — config override replaces default
  // -------------------------------------------------------------------
  it('ADAPT-05 — override in config replaces default adapter', () => {
    const config: LoadedConfig = {
      adapters: {
        cache: {
          adapter: '@manta/adapter-cache-custom',
          options: { url: 'redis://localhost' },
        },
      },
    }
    const adapters = resolveAdapters(config, 'dev')
    const cache = adapters.find(a => a.port === 'ICachePort')
    expect(cache!.adapter).toBe('@manta/adapter-cache-custom')
    expect(cache!.options.url).toBe('redis://localhost')
  })

  // -------------------------------------------------------------------
  // ADAPT-06 — resolves all 9 ports
  // -------------------------------------------------------------------
  it('ADAPT-06 — resolves all 9 ports', () => {
    const adapters = resolveAdapters({}, 'dev')
    const ports = adapters.map(a => a.port)
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

  // -------------------------------------------------------------------
  // ADAPT-07 — bundled adapters always available
  // -------------------------------------------------------------------
  it('ADAPT-07 — bundled adapters not in missing list', () => {
    const adapters = resolveAdapters({}, 'prod')
    const missing = checkAdapterAvailability(adapters, 'prod')
    const bundled = adapters.filter(a =>
      a.adapter.includes('pino') ||
      a.adapter.includes('drizzle-pg') ||
      a.adapter.includes('nitro'),
    )
    for (const b of bundled) {
      expect(missing).not.toContain(b.adapter)
    }
  })

  // -------------------------------------------------------------------
  // ADAPT-08 — dev uses drizzle-pg for database
  // -------------------------------------------------------------------
  it('ADAPT-08 — dev uses drizzle-pg for database', () => {
    const adapters = resolveAdapters({}, 'dev')
    const db = adapters.find(a => a.port === 'IDatabasePort')
    expect(db!.adapter).toContain('drizzle-pg')
  })

  // -------------------------------------------------------------------
  // ADAPT-09 — dev uses nitro for HTTP
  // -------------------------------------------------------------------
  it('ADAPT-09 — dev uses nitro for HTTP', () => {
    const adapters = resolveAdapters({}, 'dev')
    const http = adapters.find(a => a.port === 'IHttpPort')
    expect(http!.adapter).toContain('nitro')
  })

  // -------------------------------------------------------------------
  // ADAPT-10 — dev uses LocalFilesystem for files
  // -------------------------------------------------------------------
  it('ADAPT-10 — dev uses LocalFilesystemAdapter for files', () => {
    const adapters = resolveAdapters({}, 'dev')
    const file = adapters.find(a => a.port === 'IFilePort')
    expect(file!.adapter).toContain('LocalFilesystem')
  })

  // -------------------------------------------------------------------
  // ADAPT-11 — prod uses vercel-queues for events
  // -------------------------------------------------------------------
  it('ADAPT-11 — prod uses vercel-queues for events', () => {
    const adapters = resolveAdapters({}, 'prod')
    const events = adapters.find(a => a.port === 'IEventBusPort')
    expect(events!.adapter).toContain('vercel-queues')
  })

  // -------------------------------------------------------------------
  // ADAPT-12 — prod uses neon for locking
  // -------------------------------------------------------------------
  it('ADAPT-12 — prod uses neon for locking', () => {
    const adapters = resolveAdapters({}, 'prod')
    const locking = adapters.find(a => a.port === 'ILockingPort')
    expect(locking!.adapter).toContain('neon')
  })
})
