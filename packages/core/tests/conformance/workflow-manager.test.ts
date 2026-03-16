import { describe, it, expect, beforeEach } from 'vitest'
import {
  createTestContainer,
  InMemoryContainer,
} from '@manta/test-utils'
import { WorkflowManager, createWorkflow, step } from '@manta/core'

describe('WorkflowManager', () => {
  let container: InMemoryContainer
  let manager: WorkflowManager

  beforeEach(() => {
    container = createTestContainer()
    manager = new WorkflowManager(container)
    container.register('workflowManager', manager)
  })

  // WM-01 — Sequential step execution
  it('executes steps sequentially and returns last step output', async () => {
    const workflow = createWorkflow({
      name: 'test-seq',
      steps: [
        step({
          name: 'step-a',
          handler: async ({ input }) => ({ value: (input.x as number) + 1 }),
        }),
        step({
          name: 'step-b',
          handler: async ({ previousOutput }) => {
            const a = previousOutput['step-a'] as { value: number }
            return { value: a.value * 2 }
          },
        }),
      ],
    })

    manager.register(workflow)
    const result = await manager.run('test-seq', { input: { x: 5 } })
    expect(result).toEqual({ value: 12 })
  })

  // WM-02 — Step receives input and previousOutput
  it('passes input and previousOutput to each step', async () => {
    const received: Array<{ input: unknown; keys: string[] }> = []

    const workflow = createWorkflow({
      name: 'test-ctx',
      steps: [
        step({
          name: 'first',
          handler: async ({ input, previousOutput }) => {
            received.push({ input, keys: Object.keys(previousOutput) })
            return { fromFirst: true }
          },
        }),
        step({
          name: 'second',
          handler: async ({ input, previousOutput }) => {
            received.push({ input, keys: Object.keys(previousOutput) })
            return { fromSecond: true }
          },
        }),
      ],
    })

    manager.register(workflow)
    await manager.run('test-ctx', { input: { foo: 'bar' } })

    expect(received[0].keys).toEqual([])
    expect(received[1].keys).toEqual(['first'])
    expect((received[0].input as Record<string, unknown>).foo).toBe('bar')
  })

  // WM-03 — Compensation on failure (saga rollback)
  it('compensates completed steps in reverse on failure', async () => {
    const compensated: string[] = []

    const workflow = createWorkflow({
      name: 'test-comp',
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
          handler: async () => { throw new Error('step-c failed') },
        }),
      ],
    })

    manager.register(workflow)
    await expect(manager.run('test-comp')).rejects.toThrow('step-c failed')
    expect(compensated).toEqual(['b', 'a'])
  })

  // WM-04 — Steps without compensation are skipped during rollback
  it('skips steps without compensation handler', async () => {
    const compensated: string[] = []

    const workflow = createWorkflow({
      name: 'test-skip-comp',
      steps: [
        step({
          name: 'step-a',
          handler: async () => ({}),
          // No compensation
        }),
        step({
          name: 'step-b',
          handler: async () => ({}),
          compensation: async () => { compensated.push('b') },
        }),
        step({
          name: 'step-c',
          handler: async () => { throw new Error('fail') },
        }),
      ],
    })

    manager.register(workflow)
    await expect(manager.run('test-skip-comp')).rejects.toThrow('fail')
    expect(compensated).toEqual(['b'])
  })

  // WM-05 — Compensation receives step output
  it('passes step output to compensation handler', async () => {
    let compensationOutput: unknown = null

    const workflow = createWorkflow({
      name: 'test-comp-output',
      steps: [
        step({
          name: 'create',
          handler: async () => ({ productId: 'prod_123' }),
          compensation: async ({ output }) => { compensationOutput = output },
        }),
        step({
          name: 'fail',
          handler: async () => { throw new Error('boom') },
        }),
      ],
    })

    manager.register(workflow)
    await expect(manager.run('test-comp-output')).rejects.toThrow('boom')
    expect(compensationOutput).toEqual({ productId: 'prod_123' })
  })

  // WM-06 — Sub-workflow via workflowManager.run
  it('supports sub-workflows via context.resolve', async () => {
    const subWorkflow = createWorkflow({
      name: 'sub-wf',
      steps: [
        step({
          name: 'sub-step',
          handler: async ({ input }) => ({ doubled: (input.val as number) * 2 }),
        }),
      ],
    })

    const parentWorkflow = createWorkflow({
      name: 'parent-wf',
      steps: [
        step({
          name: 'call-sub',
          handler: async ({ input, context }) => {
            const wm = context.resolve<WorkflowManager>('workflowManager')
            return wm.run('sub-wf', { input: { val: input.val } })
          },
        }),
      ],
    })

    manager.register(subWorkflow)
    manager.register(parentWorkflow)

    const result = await manager.run('parent-wf', { input: { val: 10 } })
    expect(result).toEqual({ doubled: 20 })
  })

  // WM-07 — Unknown workflow throws
  it('throws on unknown workflow', async () => {
    await expect(manager.run('nonexistent')).rejects.toThrow('Workflow "nonexistent" not registered')
  })

  // WM-08 — Compensation failure is best-effort (does not prevent other compensations)
  it('continues compensation even if one fails', async () => {
    const compensated: string[] = []

    const workflow = createWorkflow({
      name: 'test-comp-fail',
      steps: [
        step({
          name: 'a',
          handler: async () => ({}),
          compensation: async () => { compensated.push('a') },
        }),
        step({
          name: 'b',
          handler: async () => ({}),
          compensation: async () => { throw new Error('comp-b failed') },
        }),
        step({
          name: 'c',
          handler: async () => ({}),
          compensation: async () => { compensated.push('c') },
        }),
        step({
          name: 'd',
          handler: async () => { throw new Error('d failed') },
        }),
      ],
    })

    manager.register(workflow)
    await expect(manager.run('test-comp-fail')).rejects.toThrow('d failed')
    // c and a should be compensated, b's compensation fails but doesn't block a
    expect(compensated).toContain('c')
    expect(compensated).toContain('a')
  })

  // WM-09 — Context resolve works inside steps
  it('allows resolving services from container in steps', async () => {
    container.register('myService', { greet: () => 'hello' })

    const workflow = createWorkflow({
      name: 'test-resolve',
      steps: [
        step({
          name: 'use-service',
          handler: async ({ context }) => {
            const svc = context.resolve<{ greet: () => string }>('myService')
            return { greeting: svc.greet() }
          },
        }),
      ],
    })

    manager.register(workflow)
    const result = await manager.run('test-resolve')
    expect(result).toEqual({ greeting: 'hello' })
  })
})
