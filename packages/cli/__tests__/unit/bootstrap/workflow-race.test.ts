// W-RACE — 300ms short-circuit in the command callable.
// See WORKFLOW_PROGRESS.md §6.1 (the engine races the workflow against a 300ms
// timer — inline return for short workflows, runId return for long ones).
//
// These tests exercise WorkflowManager end-to-end with fake infra and
// replicate the race wrapper built by wire-commands.ts. The race is a pure
// control-flow pattern (Promise.race + pre-generated runId) so replicating
// it here mirrors the wiring tests for workflow-storage / progress-channel —
// keeps the unit test focused without booting the full CLI.

import type {
  IWorkflowStorePort,
  MantaApp,
  NewWorkflowRun,
  StepState,
  WorkflowError,
  WorkflowRun,
  WorkflowStatus,
} from '@manta/core'
import { createStep, createWorkflow, WorkflowManager } from '@manta/core'
import { createTestApp } from '@manta/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

// ─── Minimal FakeWorkflowStore (same shape as the lifecycle test) ───────────

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
  async requestCancel(_runId: string): Promise<void> {
    /* not exercised here */
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

// ─── Race wrapper (mirrors the one in wire-commands.ts) ─────────────────────

interface RunningEnvelope {
  runId: string
  status: 'running'
}
interface InlineEnvelope {
  runId: string
  status: 'succeeded'
  result: unknown
}

const SHORT_CIRCUIT_MS = 300

async function runWithRace(
  wm: WorkflowManager,
  name: string,
  input: Record<string, unknown> = {},
  onBackgroundError?: (err: unknown) => void,
): Promise<InlineEnvelope | RunningEnvelope> {
  const runId = `tx_${crypto.randomUUID().replace(/-/g, '')}`
  const runPromise = wm.run(name, { input, transactionId: runId })

  let timer: ReturnType<typeof setTimeout> | null = null
  const raced = await Promise.race([
    runPromise
      .then((value) => ({ __kind: 'inline' as const, value }))
      .catch((err) => ({ __kind: 'error' as const, err })),
    new Promise<{ __kind: 'async' }>((resolve) => {
      timer = setTimeout(() => resolve({ __kind: 'async' }), SHORT_CIRCUIT_MS)
    }),
  ])
  if (timer) clearTimeout(timer)

  if (raced.__kind === 'error') throw raced.err
  if (raced.__kind === 'inline') {
    return { status: 'succeeded', result: raced.value.result, runId }
  }
  runPromise.catch((err) => {
    onBackgroundError?.(err)
  })
  return { runId, status: 'running' }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Command callable — 300ms short-circuit (W-RACE)', () => {
  let app: MantaApp
  let store: FakeWorkflowStore
  let manager: WorkflowManager

  beforeEach(() => {
    app = createTestApp() as unknown as MantaApp
    store = new FakeWorkflowStore()
    manager = new WorkflowManager(app, { store })
  })

  // W-RACE-01 — workflow completes in <100ms → inline envelope
  it('W-RACE-01 — inline envelope when workflow completes within 300ms', async () => {
    const s = createStep('fast', async () => ({ value: 42 }))
    const wf = createWorkflow('race-01', async (_input: unknown, { app }) => s({}, { app }))
    manager.register(wf)

    const res = await runWithRace(manager, 'race-01')
    expect(res.status).toBe('succeeded')
    expect((res as InlineEnvelope).result).toEqual({ value: 42 })
    expect(typeof res.runId).toBe('string')
  })

  // W-RACE-02 — workflow takes >300ms → running envelope
  it('W-RACE-02 — async envelope when workflow exceeds 300ms', async () => {
    const slow = createStep('slow', async () => {
      await new Promise((r) => setTimeout(r, 500))
      return { value: 'late' }
    })
    const wf = createWorkflow('race-02', async (_input: unknown, { app }) => slow({}, { app }))
    manager.register(wf)

    const start = Date.now()
    const res = await runWithRace(manager, 'race-02')
    const elapsed = Date.now() - start

    expect(res.status).toBe('running')
    expect(typeof res.runId).toBe('string')
    // The race budget is 300ms. Allow generous slack for CI.
    expect(elapsed).toBeLessThan(600)
  })

  // W-RACE-03 — after the async return, the background run eventually writes terminal status
  it('W-RACE-03 — background run eventually writes terminal status to the store', async () => {
    const slow = createStep('slow-ok', async () => {
      await new Promise((r) => setTimeout(r, 400))
      return { done: true }
    })
    const wf = createWorkflow('race-03', async (_input: unknown, { app }) => slow({}, { app }))
    manager.register(wf)

    const res = await runWithRace(manager, 'race-03')
    expect(res.status).toBe('running')
    const runId = res.runId

    // Immediately after the async return, status is still pending/running.
    const midRun = await store.get(runId)
    expect(midRun?.status).not.toBe('succeeded')

    // Wait for the background run to complete.
    await new Promise((r) => setTimeout(r, 500))

    const finalRun = await store.get(runId)
    expect(finalRun?.status).toBe('succeeded')
    expect(finalRun?.output).toEqual({ done: true })
    expect(finalRun?.completed_at).toBeInstanceOf(Date)
  })

  // W-RACE-04 — if the background run throws AFTER the race resolved 'running',
  // the error is observed via the onBackgroundError callback but the caller
  // already has the 'running' envelope.
  it('W-RACE-04 — background error is captured separately, async return is unaffected', async () => {
    const slowFail = createStep('slow-fail', async () => {
      await new Promise((r) => setTimeout(r, 400))
      throw new Error('boom')
    })
    const wf = createWorkflow('race-04', async (_input: unknown, { app }) => slowFail({}, { app }))
    manager.register(wf)

    const bgErrors: unknown[] = []
    const res = await runWithRace(manager, 'race-04', {}, (err) => {
      bgErrors.push(err)
    })
    expect(res.status).toBe('running')
    const runId = res.runId

    // Let the background run exhaust retries + settle.
    await new Promise((r) => setTimeout(r, 3500))

    // Terminal status should be 'failed' with the error captured.
    const finalRun = await store.get(runId)
    expect(finalRun?.status).toBe('failed')
    expect(finalRun?.error?.message).toBe('boom')
    expect(bgErrors.length).toBeGreaterThanOrEqual(1)
  }, 10_000)
})
