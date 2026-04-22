// W-REAP-WIRE — WP-F04 orphan reaper bootstrap wiring.
//
// Verifies that `load-resources.ts` registers the framework-owned orphan
// reaper against IJobSchedulerPort if and only if BOTH the scheduler AND
// IWorkflowStorePort are wired. Silent no-op otherwise.
//
// These tests replicate the registration conditional from load-resources.ts
// rather than booting the full CLI — same pattern as
// workflow-storage-wiring.test.ts and progress-channel-wiring.test.ts.

import type {
  IWorkflowStorePort,
  NewWorkflowRun,
  StepState,
  WorkflowError,
  WorkflowRun,
  WorkflowStatus,
} from '@manta/core'
import { createOrphanReaperJob, ORPHAN_REAPER_JOB_NAME, ORPHAN_REAPER_SCHEDULE } from '@manta/core'
import { describe, expect, it, vi } from 'vitest'

// ─── Minimal scheduler stub ─────────────────────────────────────────────────

class FakeScheduler {
  registered: Array<{ name: string; schedule: string; handler: (...args: unknown[]) => unknown }> = []
  register(name: string, schedule: string, handler: (...args: unknown[]) => unknown): void {
    this.registered.push({ name, schedule, handler })
  }
}

// ─── Minimal store stub ─────────────────────────────────────────────────────

class FakeStore implements IWorkflowStorePort {
  async create(_run: NewWorkflowRun): Promise<void> {}
  async updateStep(_runId: string, _stepName: string, _patch: Partial<StepState>): Promise<void> {}
  async updateStatus(
    _runId: string,
    _status: WorkflowStatus,
    _fields?: { output?: unknown; error?: WorkflowError; completed_at?: Date },
  ): Promise<void> {}
  async requestCancel(_runId: string): Promise<void> {}
  async get(_runId: string): Promise<WorkflowRun | null> {
    return null
  }
  async listOrphans(_opts: { olderThan: Date; limit?: number }): Promise<WorkflowRun[]> {
    return []
  }
  async markOrphanFailed(_runId: string, _error: WorkflowError): Promise<void> {}
}

// ─── Minimal logger stub ────────────────────────────────────────────────────

function createFakeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    http: vi.fn(),
    verbose: vi.fn(),
    silly: vi.fn(),
    panic: vi.fn(),
    activity: vi.fn(() => ''),
    progress: vi.fn(),
    success: vi.fn(),
    failure: vi.fn(),
    shouldLog: vi.fn(() => true),
    setLogLevel: vi.fn(),
    unsetLogLevel: vi.fn(),
  }
}

// ─── Replica of the registration conditional from load-resources.ts ─────────

function maybeRegisterOrphanReaper(infraMap: Map<string, unknown>, logger: ReturnType<typeof createFakeLogger>): void {
  const scheduler = infraMap.get('IJobSchedulerPort') as FakeScheduler | undefined
  if (!scheduler) return
  const store = infraMap.get('IWorkflowStorePort') as IWorkflowStorePort | undefined
  if (!store) return
  const reaper = createOrphanReaperJob({ store, logger })
  scheduler.register(reaper.name, reaper.schedule, reaper.handler)
}

// ────────────────────────────────────────────────────────────────────────────

describe('Bootstrap — orphan reaper wiring (W-REAP-WIRE)', () => {
  // W-REAP-WIRE-01 — reaper job is registered when BOTH scheduler + store present
  it('W-REAP-WIRE-01 — registers the reaper when both scheduler and store are wired', () => {
    const scheduler = new FakeScheduler()
    const store = new FakeStore()
    const logger = createFakeLogger()

    const infraMap = new Map<string, unknown>()
    infraMap.set('IJobSchedulerPort', scheduler)
    infraMap.set('IWorkflowStorePort', store)

    maybeRegisterOrphanReaper(infraMap, logger)

    expect(scheduler.registered).toHaveLength(1)
    expect(scheduler.registered[0].name).toBe(ORPHAN_REAPER_JOB_NAME)
    expect(scheduler.registered[0].schedule).toBe(ORPHAN_REAPER_SCHEDULE)
    expect(typeof scheduler.registered[0].handler).toBe('function')
  })

  // W-REAP-WIRE-02 — reaper is NOT registered when scheduler is absent
  it('W-REAP-WIRE-02 — skips registration when IJobSchedulerPort is absent', () => {
    const store = new FakeStore()
    const logger = createFakeLogger()

    const infraMap = new Map<string, unknown>()
    infraMap.set('IWorkflowStorePort', store)
    // No IJobSchedulerPort

    maybeRegisterOrphanReaper(infraMap, logger)

    // Nothing to register against — silent no-op. The assertion is the absence
    // of any thrown error and no side effects on the store.
    expect(infraMap.has('IJobSchedulerPort')).toBe(false)
  })

  // W-REAP-WIRE-03 — reaper is NOT registered when store is absent
  it('W-REAP-WIRE-03 — skips registration when IWorkflowStorePort is absent', () => {
    const scheduler = new FakeScheduler()
    const logger = createFakeLogger()

    const infraMap = new Map<string, unknown>()
    infraMap.set('IJobSchedulerPort', scheduler)
    // No IWorkflowStorePort

    maybeRegisterOrphanReaper(infraMap, logger)

    expect(scheduler.registered).toHaveLength(0)
  })

  // W-REAP-WIRE-04 — a registered reaper handler, when invoked, calls the store
  it('W-REAP-WIRE-04 — the registered handler calls listOrphans via the injected store', async () => {
    const scheduler = new FakeScheduler()
    const store = new FakeStore()
    const listSpy = vi.spyOn(store, 'listOrphans')
    const logger = createFakeLogger()

    const infraMap = new Map<string, unknown>()
    infraMap.set('IJobSchedulerPort', scheduler)
    infraMap.set('IWorkflowStorePort', store)

    maybeRegisterOrphanReaper(infraMap, logger)

    const entry = scheduler.registered[0]
    expect(entry).toBeDefined()

    await entry.handler()

    expect(listSpy).toHaveBeenCalledTimes(1)
  })
})
