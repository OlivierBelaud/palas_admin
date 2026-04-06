// Section A3 — resolve-adapters
// Ref: CLI_SPEC §3.1-3.3, CLI_TESTS_SPEC §A3

import { devPreset, vercelPreset } from '@manta/core'
import { describe, expect, it } from 'vitest'
import { checkAdapterAvailability, resolveAdapters } from '../../../src/config/resolve-adapters'
import type { LoadedConfig } from '../../../src/types'

describe('A3 — Adapter resolution', () => {
  // -------------------------------------------------------------------
  // ADAPT-01 — dev profile uses in-memory for cache, events, locking
  // -------------------------------------------------------------------
  it('ADAPT-01 — dev uses in-memory for cache, events, locking', () => {
    const adapters = resolveAdapters({}, devPreset)
    const cache = adapters.find((a) => a.port === 'ICachePort')
    expect(cache!.adapter).toContain('InMemory')
    const events = adapters.find((a) => a.port === 'IEventBusPort')
    expect(events!.adapter).toContain('InMemory')
    const locking = adapters.find((a) => a.port === 'ILockingPort')
    expect(locking!.adapter).toContain('InMemory')
  })

  // -------------------------------------------------------------------
  // ADAPT-02 — dev uses pino with pretty: true
  // -------------------------------------------------------------------
  it('ADAPT-02 — dev uses pino for logger with pretty: true', () => {
    const adapters = resolveAdapters({}, devPreset)
    const logger = adapters.find((a) => a.port === 'ILoggerPort')
    expect(logger!.adapter).toContain('pino')
    expect(logger!.options.pretty).toBe(true)
  })

  // -------------------------------------------------------------------
  // ADAPT-03 — prod uses pino with pretty: false
  // -------------------------------------------------------------------
  it('ADAPT-03 — prod uses pino for logger with pretty: false', () => {
    const adapters = resolveAdapters({}, vercelPreset)
    const logger = adapters.find((a) => a.port === 'ILoggerPort')
    expect(logger!.adapter).toContain('pino')
    expect(logger!.options.pretty).toBe(false)
  })

  // -------------------------------------------------------------------
  // ADAPT-04 — prod uses upstash for cache
  // -------------------------------------------------------------------
  it('ADAPT-04 — prod uses upstash for cache', () => {
    const adapters = resolveAdapters({}, vercelPreset)
    const cache = adapters.find((a) => a.port === 'ICachePort')
    expect(cache!.adapter).toContain('upstash')
  })

  // -------------------------------------------------------------------
  // ADAPT-05 — config override replaces default
  // -------------------------------------------------------------------
  it('ADAPT-05 — override in config replaces default adapter', () => {
    const config: LoadedConfig = {
      adapters: {
        ICachePort: {
          adapter: '@manta/adapter-cache-custom',
          options: { url: 'redis://localhost' },
        },
      },
    }
    const adapters = resolveAdapters(config, devPreset)
    const cache = adapters.find((a) => a.port === 'ICachePort')
    expect(cache!.adapter).toBe('@manta/adapter-cache-custom')
    expect(cache!.options.url).toBe('redis://localhost')
  })

  // -------------------------------------------------------------------
  // ADAPT-06 — resolves all expected ports
  // -------------------------------------------------------------------
  it('ADAPT-06 — resolves all expected ports', () => {
    const adapters = resolveAdapters({}, devPreset)
    const ports = adapters.map((a) => a.port)
    expect(ports).toContain('ILoggerPort')
    expect(ports).toContain('IDatabasePort')
    expect(ports).toContain('ICachePort')
    expect(ports).toContain('IEventBusPort')
    expect(ports).toContain('ILockingPort')
    expect(ports).toContain('IFilePort')
    expect(ports).toContain('IJobSchedulerPort')
    expect(ports).toContain('IHttpPort')
  })

  // -------------------------------------------------------------------
  // ADAPT-07 — bundled adapters always available
  // -------------------------------------------------------------------
  it('ADAPT-07 — bundled adapters not in missing list', () => {
    const adapters = resolveAdapters({}, vercelPreset)
    const missing = checkAdapterAvailability(adapters)
    const bundled = adapters.filter(
      (a) => a.adapter.includes('pino') || a.adapter.includes('drizzle') || a.adapter.includes('nitro'),
    )
    for (const b of bundled) {
      expect(missing).not.toContain(b.adapter)
    }
  })

  // -------------------------------------------------------------------
  // ADAPT-08 — dev uses database-pg for database
  // -------------------------------------------------------------------
  it('ADAPT-08 — dev uses database-pg for database', () => {
    const adapters = resolveAdapters({}, devPreset)
    const db = adapters.find((a) => a.port === 'IDatabasePort')
    expect(db!.adapter).toContain('database-pg')
  })

  // -------------------------------------------------------------------
  // ADAPT-09 — dev uses nitro for HTTP
  // -------------------------------------------------------------------
  it('ADAPT-09 — dev uses H3 for HTTP', () => {
    const adapters = resolveAdapters({}, devPreset)
    const http = adapters.find((a) => a.port === 'IHttpPort')
    expect(http!.adapter).toContain('h3')
  })

  // -------------------------------------------------------------------
  // ADAPT-10 — dev uses InMemoryFileAdapter for files
  // -------------------------------------------------------------------
  it('ADAPT-10 — dev uses InMemoryFileAdapter for files', () => {
    const adapters = resolveAdapters({}, devPreset)
    const file = adapters.find((a) => a.port === 'IFilePort')
    expect(file!.adapter).toContain('InMemory')
  })

  // -------------------------------------------------------------------
  // ADAPT-11 — prod uses vercel-queues for events
  // -------------------------------------------------------------------
  it('ADAPT-11 — prod uses upstash for events', () => {
    const adapters = resolveAdapters({}, vercelPreset)
    const events = adapters.find((a) => a.port === 'IEventBusPort')
    expect(events!.adapter).toContain('eventbus-upstash')
  })

  // -------------------------------------------------------------------
  // ADAPT-12 — prod uses neon for locking
  // -------------------------------------------------------------------
  it('ADAPT-12 — prod uses neon for locking', () => {
    const adapters = resolveAdapters({}, vercelPreset)
    const locking = adapters.find((a) => a.port === 'ILockingPort')
    expect(locking!.adapter).toContain('neon')
  })
})
