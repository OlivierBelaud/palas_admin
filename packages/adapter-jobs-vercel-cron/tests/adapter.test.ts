// VercelCronAdapter — unit tests (deps mocked)

import type { ILockingPort, ILoggerPort } from '@manta/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VercelCronAdapter } from '../src'

function createMockLocking(): ILockingPort {
  const locks = new Set<string>()
  return {
    execute: vi.fn(async (_keys, job) => job()),
    acquire: vi.fn(async (keys) => {
      const keyArray = Array.isArray(keys) ? keys : [keys]
      for (const k of keyArray) {
        if (locks.has(k)) return false
      }
      for (const k of keyArray) locks.add(k)
      return true
    }),
    release: vi.fn(async (keys) => {
      const keyArray = Array.isArray(keys) ? keys : [keys]
      for (const k of keyArray) locks.delete(k)
    }),
    releaseAll: vi.fn(async () => locks.clear()),
  }
}

function createMockLogger(): ILoggerPort {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    http: vi.fn(),
    verbose: vi.fn(),
    debug: vi.fn(),
    silly: vi.fn(),
    panic: vi.fn(),
    shouldLog: vi.fn(() => true),
    setLogLevel: vi.fn(),
    unsetLogLevel: vi.fn(),
    activity: vi.fn(() => 'act-1'),
    progress: vi.fn(),
    success: vi.fn(),
    failure: vi.fn(),
    dispose: vi.fn(),
  } as unknown as ILoggerPort
}

describe('VercelCronAdapter', () => {
  let adapter: VercelCronAdapter
  let locking: ILockingPort
  let logger: ILoggerPort

  beforeEach(() => {
    locking = createMockLocking()
    logger = createMockLogger()
    adapter = new VercelCronAdapter(locking, logger)
  })

  // J-01 — register
  it('register > does not throw', () => {
    expect(() => {
      adapter.register('daily-sync', '0 0 * * *', async () => ({
        status: 'success' as const,
        duration_ms: 0,
      }))
    }).not.toThrow()
  })

  // J-02 — execute returns JobResult
  it('runJob > returns JobResult', async () => {
    adapter.register('test-job', '* * * * *', async () => ({
      status: 'success' as const,
      data: { processed: 42 },
      duration_ms: 10,
    }))

    const result = await adapter.runJob('test-job')
    expect(result.status).toBe('success')
    expect(result.duration_ms).toBeGreaterThanOrEqual(0)
  })

  // J-03 — failure
  it('runJob > failure returns error', async () => {
    adapter.register('failing-job', '* * * * *', async () => {
      throw new Error('job crashed')
    })

    const result = await adapter.runJob('failing-job')
    expect(result.status).toBe('failure')
    expect(result.error).toBeDefined()
  })

  // J-04 — concurrency forbid
  it('runJob > concurrency forbid skips if locked', async () => {
    adapter.register('locked-job', '* * * * *', async () => ({ status: 'success' as const, duration_ms: 0 }), {
      concurrency: 'forbid',
    })

    // Pre-acquire the lock
    await locking.acquire('job:locked-job')

    const result = await adapter.runJob('locked-job')
    expect(result.status).toBe('skipped')

    await locking.release('job:locked-job')
  })

  // J-08 — timeout
  it('runJob > timeout', async () => {
    adapter.register(
      'slow-job',
      '* * * * *',
      async () => {
        await new Promise((r) => setTimeout(r, 5000))
        return { status: 'success' as const, duration_ms: 5000 }
      },
      { timeout: 100 },
    )

    const result = await adapter.runJob('slow-job')
    expect(result.status).toBe('failure')
    expect(result.error).toBeDefined()
    expect(result.error!.message).toContain('timeout')
  })

  // NOT_FOUND for unregistered job
  it('runJob > throws NOT_FOUND for unregistered job', async () => {
    await expect(adapter.runJob('nonexistent')).rejects.toThrow()
  })

  // Constructor validation
  it('constructor > throws without locking', () => {
    expect(() => new VercelCronAdapter(null as any, logger)).toThrow()
  })

  it('constructor > throws without logger', () => {
    expect(() => new VercelCronAdapter(locking, null as any)).toThrow()
  })
})
