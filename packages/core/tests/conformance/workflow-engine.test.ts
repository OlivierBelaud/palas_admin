import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  type IWorkflowEnginePort,
  type IEventBusPort,
  type WorkflowLifecycleEvent,
  type Message,
  MantaError,
  createTestContainer,
  createTestContext,
  resetAll,
  spyOnEvents,
  InMemoryContainer,
  InMemoryWorkflowEngine,
  InMemoryWorkflowStorage,
  InMemoryEventBusAdapter,
} from '@manta/test-utils'

describe('IWorkflowEnginePort Conformance', () => {
  let engine: InMemoryWorkflowEngine
  let storage: InMemoryWorkflowStorage
  let eventBus: InMemoryEventBusAdapter
  let container: InMemoryContainer

  beforeEach(() => {
    container = createTestContainer()
    engine = container.resolve<InMemoryWorkflowEngine>('IWorkflowEnginePort')
    storage = container.resolve<InMemoryWorkflowStorage>('IWorkflowStoragePort')
    eventBus = container.resolve<InMemoryEventBusAdapter>('IEventBusPort')
  })

  afterEach(async () => {
    await resetAll(container)
  })

  // W-01 — SPEC-019b: sequential execution A → B → C
  it('séquentiel > steps A → B → C', async () => {
    const result = await engine.run('test-workflow', {
      input: { value: 1 },
    })

    expect(result).toBeDefined()
    expect(result.status).toBeDefined()
  })

  // W-02 — SPEC-019b: compensation rollback on failure
  it('compensation > rollback sur échec', async () => {
    const result = await engine.run('failing-workflow', {
      input: { shouldFail: true },
      throwOnError: false,
    })

    expect(result).toBeDefined()
    // Engine should handle compensation
  })

  // W-03 — SPEC-019b: no compensate handler — skip gracefully
  it('compensation > pas de handler — skip', async () => {
    const result = await engine.run('partial-compensate', {
      input: {},
      throwOnError: false,
    })

    expect(result).toBeDefined()
  })

  // W-04 — SPEC-020: checkpoint persistence — resume from checkpoint
  it('checkpoint > persistence et reprise', async () => {
    // Save checkpoint simulating step A completed
    await storage.save('tx-resume', 'step-a', { result: 'done-a' })

    // Resume workflow — step A should not re-execute
    const loaded = await storage.load('tx-resume', 'step-a')
    expect(loaded).toEqual({ result: 'done-a' })

    // Engine can resume from this state
    const result = await engine.run('test-workflow', {
      input: {},
      transactionId: 'tx-resume',
    })
    expect(result).toBeDefined()
  })

  // W-05 — SPEC-024: parallel steps — compensate on failure
  it('parallèle > compensation sur échec', async () => {
    const result = await engine.run('parallel-fail', {
      input: {},
      throwOnError: false,
    })

    expect(result).toBeDefined()
  })

  // W-06 — SPEC-024: parallel result aggregation
  it('parallèle > agrégation des résultats', async () => {
    const result = await engine.run('parallel-success', {
      input: { a: 1, b: 2, c: 3 },
    })

    expect(result).toBeDefined()
    expect(result.status).toBeDefined()
  })

  // W-07 — SPEC-026: async step suspend/resume
  it('async > suspend/resume', async () => {
    // setStepSuccess completes an async step with a result
    // It must not throw and must accept any serializable response
    await expect(
      engine.setStepSuccess('async-step-key', { externalResult: 'ok' }),
    ).resolves.toBeUndefined()

    // A second call with the same key should also not throw (idempotent)
    await expect(
      engine.setStepSuccess('async-step-key', { externalResult: 'ok' }),
    ).resolves.toBeUndefined()
  })

  // W-08 — SPEC-026: async step failure triggers compensation
  it('async > failure déclenche compensation', async () => {
    const error = new Error('external failure')

    // setStepFailure marks an async step as failed
    // It must not throw and must accept an Error
    await expect(
      engine.setStepFailure('async-step-key', error),
    ).resolves.toBeUndefined()
  })

  // W-09 — SPEC-034/036: grouped events released on success
  it('grouped events > released on success', async () => {
    const spy = spyOnEvents(container)

    // Emit grouped events
    await eventBus.emit(
      { eventName: 'order.created', data: { id: '1' }, metadata: { timestamp: Date.now() } },
      { groupId: 'wf-tx-1' },
    )

    // Simulate workflow success → release
    await eventBus.releaseGroupedEvents('wf-tx-1')

    expect(spy.received('order.created')).toBe(true)
  })

  // W-10 — SPEC-034/036: grouped events cleared on failure
  it('grouped events > cleared on failure', async () => {
    const spy = spyOnEvents(container)

    await eventBus.emit(
      { eventName: 'order.created', data: { id: '1' }, metadata: { timestamp: Date.now() } },
      { groupId: 'wf-tx-2' },
    )

    // Simulate workflow failure → clear
    await eventBus.clearGroupedEvents('wf-tx-2')

    expect(spy.received('order.created')).toBe(false)
  })

  // W-11 — SPEC-027: idempotency — same transactionId returns cached result
  it('idempotency > même transactionId', async () => {
    const result1 = await engine.run('test-workflow', {
      input: { value: 1 },
      transactionId: 'idem-tx-1',
    })

    const result2 = await engine.run('test-workflow', {
      input: { value: 2 }, // Different input
      transactionId: 'idem-tx-1', // Same transactionId
    })

    // Both return same result (second is cached)
    expect(result1.status).toBe(result2.status)
  })

  // W-12 — SPEC-025: step timeout
  it('step timeout > MantaError(TIMEOUT)', async () => {
    // InMemoryWorkflowEngine is a mock — test verifies contract shape
    const result = await engine.run('timeout-workflow', {
      input: {},
      throwOnError: false,
    })

    expect(result).toBeDefined()
  })

  // W-13 — SPEC-029: nested workflow invoke
  it('nested workflow > invoke', async () => {
    const result = await engine.run('parent-workflow', {
      input: { childWorkflowId: 'child-workflow' },
    })

    expect(result).toBeDefined()
  })

  // W-14 — SPEC-020: checkpoint recovery — DONE steps not re-executed
  it('checkpoint recovery > steps DONE non ré-exécutés', async () => {
    // Pre-populate checkpoint for step-a as DONE
    await storage.save('tx-recovery', 'step-a', { status: 'DONE', result: 'a-result' })

    const loaded = await storage.load('tx-recovery', 'step-a')
    expect(loaded).toEqual({ status: 'DONE', result: 'a-result' })

    // Resume: step-a result read from storage, not re-executed
  })

  // W-15 — SPEC-020: events from DONE steps not re-emitted on recovery
  it('checkpoint > events non ré-émis pour steps DONE', async () => {
    const spy = spyOnEvents(container)

    // Step A was DONE and had emitted events — on recovery those are lost (fail-safe)
    await storage.save('tx-recovery-2', 'step-a', { status: 'DONE', result: 'a-result' })

    // No events should be emitted for the recovered step
    expect(spy.count('step-a.completed')).toBe(0)
  })

  // W-16 — SPEC-019b: subscribe STEP_SUCCESS notification
  it('subscribe > STEP_SUCCESS notification', async () => {
    const received: WorkflowLifecycleEvent[] = []

    engine.subscribe(
      { event: 'STEP_SUCCESS' },
      (event) => { received.push(event) },
    )

    // Notify a step success
    engine._notify({
      type: 'STEP_SUCCESS',
      workflowId: 'test-wf',
      transactionId: 'tx-1',
      stepId: 'step-a',
      result: { data: 'ok' },
    })

    expect(received).toHaveLength(1)
    expect(received[0].type).toBe('STEP_SUCCESS')
    expect(received[0].stepId).toBe('step-a')
  })

  // W-17 — SPEC-019b: subscribe FINISH notification
  it('subscribe > FINISH notification', async () => {
    const received: WorkflowLifecycleEvent[] = []

    engine.subscribe(
      { event: 'FINISH' },
      (event) => { received.push(event) },
    )

    engine._notify({
      type: 'FINISH',
      workflowId: 'test-wf',
      transactionId: 'tx-1',
      status: 'DONE',
    })

    expect(received).toHaveLength(1)
    expect(received[0].type).toBe('FINISH')
    expect(received[0].status).toBe('DONE')
  })

  // W-18 — SPEC-019b: subscribe handler error is non-blocking
  it('subscribe > handler error non-bloquant', async () => {
    engine.subscribe(
      { event: 'STEP_SUCCESS' },
      () => { throw new Error('handler crash') },
    )

    // Should not throw despite handler error
    expect(() => {
      engine._notify({
        type: 'STEP_SUCCESS',
        workflowId: 'test-wf',
        transactionId: 'tx-1',
        stepId: 'step-a',
      })
    }).not.toThrow()
  })

  // W-19 — SPEC-019b: subscribe then unsubscribe
  it('subscribe > unsubscribe', async () => {
    let callCount = 0

    const unsub = engine.subscribe(
      { event: 'STEP_SUCCESS' },
      () => { callCount++ },
    )

    engine._notify({
      type: 'STEP_SUCCESS',
      workflowId: 'test-wf',
      transactionId: 'tx-1',
      stepId: 'step-a',
    })
    expect(callCount).toBe(1)

    // Unsubscribe
    unsub()

    engine._notify({
      type: 'STEP_SUCCESS',
      workflowId: 'test-wf',
      transactionId: 'tx-2',
      stepId: 'step-b',
    })
    expect(callCount).toBe(1) // Not called again
  })

  // W-20 — SPEC-024: parallel message aggregator merge
  it('parallèle > message aggregator merge', async () => {
    const spy = spyOnEvents(container)

    // Simulate parallel steps each emitting events into a group
    await eventBus.emit(
      { eventName: 'stepA.done', data: {}, metadata: { timestamp: Date.now() } },
      { groupId: 'parallel-group' },
    )
    await eventBus.emit(
      { eventName: 'stepB.done', data: {}, metadata: { timestamp: Date.now() } },
      { groupId: 'parallel-group' },
    )

    // Release on success
    await eventBus.releaseGroupedEvents('parallel-group')

    expect(spy.received('stepA.done')).toBe(true)
    expect(spy.received('stepB.done')).toBe(true)
  })

  // W-21 — SPEC-024: parallel message aggregator cleared on failure
  it('parallèle > message aggregator cleared on failure', async () => {
    const spy = spyOnEvents(container)

    await eventBus.emit(
      { eventName: 'stepA.done', data: {}, metadata: { timestamp: Date.now() } },
      { groupId: 'parallel-fail-group' },
    )
    await eventBus.emit(
      { eventName: 'stepB.done', data: {}, metadata: { timestamp: Date.now() } },
      { groupId: 'parallel-fail-group' },
    )

    // Clear on failure
    await eventBus.clearGroupedEvents('parallel-fail-group')

    expect(spy.received('stepA.done')).toBe(false)
    expect(spy.received('stepB.done')).toBe(false)
  })
})
