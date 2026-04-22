// W-REAP — WP-F04 orphan reaper unit tests.
//
// Covers the framework-owned `createOrphanReaperJob` factory:
//   - Calls listOrphans + markOrphanFailed for each orphan
//   - No-op when no orphans
//   - Continues on per-orphan error (logs, does not throw)
//   - Uses custom threshold if passed

import {
  createOrphanReaperJob,
  DEFAULT_ORPHAN_THRESHOLD_MS,
  type IWorkflowStorePort,
  type NewWorkflowRun,
  ORPHAN_REAPER_JOB_NAME,
  ORPHAN_REAPER_SCHEDULE,
  type StepState,
  WORKFLOW_ORPHANED_CODE,
  type WorkflowError,
  type WorkflowRun,
  type WorkflowStatus,
} from '@manta/core'
import { describe, expect, it, vi } from 'vitest'

// ─── Fake logger captures calls ─────────────────────────────────────────────

function createFakeLogger() {
  const calls: Array<{ level: string; msg: string; args: unknown[] }> = []
  return {
    calls,
    info: (msg: string, ...args: unknown[]) => {
      calls.push({ level: 'info', msg, args })
    },
    warn: (msg: string, ...args: unknown[]) => {
      calls.push({ level: 'warn', msg, args })
    },
    error: (msg: string, ...args: unknown[]) => {
      calls.push({ level: 'error', msg, args })
    },
    debug: () => {},
    http: () => {},
    verbose: () => {},
    silly: () => {},
    panic: () => {},
    activity: () => '',
    progress: () => {},
    success: () => {},
    failure: () => {},
    shouldLog: () => true,
    setLogLevel: () => {},
    unsetLogLevel: () => {},
  }
}

// ─── Fake store — records listOrphans + markOrphanFailed calls ──────────────

class FakeStore implements IWorkflowStorePort {
  orphans: WorkflowRun[] = []
  listCalls: Array<{ olderThan: Date; limit?: number }> = []
  markCalls: Array<{ runId: string; error: WorkflowError }> = []
  /** If set, markOrphanFailed throws for runs whose id is in this set. */
  failFor = new Set<string>()

  async create(_run: NewWorkflowRun): Promise<void> {
    /* not exercised */
  }
  async updateStep(_runId: string, _stepName: string, _patch: Partial<StepState>): Promise<void> {
    /* not exercised */
  }
  async updateStatus(
    _runId: string,
    _status: WorkflowStatus,
    _fields?: { output?: unknown; error?: WorkflowError; completed_at?: Date },
  ): Promise<void> {
    /* not exercised */
  }
  async requestCancel(_runId: string): Promise<void> {
    /* not exercised */
  }
  async get(_runId: string): Promise<WorkflowRun | null> {
    return null
  }
  async listOrphans(opts: { olderThan: Date; limit?: number }): Promise<WorkflowRun[]> {
    this.listCalls.push(opts)
    return this.orphans
  }
  async markOrphanFailed(runId: string, error: WorkflowError): Promise<void> {
    this.markCalls.push({ runId, error })
    if (this.failFor.has(runId)) throw new Error(`mark failed for ${runId}`)
  }
}

function fakeOrphan(id: string): WorkflowRun {
  return {
    id,
    command_name: 'products:import',
    status: 'running',
    steps: [{ name: 'fetch', status: 'running' }],
    input: {},
    started_at: new Date(Date.now() - 10 * 60 * 1000),
  }
}

describe('createOrphanReaperJob (W-REAP)', () => {
  // W-REAP-01 — reaper calls listOrphans + markOrphanFailed for each orphan
  it('W-REAP-01 — calls listOrphans + markOrphanFailed for each orphan', async () => {
    const store = new FakeStore()
    store.orphans = [fakeOrphan('run-a'), fakeOrphan('run-b'), fakeOrphan('run-c')]
    const logger = createFakeLogger()

    const reaper = createOrphanReaperJob({ store, logger })
    const result = await reaper.handler()

    expect(store.listCalls).toHaveLength(1)
    expect(store.markCalls).toHaveLength(3)
    expect(store.markCalls.map((c) => c.runId).sort()).toEqual(['run-a', 'run-b', 'run-c'])
    // Every mark call carries the stable code + message referencing the threshold.
    for (const call of store.markCalls) {
      expect(call.error.code).toBe(WORKFLOW_ORPHANED_CODE)
      expect(call.error.message).toMatch(/orphaned/i)
    }
    expect(result.status).toBe('success')
    expect(result.data.reaped).toBe(3)
    expect(result.data.total).toBe(3)
  })

  // W-REAP-02 — reaper is no-op when no orphans
  it('W-REAP-02 — is a no-op when listOrphans returns empty', async () => {
    const store = new FakeStore()
    store.orphans = []
    const logger = createFakeLogger()

    const reaper = createOrphanReaperJob({ store, logger })
    const result = await reaper.handler()

    expect(store.listCalls).toHaveLength(1)
    expect(store.markCalls).toHaveLength(0)
    expect(result.data.reaped).toBe(0)
    expect(result.data.total).toBe(0)
  })

  // W-REAP-03 — reaper continues on error for one orphan (logs, doesn't throw)
  it('W-REAP-03 — continues on error for one orphan (logs, does not throw)', async () => {
    const store = new FakeStore()
    store.orphans = [fakeOrphan('run-a'), fakeOrphan('run-b'), fakeOrphan('run-c')]
    store.failFor = new Set(['run-b'])
    const logger = createFakeLogger()

    const reaper = createOrphanReaperJob({ store, logger })

    // Must not throw even though markOrphanFailed blows up for run-b.
    const result = await reaper.handler()

    // Every orphan was attempted; run-b failed, the other two succeeded.
    expect(store.markCalls.map((c) => c.runId).sort()).toEqual(['run-a', 'run-b', 'run-c'])
    expect(result.data.reaped).toBe(2)
    expect(result.data.total).toBe(3)

    // The warning was logged at least once.
    const warnings = logger.calls.filter((c) => c.level === 'warn')
    expect(warnings.length).toBeGreaterThanOrEqual(1)
    expect(warnings[0].msg).toMatch(/run-b/)
  })

  // W-REAP-04 — reaper uses custom threshold if passed
  it('W-REAP-04 — passes custom olderThan to listOrphans when threshold is customized', async () => {
    const store = new FakeStore()
    store.orphans = []
    const logger = createFakeLogger()

    // Freeze time so we can assert the cutoff precisely.
    const now = new Date('2026-04-17T12:00:00Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)

    try {
      const customThreshold = 2 * 60 * 1000 // 2 minutes
      const reaper = createOrphanReaperJob({ store, logger }, { orphanThresholdMs: customThreshold })
      await reaper.handler()

      expect(store.listCalls).toHaveLength(1)
      const call = store.listCalls[0]
      expect(call.olderThan.getTime()).toBe(now.getTime() - customThreshold)
      expect(call.limit).toBe(50) // default
    } finally {
      vi.useRealTimers()
    }
  })

  // W-REAP-05 — exported constants expose the job identity
  it('W-REAP-05 — exposes the stable job identity via exported constants', () => {
    const store = new FakeStore()
    const logger = createFakeLogger()
    const reaper = createOrphanReaperJob({ store, logger })

    expect(reaper.name).toBe(ORPHAN_REAPER_JOB_NAME)
    expect(reaper.schedule).toBe(ORPHAN_REAPER_SCHEDULE)
    expect(ORPHAN_REAPER_JOB_NAME).toBe('__manta_workflow_orphan_reaper')
  })

  // W-REAP-06 — default threshold is 5 minutes (DEFAULT_ORPHAN_THRESHOLD_MS)
  it('W-REAP-06 — default threshold is 5 minutes', async () => {
    const store = new FakeStore()
    const logger = createFakeLogger()

    const now = new Date('2026-04-17T12:00:00Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)
    try {
      const reaper = createOrphanReaperJob({ store, logger })
      await reaper.handler()

      expect(DEFAULT_ORPHAN_THRESHOLD_MS).toBe(5 * 60 * 1000)
      expect(store.listCalls[0].olderThan.getTime()).toBe(now.getTime() - DEFAULT_ORPHAN_THRESHOLD_MS)
    } finally {
      vi.useRealTimers()
    }
  })
})
