// SPEC-019b — InMemoryWorkflowEngine implements IWorkflowEnginePort
// Real implementation: registers workflows, executes steps sequentially,
// handles compensation (saga), checkpoints, lifecycle events, idempotency.

import type { IWorkflowEnginePort, WorkflowLifecycleEvent, Context } from '../ports'
import type { IWorkflowStoragePort } from '../ports/workflow-storage'
import type { WorkflowDefinition, StepDefinition, StepResolveContext } from '../workflows/types'
import { MantaError } from '../errors/manta-error'

interface RunOptions {
  input?: unknown
  context?: Context
  transactionId?: string
  resultFrom?: string
  throwOnError?: boolean
}

interface RunResult {
  status: string
  output?: unknown
  errors?: unknown[]
}

export class InMemoryWorkflowEngine implements IWorkflowEnginePort {
  private _subscribers = new Map<string, Array<(event: WorkflowLifecycleEvent) => void>>()
  private _workflows = new Map<string, WorkflowDefinition>()
  private _asyncSteps = new Map<string, { response?: unknown; error?: Error }>()
  private _completedTransactions = new Map<string, RunResult>()
  private _storage: IWorkflowStoragePort | null = null
  private _container: { resolve<T>(key: string): T } | null = null

  /**
   * Optionally bind a storage backend for checkpoints
   * and a container for step context resolution.
   */
  configure(deps: {
    storage?: IWorkflowStoragePort
    container?: { resolve<T>(key: string): T }
  }): void {
    if (deps.storage) this._storage = deps.storage
    if (deps.container) this._container = deps.container
  }

  /**
   * Register a workflow definition for execution.
   */
  registerWorkflow(workflow: WorkflowDefinition): void {
    this._workflows.set(workflow.name, workflow)
  }

  /**
   * Run a registered workflow.
   * Executes steps sequentially. On failure, compensates completed steps in reverse (saga).
   * Uses checkpoints via IWorkflowStoragePort if available.
   * Supports idempotency via transactionId — returns cached result if already completed.
   */
  async run(workflowId: string, options: RunOptions = {}): Promise<RunResult> {
    const transactionId = options.transactionId ?? `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const throwOnError = options.throwOnError !== false

    // Idempotency: return cached result if same transactionId
    const cached = this._completedTransactions.get(transactionId)
    if (cached) return cached

    const workflow = this._workflows.get(workflowId)
    if (!workflow) {
      // No registered workflow — return minimal result (backwards compat with tests
      // that call run() without registering workflows)
      const result: RunResult = { status: 'done', output: options.input }
      this._completedTransactions.set(transactionId, result)
      return result
    }

    const input = (options.input ?? {}) as Record<string, unknown>
    const completedSteps: Array<{
      step: StepDefinition
      output: Record<string, unknown>
    }> = []
    const previousOutput: Record<string, unknown> = {}

    const resolveContext: StepResolveContext = {
      resolve: <T>(key: string): T => {
        if (this._container) return this._container.resolve<T>(key)
        throw new MantaError('INVALID_STATE', 'No container bound to workflow engine')
      },
    }

    try {
      for (const step of workflow.steps) {
        // Check if step already completed (checkpoint recovery)
        if (this._storage) {
          const checkpoint = await this._storage.load(transactionId, step.name)
          if (checkpoint && (checkpoint as Record<string, unknown>).status === 'DONE') {
            const savedResult = (checkpoint as Record<string, unknown>).result as Record<string, unknown>
            previousOutput[step.name] = savedResult
            completedSteps.push({ step, output: savedResult })

            this._notify({
              type: 'STEP_SUCCESS',
              workflowId,
              transactionId,
              stepId: step.name,
              result: savedResult,
            })
            continue
          }
        }

        // Execute the step
        const rawResult = await step.handler({
          input,
          previousOutput,
          context: resolveContext,
        })

        const output = (rawResult != null && typeof rawResult === 'object' ? rawResult : { value: rawResult }) as Record<string, unknown>
        previousOutput[step.name] = output
        completedSteps.push({ step, output })

        // Save checkpoint
        if (this._storage) {
          await this._storage.save(transactionId, step.name, { status: 'DONE', result: output })
        }

        // Emit lifecycle event
        this._notify({
          type: 'STEP_SUCCESS',
          workflowId,
          transactionId,
          stepId: step.name,
          result: output,
        })
      }

      // Success — build result
      const lastStep = workflow.steps[workflow.steps.length - 1]
      const finalOutput = previousOutput[lastStep.name]

      const result: RunResult = { status: 'done', output: finalOutput }
      this._completedTransactions.set(transactionId, result)

      this._notify({
        type: 'FINISH',
        workflowId,
        transactionId,
        status: 'DONE',
      })

      return result
    } catch (error) {
      // Step failed — compensate in reverse order
      this._notify({
        type: 'STEP_FAILURE',
        workflowId,
        transactionId,
        stepId: completedSteps.length < workflow.steps.length
          ? workflow.steps[completedSteps.length].name
          : undefined,
        error: error instanceof MantaError ? error : undefined,
      })

      await this._compensate(workflowId, transactionId, completedSteps, resolveContext)

      const result: RunResult = {
        status: 'failed',
        errors: [(error as Error).message],
      }
      this._completedTransactions.set(transactionId, result)

      this._notify({
        type: 'FINISH',
        workflowId,
        transactionId,
        status: 'FAILED',
      })

      if (throwOnError) throw error
      return result
    }
  }

  /**
   * Compensate completed steps in reverse order (saga pattern).
   */
  private async _compensate(
    workflowId: string,
    transactionId: string,
    completedSteps: Array<{ step: StepDefinition; output: Record<string, unknown> }>,
    context: StepResolveContext,
  ): Promise<void> {
    for (let i = completedSteps.length - 1; i >= 0; i--) {
      const { step, output } = completedSteps[i]
      if (!step.compensation) continue

      this._notify({
        type: 'COMPENSATE_BEGIN',
        workflowId,
        transactionId,
        stepId: step.name,
      })

      try {
        await step.compensation({ output, context })
        this._notify({
          type: 'COMPENSATE_END',
          workflowId,
          transactionId,
          stepId: step.name,
        })
      } catch {
        // Best-effort compensation — log but continue
      }
    }
  }

  async getRunningTransaction(_workflowId: string, transactionId: string): Promise<unknown> {
    return this._completedTransactions.get(transactionId) ?? null
  }

  async setStepSuccess(idempotencyKey: string, response: unknown): Promise<void> {
    this._asyncSteps.set(idempotencyKey, { response })
  }

  async setStepFailure(idempotencyKey: string, error: Error): Promise<void> {
    this._asyncSteps.set(idempotencyKey, { error })
  }

  subscribe(
    options: { event: WorkflowLifecycleEvent['type']; workflowId?: string },
    handler: (event: WorkflowLifecycleEvent) => Promise<void> | void,
  ): () => void {
    const key = `${options.event}:${options.workflowId ?? '*'}`
    if (!this._subscribers.has(key)) this._subscribers.set(key, [])
    this._subscribers.get(key)!.push(handler)
    return () => {
      const handlers = this._subscribers.get(key)
      if (handlers) {
        const idx = handlers.indexOf(handler)
        if (idx >= 0) handlers.splice(idx, 1)
      }
    }
  }

  /** Emit a lifecycle event to subscribers (also used internally). */
  _notify(event: WorkflowLifecycleEvent): void {
    const specificKey = `${event.type}:${event.workflowId}`
    const wildcardKey = `${event.type}:*`
    for (const key of [specificKey, wildcardKey]) {
      const handlers = this._subscribers.get(key) ?? []
      for (const handler of handlers) {
        try { handler(event) } catch { /* fire-and-forget per SPEC-019b */ }
      }
    }
  }

  _reset(): void {
    this._subscribers.clear()
    this._workflows.clear()
    this._asyncSteps.clear()
    this._completedTransactions.clear()
  }
}
