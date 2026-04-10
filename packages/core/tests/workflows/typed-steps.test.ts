// ST-01→ST-08 — Typed step tests (step.create, step.update, step.delete, step.action, step.cascadeDelete)

import {
  createTestMantaApp,
  createWorkflow,
  InMemoryCacheAdapter,
  InMemoryEventBusAdapter,
  InMemoryFileAdapter,
  InMemoryLockingAdapter,
  InMemoryRepository,
  step,
  TestLogger,
  WorkflowManager,
} from '@manta/core'
import { beforeEach, describe, expect, it } from 'vitest'

// Mock service that tracks calls
function createMockService() {
  const repo = new InMemoryRepository('test')
  const calls: Array<{ method: string; args: unknown[] }> = []

  return {
    calls,
    repo,
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    async createProducts(data: any) {
      calls.push({ method: 'createProducts', args: [data] })
      const items = Array.isArray(data) ? data : [data]
      const created = await repo.create(items)
      return Array.isArray(data) ? created : (created as Record<string, unknown>[])[0]
    },
    async retrieveProduct(id: string) {
      calls.push({ method: 'retrieveProduct', args: [id] })
      const results = await repo.find({ where: { id } })
      return results[0]
    },
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    async updateProducts(data: any) {
      calls.push({ method: 'updateProducts', args: [data] })
      return repo.update(data)
    },
    async softDeleteProducts(ids: string[]) {
      calls.push({ method: 'softDeleteProducts', args: [ids] })
      return repo.softDelete(ids)
    },
    async restoreProducts(ids: string[]) {
      calls.push({ method: 'restoreProducts', args: [ids] })
      return repo.restore(ids)
    },
    async deleteProducts(ids: string[]) {
      calls.push({ method: 'deleteProducts', args: [ids] })
      return repo.delete(ids)
    },
  }
}

describe('Typed steps', () => {
  let mockService: ReturnType<typeof createMockService>
  // biome-ignore lint/suspicious/noExplicitAny: test
  let app: any
  let wfManager: WorkflowManager

  beforeEach(() => {
    mockService = createMockService()
    app = createTestMantaApp({
      infra: {
        eventBus: new InMemoryEventBusAdapter(),
        logger: new TestLogger(),
        cache: new InMemoryCacheAdapter(),
        locking: new InMemoryLockingAdapter(),
        file: new InMemoryFileAdapter(),
        db: null,
      },
    })
    app.register('product', mockService)
    app.modules.product = mockService

    wfManager = new WorkflowManager(app)
  })

  // ST-01 — step.create directly creates and returns entity
  it('ST-01: step.create creates entity and returns it', async () => {
    const ctx = { app }
    const result = await step.create('product', { title: 'Widget' }, ctx)

    expect(result.title).toBe('Widget')
    expect(result.id).toBeDefined()
    expect(mockService.calls.some((c) => c.method === 'createProducts')).toBe(true)
  })

  // ST-02 — step.update captures previous data
  it('ST-02: step.update updates entity', async () => {
    const created = (await mockService.createProducts({ title: 'Original', price: 100 })) as Record<string, unknown>
    const ctx = { app }

    const result = await step.update('product', created.id as string, { title: 'Updated' }, ctx)
    expect(result.title).toBe('Updated')
    expect(mockService.calls.some((c) => c.method === 'updateProducts')).toBe(true)
  })

  // ST-03 — step.delete does softDelete
  it('ST-03: step.delete does softDelete, not hard delete', async () => {
    const created = (await mockService.createProducts({ title: 'ToDelete' })) as Record<string, unknown>
    const ctx = { app }

    const result = await step.delete('product', created.id as string, ctx)
    expect(result.id).toBe(created.id as string)

    expect(mockService.calls.some((c) => c.method === 'softDeleteProducts')).toBe(true)
    expect(mockService.calls.some((c) => c.method === 'deleteProducts')).toBe(false)
  })

  // ST-04 — step.action refuses if compensate is absent
  it('ST-04: step.action refuses without compensate', () => {
    expect(() => {
      // biome-ignore lint/suspicious/noExplicitAny: test
      step.action('bad-step', { invoke: async () => 'ok' } as any)
    }).toThrow('requires a compensate function')
  })

  // ST-05 — step.action accepts invoke + compensate
  it('ST-05: step.action accepts invoke + compensate', async () => {
    let _compensated = false

    const chargeStep = step.action('charge-payment', {
      invoke: async (input: { amount: number }) => ({ chargeId: 'ch_123', amount: input.amount }),
      compensate: async () => {
        _compensated = true
      },
    })

    const ctx = { app }
    const result = await chargeStep({ amount: 500 }, ctx)
    expect(result.chargeId).toBe('ch_123')
  })

  // ST-06 — Workflow with step.create: compensation LIFO after error
  it('ST-06: workflow compensates LIFO after error', async () => {
    const workflow = createWorkflow('test-compensate', async (input: { title: string }, ctx) => {
      await step.create('product', { title: input.title }, ctx)
      // This will fail
      await step.action('failing-step', {
        invoke: async () => {
          throw new Error('Intentional failure')
        },
        compensate: async () => {},
      })({}, ctx)
    })

    wfManager.register(workflow)

    await expect(wfManager.run('test-compensate', { input: { title: 'Test' } })).rejects.toThrow('Intentional failure')

    // Product should have been deleted by compensation
    const remaining = await mockService.repo.find({})
    expect(remaining).toHaveLength(0)
  })

  // ST-07 — step.create in workflow is checkpointed
  it('ST-07: step.create is checkpointed in workflow', async () => {
    const checkpoints: Array<{ stepId: string; data: unknown }> = []

    const storage = {
      async save(_txId: string, stepId: string, data: unknown) {
        checkpoints.push({ stepId, data })
      },
      async list() {
        return []
      },
      async delete() {},
    }

    const localWfManager = new WorkflowManager(app, { storage })

    const workflow = createWorkflow('test-checkpoint', async (input: { title: string }, ctx) => {
      return step.create('product', { title: input.title }, ctx)
    })

    localWfManager.register(workflow)
    const result = await localWfManager.run('test-checkpoint', { input: { title: 'Checkpointed' } })

    expect(result.transaction.state).toBe('done')
    expect(checkpoints.length).toBeGreaterThan(0)
    expect(checkpoints[0].stepId).toBe('create-product')
  })

  // ST-08 — Removed: Legacy step() callable is no longer supported.
  // step is now a categorized proxy: step.service.*, step.command.*, step.action(), step.emit()
})
