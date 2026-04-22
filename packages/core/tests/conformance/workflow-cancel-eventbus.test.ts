// W-CANCEL — WorkflowManager eventbus-backed cancel detection.
// See WORKFLOW_PROGRESS.md §10.3: preferred cancel channel is the event bus;
// the step-boundary check from PR-3 is the fallback when no bus is wired.

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
import { createStep, createWorkflow, type InMemoryEventBusAdapter, WorkflowManager } from '@manta/core'
import { createTestApp } from '@manta/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

// ─── Fakes (copied from workflow-run-lifecycle.test.ts — same shape) ────────

class FakeWorkflowStore implements IWorkflowStorePort {
  runs = new Map<string, WorkflowRun>()

  async create(run: NewWorkflowRun): Promise<void> {
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
    const run = this.runs.get(runId)
    if (!run) return
    let found = false
    run.steps = run.steps.map((s) => {
      if (s.name !== stepName) return s
      found = true
      return { ...s, ...patch } as StepState
    })
    if (!found) run.steps.push({ name: stepName, status: 'pending', ...patch } as StepState)
  }
  async updateStatus(
    runId: string,
    status: WorkflowStatus,
    fields?: { output?: unknown; error?: WorkflowError; completed_at?: Date },
  ): Promise<void> {
    const run = this.runs.get(runId)
    if (!run) return
    run.status = status
    if (fields?.output !== undefined) run.output = fields.output
    if (fields?.error !== undefined) run.error = fields.error
    if (fields?.completed_at !== undefined) run.completed_at = fields.completed_at
  }
  async requestCancel(runId: string): Promise<void> {
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
    return this.runs.get(runId) ?? null
  }
  async listOrphans(_opts: { olderThan: Date; limit?: number }): Promise<WorkflowRun[]> {
    /* not exercised here */
    return []
  }
  async markOrphanFailed(_runId: string, _error: WorkflowError): Promise<void> {
    /* not exercised here */
  }
}

class FakeProgressChannel implements IProgressChannelPort {
  snapshots = new Map<string, ProgressSnapshot>()
  async set(runId: string, snap: ProgressSnapshot): Promise<void> {
    this.snapshots.set(runId, snap)
  }
  async get(runId: string): Promise<ProgressSnapshot | null> {
    return this.snapshots.get(runId) ?? null
  }
  async clear(runId: string): Promise<void> {
    this.snapshots.delete(runId)
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('WorkflowManager — eventbus-backed cancel', () => {
  let app: MantaApp
  let eventBus: InMemoryEventBusAdapter
  let store: FakeWorkflowStore
  let progressChannel: FakeProgressChannel
  let manager: WorkflowManager

  beforeEach(() => {
    // createTestApp already wires an InMemoryEventBusAdapter — reuse it so the
    // manager picks the bus up through app.infra.eventBus.
    app = createTestApp() as unknown as MantaApp
    eventBus = app.infra.eventBus as InMemoryEventBusAdapter
    store = new FakeWorkflowStore()
    progressChannel = new FakeProgressChannel()
    manager = new WorkflowManager(app, { store, progressChannel })
  })

  // W-CANCEL-01 — eventbus publish aborts a running workflow + runs compensation
  it('W-CANCEL-01 — eventbus publish with matching runId aborts + compensates', async () => {
    const compensated: string[] = []
    const runId = `tx_${crypto.randomUUID().replace(/-/g, '')}`

    const stepA = createStep(
      'step-a',
      async () => ({ id: 'a1' }),
      async () => {
        compensated.push('a')
      },
    )
    // Long-running step that cooperates with ctx.signal — aborts as soon as
    // the controller fires, without waiting for the next step boundary.
    const stepB = createStep(
      'step-b',
      async (_input: unknown, ctx) => {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => resolve(), 2000)
          ctx.signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer)
              reject(
                new (class extends Error {
                  name = 'CancelledError'
                  code = 'WORKFLOW_CANCELLED'
                })('cancelled'),
              )
            },
            { once: true },
          )
        })
        return { id: 'b1' }
      },
      async () => {
        compensated.push('b')
      },
    )

    const wf = createWorkflow('cancel-evt-01', async (_input: unknown, { app }) => {
      await stepA({}, { app })
      return await stepB({}, { app })
    })
    manager.register(wf)

    // Publish the cancel event after step-a finished and step-b is mid-flight.
    setTimeout(() => {
      eventBus.emit({
        eventName: 'workflow:cancel',
        data: { runId },
        metadata: { timestamp: Date.now() },
      })
    }, 50)

    await expect(manager.run('cancel-evt-01', { transactionId: runId })).rejects.toMatchObject({
      code: 'WORKFLOW_CANCELLED',
    })

    // step-a compensated, step-b never completed → not in completedSteps → no compensation.
    expect(compensated).toContain('a')
    expect(compensated).not.toContain('b')

    const run = await store.get(runId)
    expect(run?.status).toBe('cancelled')
  })

  // W-CANCEL-02 — subscription cleans up in finally (no leak)
  it('W-CANCEL-02 — cancel subscription is removed on terminal completion', async () => {
    const runId = `tx_${crypto.randomUUID().replace(/-/g, '')}`

    // biome-ignore lint/suspicious/noExplicitAny: reaching into adapter internals for the leak assertion
    const subsBefore = ((eventBus as any)._subscribers as Map<string, unknown[]>).get('workflow:cancel')?.length ?? 0

    const s = createStep('only', async () => ({ ok: true }))
    const wf = createWorkflow('cancel-evt-02', async (_input: unknown, { app }) => s({}, { app }))
    manager.register(wf)

    await manager.run('cancel-evt-02', { transactionId: runId })

    // biome-ignore lint/suspicious/noExplicitAny: private state
    const subsAfter = ((eventBus as any)._subscribers as Map<string, unknown[]>).get('workflow:cancel')?.length ?? 0
    expect(subsAfter).toBe(subsBefore)
  })

  // W-CANCEL-03 — step-boundary fallback still works without an eventbus.
  // This mirrors WF-LIFE-05 but with an explicit "no eventbus" path: we
  // construct a plain test app that has an InMemoryEventBusAdapter (the default)
  // but publish nothing — the fallback must still catch the cancel via
  // store.cancel_requested_at on the next step boundary.
  it('W-CANCEL-03 — step-boundary fallback: no event, cancel_requested_at → next step aborts', async () => {
    const compensated: string[] = []

    const stepA = createStep(
      'step-a',
      async () => ({ id: 'a1' }),
      async () => {
        compensated.push('a')
      },
    )
    const triggerCancel = createStep('trigger-cancel', async () => {
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

    const wf = createWorkflow('cancel-evt-03', async (_input: unknown, { app }) => {
      await stepA({}, { app })
      await triggerCancel({}, { app })
      return await stepB({}, { app })
    })
    manager.register(wf)

    await expect(manager.run('cancel-evt-03')).rejects.toMatchObject({ code: 'WORKFLOW_CANCELLED' })
    expect(compensated).toContain('a')
    expect(compensated).not.toContain('b')
  })

  // W-CANCEL-04 — event with non-matching runId is ignored
  it('W-CANCEL-04 — cancel event for a different runId does not abort the current run', async () => {
    const runId = `tx_${crypto.randomUUID().replace(/-/g, '')}`

    const s = createStep('only', async () => ({ ok: true }))
    const wf = createWorkflow('cancel-evt-04', async (_input: unknown, { app }) => s({}, { app }))
    manager.register(wf)

    // Publish for an unrelated runId — the subscription handler must ignore it.
    setTimeout(() => {
      eventBus.emit({
        eventName: 'workflow:cancel',
        data: { runId: 'some-other-run' },
        metadata: { timestamp: Date.now() },
      })
    }, 5)

    const { transaction, result } = await manager.run('cancel-evt-04', { transactionId: runId })
    expect(transaction.state).toBe('done')
    expect(result).toEqual({ ok: true })
  })
})
