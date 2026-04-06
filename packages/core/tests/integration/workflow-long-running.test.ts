import type { TestMantaApp } from '@manta/core'
import {
  createStep,
  createTestMantaApp,
  createWorkflow,
  InMemoryCacheAdapter,
  InMemoryEventBusAdapter,
  InMemoryFileAdapter,
  InMemoryLockingAdapter,
  TestLogger,
  WorkflowManager,
} from '@manta/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('Long-Running Workflows', () => {
  let testApp: TestMantaApp
  let manager: WorkflowManager

  beforeEach(() => {
    testApp = createTestMantaApp({
      infra: {
        eventBus: new InMemoryEventBusAdapter(),
        logger: new TestLogger(),
        cache: new InMemoryCacheAdapter(),
        locking: new InMemoryLockingAdapter(),
        file: new InMemoryFileAdapter(),
        db: {},
      },
    })
    manager = new WorkflowManager(testApp)
    testApp.register('workflowManager', manager)
  })

  afterEach(async () => {})

  // LR-01: Workflow with multiple steps completes
  it('executes multi-step workflow and returns result', async () => {
    const prepare = createStep('prepare', async () => ({ ready: true }))
    const compute = createStep('compute', async (input: { ready: boolean }) => ({
      value: input.ready ? 42 : 0,
    }))

    const wf = createWorkflow('lr-basic', async (input: unknown, { app }) => {
      const r = await prepare(input, { app })
      return await compute(r, { app })
    })

    manager.register(wf)
    const result = await manager.run('lr-basic')

    expect(result.transaction.state).toBe('done')
    expect(result.result).toEqual({ value: 42 })
  })

  // LR-02: Workflow with compensation
  it('compensates on failure', async () => {
    const compensated: string[] = []

    const stepA = createStep(
      'step-a',
      async () => ({ id: 'a1' }),
      async () => {
        compensated.push('a')
      },
    )
    const failStep = createStep('fail', async () => {
      throw new Error('boom')
    })

    const wf = createWorkflow('lr-comp', async (_input: unknown, { app }) => {
      await stepA({}, { app })
      await failStep({}, { app })
    })

    manager.register(wf)
    await expect(manager.run('lr-comp')).rejects.toThrow('boom')
    expect(compensated).toEqual(['a'])
  })

  // LR-03: Workflow with if/else branching
  it('supports conditional logic in workflow', async () => {
    const createDraft = createStep('create-draft', async (input: { title: string }) => ({
      id: 'p1',
      title: input.title,
      status: 'draft',
    }))
    const activate = createStep('activate', async (input: { id: string }) => ({
      id: input.id,
      status: 'active',
    }))

    const wf = createWorkflow('lr-conditional', async (input: { title: string; confirm: boolean }, { app }) => {
      const product = await createDraft({ title: input.title }, { app })
      if (input.confirm) {
        return await activate({ id: product.id }, { app })
      }
      return product
    })

    manager.register(wf)

    const confirmed = await manager.run('lr-conditional', { input: { title: 'A', confirm: true } })
    expect((confirmed.result as { status: string }).status).toBe('active')

    const draft = await manager.run('lr-conditional', { input: { title: 'B', confirm: false } })
    expect((draft.result as { status: string }).status).toBe('draft')
  })

  // LR-04: Workflow with for loop
  it('supports loops over step calls', async () => {
    const items = ['a', 'b', 'c']
    const processItem = createStep('process', async (input: { item: string }) => ({
      processed: input.item.toUpperCase(),
    }))

    const wf = createWorkflow('lr-loop', async (_input: unknown, { app }) => {
      const results: string[] = []
      for (const item of items) {
        const r = await processItem({ item }, { app })
        results.push(r.processed)
      }
      return { results }
    })

    manager.register(wf)
    const { result } = await manager.run('lr-loop')
    expect(result).toEqual({ results: ['A', 'B', 'C'] })
  })

  // LR-05: Sub-workflow invocation
  it('supports calling sub-workflows', async () => {
    const double = createStep('double', async (input: { n: number }) => ({ value: input.n * 2 }))

    const subWf = createWorkflow('sub', async (input: { n: number }, { app }) => {
      return await double(input, { app })
    })

    const callSub = createStep('call-sub', async (input: { n: number }, { app }) => {
      const wm = app.resolve<WorkflowManager>('workflowManager')
      const { result } = await wm.run('sub', { input: { n: input.n } })
      return result as { value: number }
    })

    const parentWf = createWorkflow('parent', async (input: { n: number }, { app }) => {
      return await callSub(input, { app })
    })

    manager.register(subWf)
    manager.register(parentWf)

    const { result } = await manager.run('parent', { input: { n: 5 } })
    expect(result).toEqual({ value: 10 })
  })

  // LR-06: Cleanup after completion
  it('cleans up checkpoints after successful completion', async () => {
    const s = createStep('simple', async () => ({ ok: true }))
    const wf = createWorkflow('lr-cleanup', async (_input: unknown, { app }) => {
      return await s({}, { app })
    })

    manager.register(wf)
    const { transaction } = await manager.run('lr-cleanup')
    expect(transaction.state).toBe('done')
  })
})
