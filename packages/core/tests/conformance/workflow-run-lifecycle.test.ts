// WF-LIFE — WorkflowManager integration with IWorkflowStorePort + IProgressChannelPort.
// See WORKFLOW_PROGRESS.md §10.1 (step lifecycle), §10.2 (fire-and-forget), §10.3 (cancel).

import type {
  IProgressChannelPort,
  IWorkflowStorePort,
  MantaApp,
  NewWorkflowRun,
  ProgressSnapshot,
  StepState,
  WorkflowError,
  WorkflowRun,
  WorkflowStatus,
} from '@manta/core'
import { createStep, createWorkflow, WorkflowManager } from '@manta/core'
import { createTestApp } from '@manta/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

// ─── Fakes ──────────────────────────────────────────────────────────────────

interface StoreCall {
  method: 'create' | 'updateStep' | 'updateStatus' | 'requestCancel' | 'get'
  args: unknown[]
}

class FakeWorkflowStore implements IWorkflowStorePort {
  runs = new Map<string, WorkflowRun>()
  calls: StoreCall[] = []
  /** When set, cause non-`get` methods to throw this error. */
  throwOn: 'none' | 'all' = 'none'

  async create(run: NewWorkflowRun): Promise<void> {
    this.calls.push({ method: 'create', args: [run] })
    if (this.throwOn === 'all') throw new Error('store unavailable')
    this.runs.set(run.id, {
      id: run.id,
      command_name: run.command_name,
      status: 'pending',
      steps: [...run.steps],
      input: run.input,
      started_at: new Date(),
    })
  }

  async updateStep(runId: string, stepName: string, patch: Partial<StepState>): Promise<void> {
    this.calls.push({ method: 'updateStep', args: [runId, stepName, patch] })
    if (this.throwOn === 'all') throw new Error('store unavailable')
    const run = this.runs.get(runId)
    if (!run) return
    let found = false
    run.steps = run.steps.map((s) => {
      if (s.name !== stepName) return s
      found = true
      return { ...s, ...patch } as StepState
    })
    // Append-on-miss — the engine seeds steps as [] on create; steps get
    // "discovered" as they run.
    if (!found) {
      run.steps.push({ name: stepName, status: 'pending', ...patch } as StepState)
    }
  }

  async updateStatus(
    runId: string,
    status: WorkflowStatus,
    fields?: { output?: unknown; error?: WorkflowError; completed_at?: Date },
  ): Promise<void> {
    this.calls.push({ method: 'updateStatus', args: [runId, status, fields] })
    if (this.throwOn === 'all') throw new Error('store unavailable')
    const run = this.runs.get(runId)
    if (!run) return
    run.status = status
    if (fields?.output !== undefined) run.output = fields.output
    if (fields?.error !== undefined) run.error = fields.error
    if (fields?.completed_at !== undefined) run.completed_at = fields.completed_at
  }

  async requestCancel(runId: string): Promise<void> {
    this.calls.push({ method: 'requestCancel', args: [runId] })
    if (this.throwOn === 'all') throw new Error('store unavailable')
    const run = this.runs.get(runId)
    if (!run) return
    if (
      !run.cancel_requested_at &&
      run.status !== 'succeeded' &&
      run.status !== 'failed' &&
      run.status !== 'cancelled'
    ) {
      run.cancel_requested_at = new Date()
    }
  }

  async get(runId: string): Promise<WorkflowRun | null> {
    this.calls.push({ method: 'get', args: [runId] })
    // `get` is allowed to throw (per the plan's resilience invariant) but
    // we only exercise that path via a dedicated sub-test.
    return this.runs.get(runId) ?? null
  }

  async listOrphans(_opts: { olderThan: Date; limit?: number }): Promise<WorkflowRun[]> {
    /* not exercised in this lifecycle suite */
    return []
  }

  async markOrphanFailed(_runId: string, _error: WorkflowError): Promise<void> {
    /* not exercised in this lifecycle suite */
  }

  updateStepCalls(): Array<[string, string, Partial<StepState>]> {
    return this.calls
      .filter((c) => c.method === 'updateStep')
      .map((c) => c.args as [string, string, Partial<StepState>])
  }

  updateStatusCalls(): Array<
    [string, WorkflowStatus, { output?: unknown; error?: WorkflowError; completed_at?: Date } | undefined]
  > {
    return this.calls
      .filter((c) => c.method === 'updateStatus')
      .map(
        (c) =>
          c.args as [
            string,
            WorkflowStatus,
            { output?: unknown; error?: WorkflowError; completed_at?: Date } | undefined,
          ],
      )
  }
}

class FakeProgressChannel implements IProgressChannelPort {
  snapshots = new Map<string, ProgressSnapshot>()
  cleared: string[] = []
  async set(runId: string, snap: ProgressSnapshot): Promise<void> {
    this.snapshots.set(runId, snap)
  }
  async get(runId: string): Promise<ProgressSnapshot | null> {
    return this.snapshots.get(runId) ?? null
  }
  async clear(runId: string): Promise<void> {
    this.cleared.push(runId)
    this.snapshots.delete(runId)
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('WorkflowManager + durable store lifecycle', () => {
  let app: MantaApp
  let store: FakeWorkflowStore
  let progressChannel: FakeProgressChannel
  let manager: WorkflowManager

  beforeEach(() => {
    app = createTestApp() as unknown as MantaApp
    store = new FakeWorkflowStore()
    progressChannel = new FakeProgressChannel()
    manager = new WorkflowManager(app, { store, progressChannel })
  })

  // WF-LIFE-01 — create on run start
  it('WF-LIFE-01 — manager calls store.create on run start', async () => {
    const s = createStep('greet', async () => ({ ok: true }))
    const wf = createWorkflow('lifecycle-01', async (_input: unknown, { app }) => s({}, { app }))
    manager.register(wf)

    const { transaction } = await manager.run('lifecycle-01')

    const createCalls = store.calls.filter((c) => c.method === 'create')
    expect(createCalls).toHaveLength(1)
    const [arg] = createCalls[0].args as [NewWorkflowRun]
    expect(arg.id).toBe(transaction.transactionId)
    expect(arg.command_name).toBe('lifecycle-01')
    expect(arg.steps).toEqual([])
  })

  // WF-LIFE-02 — updateStep(running) then updateStep(succeeded) for each step
  it('WF-LIFE-02 — updateStep(running) then updateStep(succeeded) for each step', async () => {
    const a = createStep('step-a', async () => ({ a: 1 }))
    const b = createStep('step-b', async () => ({ b: 2 }))
    const wf = createWorkflow('lifecycle-02', async (_input: unknown, { app }) => {
      await a({}, { app })
      return await b({}, { app })
    })
    manager.register(wf)

    await manager.run('lifecycle-02')

    const updates = store.updateStepCalls()
    // Expect the order: a running → a succeeded → b running → b succeeded
    const relevant = updates.filter(([_runId, name]) => name === 'step-a' || name === 'step-b')
    expect(relevant.map(([_runId, name, patch]) => [name, patch.status])).toEqual([
      ['step-a', 'running'],
      ['step-a', 'succeeded'],
      ['step-b', 'running'],
      ['step-b', 'succeeded'],
    ])
  })

  // WF-LIFE-03 — updateStatus(succeeded) + progressChannel.clear on success
  it('WF-LIFE-03 — updateStatus(succeeded) + progressChannel.clear on success', async () => {
    const s = createStep('sole', async () => ({ done: true }))
    const wf = createWorkflow('lifecycle-03', async (_input: unknown, { app }) => s({}, { app }))
    manager.register(wf)

    const { transaction } = await manager.run('lifecycle-03')

    const statuses = store.updateStatusCalls()
    expect(statuses).toHaveLength(1)
    expect(statuses[0][1]).toBe('succeeded')
    expect(statuses[0][2]?.output).toEqual({ done: true })
    expect(statuses[0][2]?.completed_at).toBeInstanceOf(Date)

    expect(progressChannel.cleared).toContain(transaction.transactionId)
  })

  // WF-LIFE-04 — updateStatus(failed) after exhausted retries
  it('WF-LIFE-04 — updateStatus(failed) after exhausted retries', async () => {
    let count = 0
    const failStep = createStep('always-fail', async () => {
      count++
      throw new Error('nope')
    })
    const wf = createWorkflow('lifecycle-04', async (_input: unknown, { app }) => failStep({}, { app }))
    manager.register(wf)

    await expect(manager.run('lifecycle-04')).rejects.toThrow('nope')

    // 3 retries total
    expect(count).toBe(3)
    const statuses = store.updateStatusCalls()
    const failedCall = statuses.find((c) => c[1] === 'failed')
    expect(failedCall).toBeDefined()
    expect(failedCall![2]?.error?.message).toBe('nope')
    expect(failedCall![2]?.completed_at).toBeInstanceOf(Date)
  })

  // WF-LIFE-05 — cancel between steps triggers compensation + cancelled status
  it('WF-LIFE-05 — cancel_requested_at between steps aborts next step, compensation runs, status=cancelled', async () => {
    const compensated: string[] = []

    const stepA = createStep(
      'step-a',
      async () => ({ id: 'a1' }),
      async () => {
        compensated.push('a')
      },
    )
    // Mid-workflow hook: after step-a succeeds, simulate an external
    // cancel request arriving (set cancel_requested_at on the durable run).
    const triggerCancel = createStep('trigger-cancel', async (_input: unknown, { app: _app }) => {
      // The run id is the transactionId. We know how to read it via the only
      // in-flight run recorded by the fake store.
      const [runId] = [...store.runs.keys()]
      await store.requestCancel(runId)
      return { triggered: true }
    })
    const stepB = createStep(
      'step-b',
      async () => ({ id: 'b1' }),
      async () => {
        compensated.push('b')
      },
    )

    const wf = createWorkflow('lifecycle-05', async (_input: unknown, { app }) => {
      await stepA({}, { app })
      await triggerCancel({}, { app })
      return await stepB({}, { app })
    })
    manager.register(wf)

    await expect(manager.run('lifecycle-05')).rejects.toMatchObject({ code: 'WORKFLOW_CANCELLED' })

    // step-b never ran → step-b has no compensation entry
    expect(compensated).toContain('a')
    expect(compensated).not.toContain('b')

    // Final status: cancelled
    const statuses = store.updateStatusCalls()
    expect(statuses.some((c) => c[1] === 'cancelled')).toBe(true)
  })

  // WF-LIFE-06 — store errors on writes are non-fatal
  it('WF-LIFE-06 — store write failures do not fail the workflow', async () => {
    const throwingStore = new FakeWorkflowStore()
    throwingStore.throwOn = 'all'
    const mgr = new WorkflowManager(app, { store: throwingStore, progressChannel })

    const s = createStep('ok', async () => ({ done: true }))
    const wf = createWorkflow('lifecycle-06', async (_input: unknown, { app }) => s({}, { app }))
    mgr.register(wf)

    const { transaction, result } = await mgr.run('lifecycle-06')
    expect(transaction.state).toBe('done')
    expect(result).toEqual({ done: true })
  })

  // WF-LIFE-07 — back-compat: workflows work with neither store nor progress channel
  it('WF-LIFE-07 — workflows still work when store and progressChannel are both absent', async () => {
    const plainApp = createTestApp() as unknown as MantaApp
    const plainManager = new WorkflowManager(plainApp)

    const s = createStep('sole', async () => ({ value: 42 }))
    const wf = createWorkflow('lifecycle-07', async (_input: unknown, { app }) => s({}, { app }))
    plainManager.register(wf)

    const { transaction, result } = await plainManager.run('lifecycle-07')
    expect(transaction.state).toBe('done')
    expect(result).toEqual({ value: 42 })
  })
})
