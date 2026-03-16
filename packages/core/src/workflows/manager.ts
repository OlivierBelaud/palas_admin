// SPEC-019b — WorkflowManager: registers and executes workflows with compensation

import type { IContainer } from '../container'
import type { ILoggerPort } from '../ports/logger'
import type { WorkflowDefinition, WorkflowResult, StepResolveContext } from './types'

/**
 * WorkflowManager registers workflow definitions and executes them.
 * Supports sequential step execution with saga-style compensation on failure.
 * Sub-workflows are invoked by resolving 'workflowManager' inside a step.
 */
export class WorkflowManager {
  private _workflows = new Map<string, WorkflowDefinition>()
  private _container: IContainer
  private _logger: ILoggerPort | null = null

  constructor(container: IContainer) {
    this._container = container
    try {
      this._logger = container.resolve<ILoggerPort>('ILoggerPort')
    } catch {
      // Logger not available — run without logging
    }
  }

  /**
   * Register a workflow definition.
   */
  register(workflow: WorkflowDefinition): void {
    this._workflows.set(workflow.name, workflow)
  }

  /**
   * Run a registered workflow by name.
   * Steps execute sequentially. On failure, completed steps are compensated in reverse.
   */
  async run(
    workflowId: string,
    options: { input?: Record<string, unknown> } = {},
  ): Promise<Record<string, unknown>> {
    const workflow = this._workflows.get(workflowId)
    if (!workflow) {
      throw new Error(`Workflow "${workflowId}" not registered`)
    }

    const input = options.input ?? {}
    const completedSteps: Array<{
      name: string
      output: Record<string, unknown>
      compensation?: (ctx: { output: Record<string, unknown>; context: StepResolveContext }) => Promise<void>
    }> = []

    const previousOutput: Record<string, unknown> = {}

    const resolveContext: StepResolveContext = {
      resolve: <T>(key: string): T => this._container.resolve<T>(key),
    }

    for (const step of workflow.steps) {
      try {
        this._logger?.debug(`[workflow:${workflowId}] Running step: ${step.name}`)

        const result = await step.handler({
          input,
          previousOutput,
          context: resolveContext,
        })

        const output = (result != null && typeof result === 'object' ? result : { value: result }) as Record<string, unknown>
        previousOutput[step.name] = output

        completedSteps.push({
          name: step.name,
          output,
          compensation: step.compensation,
        })

        this._logger?.debug(`[workflow:${workflowId}] Step "${step.name}" completed`)
      } catch (error) {
        this._logger?.warn(`[workflow:${workflowId}] Step "${step.name}" failed: ${(error as Error).message}`)

        // Compensate in reverse order
        await this._compensate(workflowId, completedSteps, resolveContext)

        // Re-throw the original error
        throw error
      }
    }

    // Return the output of the last step
    const lastStep = workflow.steps[workflow.steps.length - 1]
    const finalOutput = previousOutput[lastStep.name] as Record<string, unknown>
    return finalOutput ?? {}
  }

  /**
   * Compensate completed steps in reverse order (saga pattern).
   */
  private async _compensate(
    workflowId: string,
    completedSteps: Array<{
      name: string
      output: Record<string, unknown>
      compensation?: (ctx: { output: Record<string, unknown>; context: StepResolveContext }) => Promise<void>
    }>,
    context: StepResolveContext,
  ): Promise<void> {
    this._logger?.warn(`[workflow:${workflowId}] Starting compensation (${completedSteps.length} steps)`)

    for (let i = completedSteps.length - 1; i >= 0; i--) {
      const step = completedSteps[i]
      if (!step.compensation) {
        this._logger?.debug(`[workflow:${workflowId}] No compensation for step "${step.name}" — skipping`)
        continue
      }

      try {
        this._logger?.debug(`[workflow:${workflowId}] Compensating step "${step.name}"`)
        await step.compensation({ output: step.output, context })
        this._logger?.debug(`[workflow:${workflowId}] Step "${step.name}" compensated`)
      } catch (compError) {
        // Best-effort compensation — log and continue
        this._logger?.error(`[workflow:${workflowId}] Compensation failed for step "${step.name}": ${(compError as Error).message}`)
      }
    }

    this._logger?.warn(`[workflow:${workflowId}] Compensation complete`)
  }

  _reset(): void {
    this._workflows.clear()
  }
}
