// W-HTTP — GET|DELETE /api/admin/_workflow/:id endpoints.
// Covers WORKFLOW_PROGRESS.md §6.5 (HTTP contract) and §10.3 (cancel publish).

import { H3Adapter } from '@manta/adapter-h3'
import type {
  IEventBusPort,
  IProgressChannelPort,
  IWorkflowStorePort,
  MantaApp,
  Message,
  NewWorkflowRun,
  ProgressSnapshot,
  StepState,
  WorkflowError,
  WorkflowRun,
  WorkflowStatus,
} from '@manta/core'
import { InMemoryEventBusAdapter } from '@manta/core'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AppRef, BootstrapContext } from '../../../src/bootstrap/bootstrap-context'
import { wireWorkflowRoutes } from '../../../src/bootstrap/phases/wire/wire-workflow-routes'

// ─── Fakes ──────────────────────────────────────────────────────────────────

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
    run.steps = run.steps.map((s) => (s.name === stepName ? ({ ...s, ...patch } as StepState) : s))
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

// ─── Harness ────────────────────────────────────────────────────────────────

interface Harness {
  adapter: H3Adapter
  store: FakeWorkflowStore
  progressChannel: FakeProgressChannel
  eventBus: InMemoryEventBusAdapter | null
  observedEvents: Message[]
}

async function buildHarness(options?: { withEventBus?: boolean }): Promise<Harness> {
  const adapter = new H3Adapter({ port: 0, isDev: true })
  const store = new FakeWorkflowStore()
  const progressChannel = new FakeProgressChannel()
  const eventBus = options?.withEventBus === false ? null : new InMemoryEventBusAdapter()
  const observedEvents: Message[] = []
  if (eventBus) {
    eventBus.subscribe('workflow:cancel', (msg) => {
      observedEvents.push(msg)
    })
  }

  // Build a minimal `MantaApp.resolve` shim that returns ports on request.
  const resolveMap = new Map<string, unknown>()
  resolveMap.set('IWorkflowStorePort', store)
  resolveMap.set('IProgressChannelPort', progressChannel)
  if (eventBus) resolveMap.set('IEventBusPort', eventBus)

  const app = {
    resolve<T>(key: string): T {
      const v = resolveMap.get(key)
      if (v === undefined) throw new Error(`Cannot resolve "${key}"`)
      return v as T
    },
  } as unknown as MantaApp

  const appRef: AppRef = { current: app }

  const fakeLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
    child: () => fakeLogger,
  }

  const ctx = {
    adapter,
    logger: fakeLogger,
  } as unknown as BootstrapContext

  await wireWorkflowRoutes(ctx, appRef)

  return { adapter, store, progressChannel, eventBus, observedEvents }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('GET|DELETE /api/admin/_workflow/:id', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await buildHarness()
  })

  // W-HTTP-01 — GET 404 for unknown runId
  it('W-HTTP-01 — GET returns 404 for unknown runId', async () => {
    const res = await harness.adapter.handleRequest(
      new Request('http://test/api/admin/_workflow/no-such-run', { method: 'GET' }),
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { type: string }
    expect(body.type).toBe('NOT_FOUND')
  })

  // W-HTTP-02 — GET merges durable + live snapshots
  it('W-HTTP-02 — GET merges store + progressChannel snapshots', async () => {
    const runId = 'run-02'
    await harness.store.create({ id: runId, command_name: 'cmd:foo', steps: [], input: { a: 1 } })
    await harness.store.updateStep(runId, 'step-a', { status: 'running', started_at: new Date() } as Partial<StepState>)
    await harness.progressChannel.set(runId, { stepName: 'step-a', current: 3, total: 10, at: Date.now() })

    const res = await harness.adapter.handleRequest(
      new Request(`http://test/api/admin/_workflow/${runId}`, { method: 'GET' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: {
        id: string
        command_name: string
        status: string
        steps: Array<{ name: string; status: string }>
        inFlightProgress?: { stepName: string; current: number; total: number }
      }
    }
    expect(body.data.id).toBe(runId)
    expect(body.data.command_name).toBe('cmd:foo')
    expect(body.data.steps).toHaveLength(0) // updateStep with name that's not in steps array → no-op in our fake
    expect(body.data.inFlightProgress?.stepName).toBe('step-a')
    expect(body.data.inFlightProgress?.current).toBe(3)
    expect(body.data.inFlightProgress?.total).toBe(10)
  })

  // W-HTTP-03 — GET with no live progress → inFlightProgress is undefined
  it('W-HTTP-03 — GET with no live progress returns inFlightProgress undefined', async () => {
    const runId = 'run-03'
    await harness.store.create({ id: runId, command_name: 'cmd:foo', steps: [], input: {} })

    const res = await harness.adapter.handleRequest(
      new Request(`http://test/api/admin/_workflow/${runId}`, { method: 'GET' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { inFlightProgress?: unknown } }
    expect(body.data.inFlightProgress).toBeUndefined()
  })

  // W-HTTP-04 — DELETE sets cancel_requested_at and returns cancel_requested
  it('W-HTTP-04 — DELETE sets cancel_requested_at and returns cancel_requested', async () => {
    const runId = 'run-04'
    await harness.store.create({ id: runId, command_name: 'cmd:foo', steps: [], input: {} })

    const res = await harness.adapter.handleRequest(
      new Request(`http://test/api/admin/_workflow/${runId}`, { method: 'DELETE' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { status: string; runId: string } }
    expect(body.data.status).toBe('cancel_requested')
    expect(body.data.runId).toBe(runId)

    const run = await harness.store.get(runId)
    expect(run?.cancel_requested_at).toBeInstanceOf(Date)
  })

  // W-HTTP-05 — DELETE is idempotent on terminal runs
  it('W-HTTP-05 — DELETE on a terminal run is idempotent (no error)', async () => {
    const runId = 'run-05'
    await harness.store.create({ id: runId, command_name: 'cmd:foo', steps: [], input: {} })
    await harness.store.updateStatus(runId, 'succeeded', { completed_at: new Date() })

    const res = await harness.adapter.handleRequest(
      new Request(`http://test/api/admin/_workflow/${runId}`, { method: 'DELETE' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { status: string; runId: string } }
    expect(body.data.status).toBe('cancel_requested')
    expect(body.data.runId).toBe(runId)

    // Terminal runs must NOT have cancel_requested_at flipped — requestCancel is a no-op.
    const run = await harness.store.get(runId)
    expect(run?.cancel_requested_at).toBeUndefined()
  })

  // W-HTTP-06 — DELETE with eventbus publishes workflow:cancel
  it('W-HTTP-06 — DELETE publishes workflow:cancel on the eventbus with the runId', async () => {
    const runId = 'run-06'
    await harness.store.create({ id: runId, command_name: 'cmd:foo', steps: [], input: {} })

    await harness.adapter.handleRequest(new Request(`http://test/api/admin/_workflow/${runId}`, { method: 'DELETE' }))

    // Event bus delivery is fire-and-forget — the handler runs in a microtask.
    // Yield once so the pending microtask fires before we assert.
    await new Promise((r) => setTimeout(r, 0))

    expect(harness.observedEvents.length).toBeGreaterThanOrEqual(1)
    const evt = harness.observedEvents[0]
    expect(evt.eventName).toBe('workflow:cancel')
    expect((evt.data as { runId?: string }).runId).toBe(runId)
  })

  // W-HTTP-07 — No eventbus wired → DELETE still returns OK + sets cancel_requested_at
  it('W-HTTP-07 — DELETE still works when no eventbus is wired (step-boundary fallback)', async () => {
    const noBus = await buildHarness({ withEventBus: false })
    const runId = 'run-07'
    await noBus.store.create({ id: runId, command_name: 'cmd:foo', steps: [], input: {} })

    const res = await noBus.adapter.handleRequest(
      new Request(`http://test/api/admin/_workflow/${runId}`, { method: 'DELETE' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { status: string } }
    expect(body.data.status).toBe('cancel_requested')
    expect((await noBus.store.get(runId))?.cancel_requested_at).toBeInstanceOf(Date)
  })
})
