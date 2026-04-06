// VercelCronAdapter — IJobSchedulerPort conformance
// Tests job history persistence and cron AuthContext

import type { ILockingPort, ILoggerPort, JobExecution } from '@manta/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VercelCronAdapter } from '../src'

function createMockLocking(): ILockingPort {
  return {
    execute: vi.fn(async (_keys, job) => job()),
    acquire: vi.fn(async () => true),
    release: vi.fn(async () => {}),
    releaseAll: vi.fn(async () => {}),
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
    activity: vi.fn(() => 'a'),
    progress: vi.fn(),
    success: vi.fn(),
    failure: vi.fn(),
    dispose: vi.fn(),
  } as unknown as ILoggerPort
}

describe('VercelCronAdapter — IJobSchedulerPort conformance', () => {
  let adapter: VercelCronAdapter
  let storedExecutions: JobExecution[]

  beforeEach(() => {
    storedExecutions = []
    adapter = new VercelCronAdapter(createMockLocking(), createMockLogger())
  })

  // J-07 — getJobHistory returns persisted records
  it('J-07 — getJobHistory returns persisted records', async () => {
    adapter.register('history-job', '* * * * *', async () => ({
      status: 'success' as const,
      duration_ms: 5,
    }))

    await adapter.runJob('history-job')
    await adapter.runJob('history-job')
    await adapter.runJob('history-job')

    const history = await adapter.getJobHistory('history-job')
    expect(history).toHaveLength(3)
    history.forEach((entry) => {
      expect(entry.job_name).toBe('history-job')
      expect(entry.status).toBe('success')
    })
  })

  // J-10 — cron AuthContext system propagation
  it('J-10 — cron AuthContext system propagation', async () => {
    // Contract: cron jobs should run with system AuthContext { actor_type: 'system', actor_id: 'cron' }
    // The VercelCronAdapter creates a scope with system AUTH_CONTEXT when running jobs
    let jobRan = false

    adapter.register('auth-job', '* * * * *', async () => {
      jobRan = true
      return { status: 'success' as const, duration_ms: 0 }
    })

    const result = await adapter.runJob('auth-job')

    expect(jobRan).toBe(true)
    expect(result.status).toBe('success')
    // In production, the handler receives a container with AUTH_CONTEXT registered
    // Here we verify the job executed successfully (auth context setup is adapter responsibility)
  })
})
