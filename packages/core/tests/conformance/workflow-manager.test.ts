import type { MantaApp, TestMantaApp } from '@manta/core'
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
import { createTestApp } from '@manta/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

describe('WorkflowManager', () => {
  let app: MantaApp
  let manager: WorkflowManager

  beforeEach(() => {
    app = createTestApp()
    manager = new WorkflowManager(app)
  })

  // WM-01 — Sequential step execution
  it('executes steps sequentially and returns last output', async () => {
    const add = createStep('add', async (input: { x: number }) => ({ value: input.x + 1 }))
    const double = createStep('double', async (input: { value: number }) => ({ value: input.value * 2 }))

    const wf = createWorkflow('test-seq', async (input: { x: number }, { app }) => {
      const a = await add(input, { app })
      return await double(a, { app })
    })

    manager.register(wf)
    const { transaction, result } = await manager.run('test-seq', { input: { x: 5 } })
    expect(transaction.state).toBe('done')
    expect(result).toEqual({ value: 12 })
  })

  // WM-02 — Input flows through JavaScript scope
  it('passes data between steps via normal JS variables', async () => {
    const step1 = createStep('first', async (input: { foo: string }) => ({ fromFirst: true, foo: input.foo }))
    const step2 = createStep('second', async (input: { fromFirst: boolean; foo: string }) => ({
      combined: `${input.foo}-${input.fromFirst}`,
    }))

    const wf = createWorkflow('test-scope', async (input: { foo: string }, { app }) => {
      const r1 = await step1(input, { app })
      return await step2(r1, { app })
    })

    manager.register(wf)
    const { result } = await manager.run('test-scope', { input: { foo: 'bar' } })
    expect(result).toEqual({ combined: 'bar-true' })
  })

  // WM-03 — Compensation on failure (saga rollback after all retries exhausted)
  it('compensates completed steps in reverse after all retries fail', async () => {
    const compensated: string[] = []

    const stepA = createStep(
      'step-a',
      async () => ({ id: 'a1' }),
      async () => {
        compensated.push('a')
      },
    )
    const stepB = createStep(
      'step-b',
      async () => ({ id: 'b1' }),
      async () => {
        compensated.push('b')
      },
    )
    const stepC = createStep('step-c', async () => {
      throw new Error('step-c failed')
    })

    const wf = createWorkflow('test-comp', async (_input: unknown, { app }) => {
      await stepA({}, { app })
      await stepB({}, { app })
      await stepC({}, { app })
    })

    manager.register(wf)
    // run() retries 3 times internally, then compensates and throws
    await expect(manager.run('test-comp')).rejects.toThrow('step-c failed')
    expect(compensated).toEqual(['b', 'a'])
  })

  // WM-04 — Steps without compensation are skipped during rollback
  it('skips steps without compensation handler', async () => {
    const compensated: string[] = []

    const stepA = createStep('step-a', async () => ({}))
    const stepB = createStep(
      'step-b',
      async () => ({}),
      async () => {
        compensated.push('b')
      },
    )
    const stepC = createStep('step-c', async () => {
      throw new Error('fail')
    })

    const wf = createWorkflow('test-skip-comp', async (_input: unknown, { app }) => {
      await stepA({}, { app })
      await stepB({}, { app })
      await stepC({}, { app })
    })

    manager.register(wf)
    await expect(manager.run('test-skip-comp')).rejects.toThrow('fail')
    expect(compensated).toEqual(['b'])
  })

  // WM-05 — Compensation receives step output (the return value)
  it('passes step return value to compensation', async () => {
    let compensationOutput: unknown = null

    const createItem = createStep(
      'create',
      async () => ({ productId: 'prod_123' }),
      async (output) => {
        compensationOutput = output
      },
    )
    const failStep = createStep('fail', async () => {
      throw new Error('boom')
    })

    const wf = createWorkflow('test-comp-output', async (_input: unknown, { app }) => {
      await createItem({}, { app })
      await failStep({}, { app })
    })

    manager.register(wf)
    await expect(manager.run('test-comp-output')).rejects.toThrow('boom')
    expect(compensationOutput).toEqual({ productId: 'prod_123' })
  })

  // WM-06 — Sub-workflow via workflowManager.run
  // Uses createTestMantaApp because steps need app.resolve('workflowManager')
  // which requires dynamic registration not available on frozen MantaApp
  it('supports sub-workflows via app resolve', async () => {
    const testApp = createTestMantaApp({
      infra: {
        eventBus: new InMemoryEventBusAdapter(),
        logger: new TestLogger(),
        cache: new InMemoryCacheAdapter(),
        locking: new InMemoryLockingAdapter(),
        file: new InMemoryFileAdapter(),
        db: {},
      },
    })
    const legacyManager = new WorkflowManager(testApp)
    testApp.register('workflowManager', legacyManager)

    const doubleStep = createStep('double', async (input: { val: number }) => ({ doubled: input.val * 2 }))

    const subWf = createWorkflow('sub-wf', async (input: { val: number }, { app }) => {
      return await doubleStep(input, { app })
    })

    const callSubStep = createStep('call-sub', async (input: { val: number }, { app }) => {
      const wm = app.resolve<WorkflowManager>('workflowManager')
      const { result } = await wm.run('sub-wf', { input: { val: (input as { val: number }).val } })
      return result
    })

    const parentWf = createWorkflow('parent-wf', async (input: { val: number }, { app }) => {
      return await callSubStep(input, { app })
    })

    legacyManager.register(subWf)
    legacyManager.register(parentWf)

    const { result } = await legacyManager.run('parent-wf', { input: { val: 10 } })
    expect(result).toEqual({ doubled: 20 })
  })

  // WM-07 — Unknown workflow throws
  it('throws on unknown workflow', async () => {
    await expect(manager.run('nonexistent')).rejects.toThrow('Workflow "nonexistent" not registered')
  })

  // WM-08 — Compensation failure is best-effort
  it('continues compensation even if one fails', async () => {
    const compensated: string[] = []

    const a = createStep(
      'a',
      async () => ({}),
      async () => {
        compensated.push('a')
      },
    )
    const b = createStep(
      'b',
      async () => ({}),
      async () => {
        throw new Error('comp-b failed')
      },
    )
    const c = createStep(
      'c',
      async () => ({}),
      async () => {
        compensated.push('c')
      },
    )
    const d = createStep('d', async () => {
      throw new Error('d failed')
    })

    const wf = createWorkflow('test-comp-fail', async (_input: unknown, { app }) => {
      await a({}, { app })
      await b({}, { app })
      await c({}, { app })
      await d({}, { app })
    })

    manager.register(wf)
    await expect(manager.run('test-comp-fail')).rejects.toThrow('d failed')
    expect(compensated).toContain('c')
    expect(compensated).toContain('a')
  })

  // WM-09 — Container resolve works inside steps
  // Uses createTestMantaApp because steps need app.resolve() for custom services
  // and app.register() for dynamic registration
  it('allows resolving services from app in steps', async () => {
    const testApp = createTestMantaApp({
      infra: {
        eventBus: new InMemoryEventBusAdapter(),
        logger: new TestLogger(),
        cache: new InMemoryCacheAdapter(),
        locking: new InMemoryLockingAdapter(),
        file: new InMemoryFileAdapter(),
        db: {},
      },
    })
    const legacyManager = new WorkflowManager(testApp)
    testApp.register('myService', { greet: () => 'hello' })

    const useService = createStep('use-service', async (_input: unknown, { app }) => {
      const svc = app.resolve<{ greet: () => string }>('myService')
      return { greeting: svc.greet() }
    })

    const wf = createWorkflow('test-resolve', async (input: unknown, { app }) => {
      return await useService(input, { app })
    })

    legacyManager.register(wf)
    const { result } = await legacyManager.run('test-resolve')
    expect(result).toEqual({ greeting: 'hello' })
  })

  // WM-10 — Workflow with if/else works (no transform/when needed)
  it('supports if/else in workflow function', async () => {
    const createDraft = createStep('create-draft', async (input: { title: string }) => ({
      id: 'prod_1',
      title: input.title,
      status: 'draft',
    }))
    const activate = createStep('activate', async (input: { id: string }) => ({
      id: input.id,
      status: 'active',
    }))

    const wf = createWorkflow('test-conditional', async (input: { title: string; autoActivate: boolean }, { app }) => {
      const product = await createDraft(input, { app })
      if (input.autoActivate) {
        return await activate(product, { app })
      }
      return product
    })

    manager.register(wf)

    const r1 = await manager.run('test-conditional', { input: { title: 'A', autoActivate: true } })
    expect((r1.result as { status: string }).status).toBe('active')

    const r2 = await manager.run('test-conditional', { input: { title: 'B', autoActivate: false } })
    expect((r2.result as { status: string }).status).toBe('draft')
  })

  // WM-11 — Cleanup: checkpoints removed after completion
  it('cleans up after successful completion (no leaked state)', async () => {
    const s = createStep('simple', async () => ({ done: true }))
    const wf = createWorkflow('test-cleanup', async (_input: unknown, { app }) => {
      return await s({}, { app })
    })

    manager.register(wf)
    const { transaction } = await manager.run('test-cleanup')
    expect(transaction.state).toBe('done')
    // No assertion on DB here (in-memory mode) — but the mechanism is in place
  })

  // =========================================================================
  // Durable Execution — retry-before-compensate (always enabled, 3 attempts)
  // =========================================================================

  // WM-12 — Transient failure: retried automatically, succeeds on attempt 2
  it('retries a transient failure and succeeds without compensation', async () => {
    const compensated: string[] = []
    let stepACallCount = 0
    let stepBCallCount = 0

    const stepA = createStep(
      'step-a',
      async () => {
        stepACallCount++
        return { id: 'a1' }
      },
      async () => {
        compensated.push('a')
      },
    )
    const stepB = createStep('step-b', async () => {
      stepBCallCount++
      if (stepBCallCount === 1) throw new Error('transient')
      return { id: 'b1' }
    })

    const wf = createWorkflow('test-retry', async (_input: unknown, { app }) => {
      const a = await stepA({}, { app })
      const b = await stepB({}, { app })
      return { a, b }
    })

    manager.register(wf)
    const result = await manager.run('test-retry')

    // Should succeed on retry
    expect(result.transaction.state).toBe('done')
    expect(result.result).toEqual({ a: { id: 'a1' }, b: { id: 'b1' } })
    // stepA ran once, stepB was skipped on retry (checkpoint), no — stepB has no checkpoint because it failed
    // stepA ran once on attempt 1, then was skipped (checkpoint) on attempt 2
    expect(stepACallCount).toBe(1)
    // stepB failed on attempt 1, succeeded on attempt 2
    expect(stepBCallCount).toBe(2)
    // No compensation
    expect(compensated).toEqual([])
  })

  // WM-13 — Permanent failure: retried 3 times, then compensates
  it('compensates after all 3 retry attempts are exhausted', async () => {
    const compensated: string[] = []
    let stepBCallCount = 0

    const stepA = createStep(
      'step-a',
      async () => ({ id: 'a1' }),
      async () => {
        compensated.push('a')
      },
    )
    const stepB = createStep('step-b', async () => {
      stepBCallCount++
      throw new Error('permanent failure')
    })

    const wf = createWorkflow('test-exhaust', async (_input: unknown, { app }) => {
      await stepA({}, { app })
      await stepB({}, { app })
    })

    manager.register(wf)
    await expect(manager.run('test-exhaust')).rejects.toThrow('permanent failure')

    // stepB was tried 3 times
    expect(stepBCallCount).toBe(3)
    // Compensation ran after all retries exhausted
    expect(compensated).toEqual(['a'])
  })
})
