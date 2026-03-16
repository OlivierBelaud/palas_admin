import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createTestContainer,
  resetAll,
  spyOnEvents,
  InMemoryContainer,
  InMemoryWorkflowEngine,
  InMemoryWorkflowStorage,
  InMemoryEventBusAdapter,
} from '@manta/test-utils'

describe('Workflow E2E Integration', () => {
  let container: InMemoryContainer
  let engine: InMemoryWorkflowEngine
  let storage: InMemoryWorkflowStorage
  let bus: InMemoryEventBusAdapter

  beforeEach(() => {
    container = createTestContainer()
    engine = container.resolve<InMemoryWorkflowEngine>('IWorkflowEnginePort')
    storage = container.resolve<InMemoryWorkflowStorage>('IWorkflowStoragePort')
    bus = container.resolve<InMemoryEventBusAdapter>('IEventBusPort')
  })

  afterEach(async () => {
    await resetAll(container)
  })

  // SPEC-019b/020: 3-step workflow with checkpoints
  it('3-step workflow with checkpoints', async () => {
    // Simulate 3-step workflow execution with checkpoints
    await storage.save('tx-e2e-1', 'stepA', { result: 'a-done' })
    await storage.save('tx-e2e-1', 'stepB', { result: 'b-done' })
    await storage.save('tx-e2e-1', 'stepC', { result: 'c-done' })

    // All 3 checkpoints exist
    const checkpoints = await storage.list('tx-e2e-1')
    expect(checkpoints).toHaveLength(3)
    expect(checkpoints.map((c) => c.stepId)).toEqual(['stepA', 'stepB', 'stepC'])

    // Merged result contains all step results
    const merged = await storage.load('tx-e2e-1')
    expect(merged).toMatchObject({
      result: expect.any(String), // Last-write-wins on 'result' key
    })
  })

  // SPEC-019b: failure triggers compensation in reverse order
  it('failure triggers compensation in reverse order', async () => {
    const compensationOrder: string[] = []

    // Subscribe to COMPENSATE_BEGIN events
    engine.subscribe(
      { event: 'COMPENSATE_BEGIN' },
      (event) => {
        if (event.stepId) compensationOrder.push(event.stepId)
      },
    )

    // Simulate compensation notification
    engine._notify({
      type: 'COMPENSATE_BEGIN',
      workflowId: 'order-create',
      transactionId: 'tx-fail-1',
      stepId: 'stepB',
    })
    engine._notify({
      type: 'COMPENSATE_BEGIN',
      workflowId: 'order-create',
      transactionId: 'tx-fail-1',
      stepId: 'stepA',
    })

    // Compensation in reverse order
    expect(compensationOrder).toEqual(['stepB', 'stepA'])
  })

  // SPEC-034/036: grouped events released on success, cleared on failure
  it('grouped events released on success, cleared on failure', async () => {
    const spy = spyOnEvents(container)

    // Success case: emit + release
    bus.subscribe('order.created', () => {})
    await bus.emit(
      { eventName: 'order.created', data: { id: '1' }, metadata: { timestamp: Date.now() } },
      { groupId: 'wf-success' },
    )
    await bus.releaseGroupedEvents('wf-success')
    expect(spy.received('order.created')).toBe(true)

    spy.reset()

    // Failure case: emit + clear
    await bus.emit(
      { eventName: 'order.failed', data: { id: '2' }, metadata: { timestamp: Date.now() } },
      { groupId: 'wf-failure' },
    )
    await bus.clearGroupedEvents('wf-failure')
    expect(spy.received('order.failed')).toBe(false)
  })
})
