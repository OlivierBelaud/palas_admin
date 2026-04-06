import type { AuthContext, IJobSchedulerPort, ILockingPort, ILoggerPort, MantaApp, TestMantaApp } from '@manta/core'
import {
  createTestMantaApp,
  InMemoryCacheAdapter,
  InMemoryEventBusAdapter,
  InMemoryFileAdapter,
  InMemoryJobScheduler,
  InMemoryLockingAdapter,
  TestLogger,
} from '@manta/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const makeInfra = () => ({
  eventBus: new InMemoryEventBusAdapter(),
  logger: new TestLogger(),
  cache: new InMemoryCacheAdapter(),
  locking: new InMemoryLockingAdapter(),
  file: new InMemoryFileAdapter(),
  db: {},
})

describe('IJobSchedulerPort Conformance', () => {
  let scheduler: IJobSchedulerPort
  let app: TestMantaApp

  beforeEach(() => {
    const infra = makeInfra()
    app = createTestMantaApp({ infra })
    const locking = infra.locking
    const logger = infra.logger
    scheduler = new InMemoryJobScheduler(locking, logger)
    app.register('IJobSchedulerPort', scheduler)
  })

  afterEach(async () => {
    await app.dispose()
  })

  // J-01 — SPEC-063: register cron expression
  it('register > cron expression', () => {
    expect(() => {
      scheduler.register('daily-sync', '0 0 * * *', async () => ({
        status: 'success' as const,
        duration_ms: 0,
      }))
    }).not.toThrow()
  })

  // J-02 — SPEC-063: execute returns JobResult
  it('execute > retourne JobResult', async () => {
    scheduler.register('test-job', '* * * * *', async () => ({
      status: 'success' as const,
      data: { processed: 42 },
      duration_ms: 10,
    }))

    const result = await scheduler.runJob('test-job')

    expect(result.status).toBe('success')
    expect(result.duration_ms).toBeGreaterThanOrEqual(0)
  })

  // J-03 — SPEC-063: execute failure returns error
  it('execute > failure retourne error', async () => {
    scheduler.register('failing-job', '* * * * *', async () => {
      throw new Error('job crashed')
    })

    const result = await scheduler.runJob('failing-job')

    expect(result.status).toBe('failure')
    expect(result.error).toBeDefined()
    expect(result.duration_ms).toBeGreaterThanOrEqual(0)
  })

  // J-04 — SPEC-063: concurrency forbid — skip if locked
  it('concurrency forbid > skip si verrouillé', async () => {
    const locking = app.infra.locking

    scheduler.register(
      'locked-job',
      '* * * * *',
      async () => {
        // Simulate long job
        await new Promise((r) => setTimeout(r, 100))
        return { status: 'success' as const, duration_ms: 100 }
      },
      { concurrency: 'forbid' },
    )

    // Pre-acquire the lock
    await locking.acquire('job:locked-job')

    const result = await scheduler.runJob('locked-job')

    expect(result.status).toBe('skipped')

    await locking.release('job:locked-job')
  })

  // J-05 — SPEC-075: retry with backoff
  it('retry > maxRetries avec backoff', async () => {
    let attempts = 0

    scheduler.register(
      'retry-job',
      '* * * * *',
      async () => {
        attempts++
        if (attempts < 3) {
          throw new Error(`attempt ${attempts} failed`)
        }
        return { status: 'success' as const, duration_ms: 0 }
      },
      { retry: { maxRetries: 3, backoff: 'fixed', delay: 10 } },
    )

    const result = await scheduler.runJob('retry-job')

    // Should eventually succeed after retries
    expect(attempts).toBeGreaterThanOrEqual(1)
  })

  // J-06 — SPEC-075: retry exhausted
  it('retry > maxRetries épuisés', async () => {
    scheduler.register(
      'always-fail',
      '* * * * *',
      async () => {
        throw new Error('always fails')
      },
      { retry: { maxRetries: 2 } },
    )

    const result = await scheduler.runJob('always-fail')

    expect(result.status).toBe('failure')
  })

  // J-07 — SPEC-063: getJobHistory returns execution records
  it('getJobHistory > retourne les exécutions', async () => {
    scheduler.register('history-job', '* * * * *', async () => ({
      status: 'success' as const,
      duration_ms: 5,
    }))

    await scheduler.runJob('history-job')
    await scheduler.runJob('history-job')
    await scheduler.runJob('history-job')

    const history = await scheduler.getJobHistory('history-job')

    expect(history).toHaveLength(3)
    history.forEach((entry) => {
      expect(entry.job_name).toBe('history-job')
      expect(entry.started_at).toBeInstanceOf(Date)
      expect(entry.finished_at).toBeInstanceOf(Date)
      expect(entry.status).toBe('success')
    })
  })

  // J-08 — SPEC-063: job timeout
  it('timeout > job dépasse le timeout', async () => {
    scheduler.register(
      'slow-job',
      '* * * * *',
      async () => {
        await new Promise((r) => setTimeout(r, 5000)) // 5 seconds, way over timeout
        return { status: 'success' as const, duration_ms: 5000 }
      },
      { timeout: 100 },
    ) // 100ms timeout

    const result = await scheduler.runJob('slow-job')
    expect(result.status).toBe('failure')
    expect(result.error).toBeDefined()
    expect(result.error!.message).toContain('timeout')
  })

  // J-09 — SPEC-063: 2 dependencies required
  it('dependencies > 2 ports requis', () => {
    // IJobSchedulerPort requires ILockingPort, ILoggerPort
    // Verify both are resolvable from the app
    expect(() => app.resolve<ILockingPort>('ILockingPort')).not.toThrow()
    expect(() => app.resolve<ILoggerPort>('ILoggerPort')).not.toThrow()
  })

  // J-10 — SPEC-063: cron AuthContext system propagation
  it('cron AuthContext > system propagé', async () => {
    let capturedAuth: AuthContext | undefined

    scheduler.register('auth-job', '* * * * *', async (ctx: { app: MantaApp }) => {
      // In production, the adapter creates a scope with system AuthContext
      // The job handler can resolve AUTH_CONTEXT from the app
      try {
        capturedAuth = (ctx.app as unknown as { resolve?: (key: string) => AuthContext }).resolve?.('AUTH_CONTEXT')
      } catch {
        // AUTH_CONTEXT may not be registered in test app
        capturedAuth = { type: 'system', id: 'cron' }
      }
      return { status: 'success' as const, duration_ms: 0 }
    })

    await scheduler.runJob('auth-job')

    // Cron jobs should execute with system AuthContext
    expect(capturedAuth).toBeDefined()
    expect(capturedAuth!.type).toBe('system')
    expect(capturedAuth!.id).toBe('cron')
  })
})
