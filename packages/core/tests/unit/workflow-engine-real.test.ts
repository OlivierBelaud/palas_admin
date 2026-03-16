import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createTestContainer,
  resetAll,
  InMemoryContainer,
  InMemoryWorkflowEngine,
  InMemoryWorkflowStorage,
} from '@manta/test-utils'
import { createWorkflow, step, type WorkflowLifecycleEvent } from '@manta/core'

describe('InMemoryWorkflowEngine — Real Execution', () => {
  let container: InMemoryContainer
  let engine: InMemoryWorkflowEngine
  let storage: InMemoryWorkflowStorage

  beforeEach(() => {
    container = createTestContainer()
    engine = container.resolve<InMemoryWorkflowEngine>('IWorkflowEnginePort')
    storage = container.resolve<InMemoryWorkflowStorage>('IWorkflowStoragePort')
    engine.configure({ storage, container })
  })

  afterEach(async () => {
    await resetAll(container)
  })

  // WE-01 — Sequential steps execute and return last step output
  it('executes steps sequentially', async () => {
    const wf = createWorkflow({
      name: 'seq-test',
      steps: [
        step({
          name: 'add',
          handler: async ({ input }) => ({ sum: (input.a as number) + (input.b as number) }),
        }),
        step({
          name: 'double',
          handler: async ({ previousOutput }) => {
            const sum = (previousOutput['add'] as { sum: number }).sum
            return { result: sum * 2 }
          },
        }),
      ],
    })

    engine.registerWorkflow(wf)
    const result = await engine.run('seq-test', { input: { a: 3, b: 4 } })

    expect(result.status).toBe('done')
    expect(result.output).toEqual({ result: 14 })
  })

  // WE-02 — Compensation on failure in reverse order
  it('compensates on failure in reverse order', async () => {
    const compensated: string[] = []

    const wf = createWorkflow({
      name: 'comp-test',
      steps: [
        step({
          name: 'step-a',
          handler: async () => ({ id: 'a1' }),
          compensation: async () => { compensated.push('a') },
        }),
        step({
          name: 'step-b',
          handler: async () => ({ id: 'b1' }),
          compensation: async () => { compensated.push('b') },
        }),
        step({
          name: 'step-c',
          handler: async () => { throw new Error('c failed') },
        }),
      ],
    })

    engine.registerWorkflow(wf)

    // throwOnError: false → returns result instead of throwing
    const result = await engine.run('comp-test', {
      input: {},
      throwOnError: false,
    })

    expect(result.status).toBe('failed')
    expect(result.errors).toContain('c failed')
    expect(compensated).toEqual(['b', 'a'])
  })

  // WE-03 — throwOnError: true (default) throws on failure
  it('throws on failure when throwOnError is true', async () => {
    const wf = createWorkflow({
      name: 'throw-test',
      steps: [
        step({
          name: 'fail',
          handler: async () => { throw new Error('boom') },
        }),
      ],
    })

    engine.registerWorkflow(wf)
    await expect(engine.run('throw-test', { input: {} })).rejects.toThrow('boom')
  })

  // WE-04 — Lifecycle events emitted during execution
  it('emits lifecycle events', async () => {
    const events: WorkflowLifecycleEvent[] = []

    engine.subscribe({ event: 'STEP_SUCCESS' }, (e) => { events.push(e) })
    engine.subscribe({ event: 'FINISH' }, (e) => { events.push(e) })

    const wf = createWorkflow({
      name: 'events-test',
      steps: [
        step({ name: 'only-step', handler: async () => ({ done: true }) }),
      ],
    })

    engine.registerWorkflow(wf)
    await engine.run('events-test', { input: {} })

    expect(events).toHaveLength(2)
    expect(events[0].type).toBe('STEP_SUCCESS')
    expect(events[0].stepId).toBe('only-step')
    expect(events[1].type).toBe('FINISH')
    expect(events[1].status).toBe('DONE')
  })

  // WE-05 — Idempotency: same transactionId returns cached result
  it('returns cached result for same transactionId', async () => {
    const wf = createWorkflow({
      name: 'idem-test',
      steps: [
        step({
          name: 's1',
          handler: async ({ input }) => ({ val: input.x }),
        }),
      ],
    })

    engine.registerWorkflow(wf)

    const r1 = await engine.run('idem-test', { input: { x: 1 }, transactionId: 'tx-idem' })
    const r2 = await engine.run('idem-test', { input: { x: 999 }, transactionId: 'tx-idem' })

    // Second call returns cached result from first call
    expect(r1).toEqual(r2)
    expect(r2.output).toEqual({ val: 1 })
  })

  // WE-06 — Checkpoint recovery: completed steps not re-executed
  it('skips steps with completed checkpoints', async () => {
    let stepACalled = false

    const wf = createWorkflow({
      name: 'checkpoint-test',
      steps: [
        step({
          name: 'step-a',
          handler: async () => {
            stepACalled = true
            return { fromA: 'fresh' }
          },
        }),
        step({
          name: 'step-b',
          handler: async ({ previousOutput }) => {
            return { combined: (previousOutput['step-a'] as Record<string, unknown>).fromA }
          },
        }),
      ],
    })

    // Pre-populate checkpoint: step-a already done
    await storage.save('tx-resume', 'step-a', { status: 'DONE', result: { fromA: 'cached' } })

    engine.registerWorkflow(wf)
    const result = await engine.run('checkpoint-test', {
      input: {},
      transactionId: 'tx-resume',
    })

    expect(stepACalled).toBe(false) // Step A was NOT re-executed
    expect(result.status).toBe('done')
    expect(result.output).toEqual({ combined: 'cached' })
  })

  // WE-07 — Checkpoints saved during execution
  it('saves checkpoints as steps complete', async () => {
    const wf = createWorkflow({
      name: 'save-cp',
      steps: [
        step({ name: 'a', handler: async () => ({ v: 1 }) }),
        step({ name: 'b', handler: async () => ({ v: 2 }) }),
      ],
    })

    engine.registerWorkflow(wf)
    await engine.run('save-cp', { input: {}, transactionId: 'tx-save' })

    const checkpoints = await storage.list('tx-save')
    expect(checkpoints).toHaveLength(2)
    expect(checkpoints.map(c => c.stepId)).toEqual(['a', 'b'])
  })

  // WE-08 — Unregistered workflow returns fallback result
  it('returns fallback result for unregistered workflow', async () => {
    const result = await engine.run('unknown-wf', { input: { data: 'test' } })
    expect(result.status).toBe('done')
    expect(result.output).toEqual({ data: 'test' })
  })

  // WE-09 — Compensation failure events emitted
  it('emits COMPENSATE_BEGIN and COMPENSATE_END events', async () => {
    const events: WorkflowLifecycleEvent[] = []

    engine.subscribe({ event: 'COMPENSATE_BEGIN' }, (e) => { events.push(e) })
    engine.subscribe({ event: 'COMPENSATE_END' }, (e) => { events.push(e) })

    const wf = createWorkflow({
      name: 'comp-events',
      steps: [
        step({
          name: 'a',
          handler: async () => ({}),
          compensation: async () => {},
        }),
        step({
          name: 'b',
          handler: async () => { throw new Error('fail') },
        }),
      ],
    })

    engine.registerWorkflow(wf)
    await engine.run('comp-events', { input: {}, throwOnError: false })

    const beginEvents = events.filter(e => e.type === 'COMPENSATE_BEGIN')
    const endEvents = events.filter(e => e.type === 'COMPENSATE_END')
    expect(beginEvents).toHaveLength(1)
    expect(beginEvents[0].stepId).toBe('a')
    expect(endEvents).toHaveLength(1)
  })

  // WE-10 — Steps without compensation are skipped during rollback
  it('skips steps without compensation handler', async () => {
    const compensated: string[] = []

    const wf = createWorkflow({
      name: 'skip-comp',
      steps: [
        step({
          name: 'a',
          handler: async () => ({}),
          // No compensation
        }),
        step({
          name: 'b',
          handler: async () => ({}),
          compensation: async () => { compensated.push('b') },
        }),
        step({
          name: 'c',
          handler: async () => { throw new Error('fail') },
        }),
      ],
    })

    engine.registerWorkflow(wf)
    await engine.run('skip-comp', { input: {}, throwOnError: false })

    expect(compensated).toEqual(['b'])
  })
})
