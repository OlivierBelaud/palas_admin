// SPEC-019b — WorkflowManager: registers and executes workflows with compensation
// Supports persistent checkpoints via Drizzle for crash recovery in serverless.

import type { IContainer } from '../container'
import type { ILoggerPort } from '../ports/logger'
import type { WorkflowDefinition, WorkflowResult, StepResolveContext } from './types'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { eq, and } from 'drizzle-orm'
import { workflowCheckpoints, workflowExecutions } from '../db/schema'

/**
 * WorkflowManager registers workflow definitions and executes them.
 * Supports sequential step execution with saga-style compensation on failure.
 * When a Drizzle db instance is provided, checkpoints are persisted for crash recovery.
 */
export class WorkflowManager {
  private _workflows = new Map<string, WorkflowDefinition>()
  private _container: IContainer
  private _logger: ILoggerPort | null = null
  private _db: PostgresJsDatabase | null = null

  constructor(container: IContainer, db?: PostgresJsDatabase) {
    this._container = container
    this._db = db ?? null
    try {
      this._logger = container.resolve<ILoggerPort>('ILoggerPort')
    } catch {
      // Logger not available — run without logging
    }
  }

  register(workflow: WorkflowDefinition): void {
    this._workflows.set(workflow.name, workflow)
  }

  /**
   * Run a registered workflow by name.
   * Steps execute sequentially. Checkpoints are saved to DB after each step.
   * On failure, completed steps are compensated in reverse.
   * On resume (after crash), completed steps are skipped using saved checkpoints.
   */
  async run(
    workflowId: string,
    options: { input?: Record<string, unknown>; transactionId?: string } = {},
  ): Promise<Record<string, unknown>> {
    const workflow = this._workflows.get(workflowId)
    if (!workflow) {
      throw new Error(`Workflow "${workflowId}" not registered`)
    }

    const input = options.input ?? {}
    const transactionId = options.transactionId ?? `tx_${crypto.randomUUID().replace(/-/g, '')}`

    // Track execution in DB
    if (this._db) {
      await this._db.insert(workflowExecutions).values({
        transaction_id: transactionId,
        workflow_name: workflowId,
        status: 'running',
        input: input as any,
      }).onConflictDoUpdate({
        target: workflowExecutions.transaction_id,
        set: { status: 'running' },
      })
    }

    // Load existing checkpoints (for crash recovery)
    const existingCheckpoints = new Map<string, Record<string, unknown>>()
    if (this._db) {
      const rows = await this._db.select()
        .from(workflowCheckpoints)
        .where(and(
          eq(workflowCheckpoints.transaction_id, transactionId),
          eq(workflowCheckpoints.status, 'done'),
        ))
      for (const row of rows) {
        existingCheckpoints.set(row.step_id, row.data as Record<string, unknown>)
      }
      if (existingCheckpoints.size > 0) {
        this._logger?.info(`[workflow:${workflowId}] Resuming: ${existingCheckpoints.size} steps already completed`)
      }
    }

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
      // Check if step was already completed (crash recovery)
      const savedOutput = existingCheckpoints.get(step.name)
      if (savedOutput) {
        this._logger?.info(`[workflow:${workflowId}] Step "${step.name}" — SKIPPED (already completed)`)
        previousOutput[step.name] = savedOutput
        completedSteps.push({ name: step.name, output: savedOutput, compensation: step.compensation })
        continue
      }

      try {
        this._logger?.debug(`[workflow:${workflowId}] Running step: ${step.name}`)

        const result = await step.handler({
          input,
          previousOutput,
          context: resolveContext,
        })

        const output = (result != null && typeof result === 'object' ? result : { value: result }) as Record<string, unknown>
        previousOutput[step.name] = output

        // Save checkpoint to DB
        if (this._db) {
          await this._db.insert(workflowCheckpoints).values({
            transaction_id: transactionId,
            step_id: step.name,
            status: 'done',
            data: output as any,
          }).onConflictDoUpdate({
            target: [workflowCheckpoints.transaction_id, workflowCheckpoints.step_id],
            set: { status: 'done', data: output as any },
          })
        }

        completedSteps.push({
          name: step.name,
          output,
          compensation: step.compensation,
        })

        this._logger?.debug(`[workflow:${workflowId}] Step "${step.name}" completed + checkpointed`)
      } catch (error) {
        this._logger?.warn(`[workflow:${workflowId}] Step "${step.name}" failed: ${(error as Error).message}`)

        // Save failed step to DB
        if (this._db) {
          await this._db.insert(workflowCheckpoints).values({
            transaction_id: transactionId,
            step_id: step.name,
            status: 'failed',
            error: (error as Error).message,
          }).onConflictDoUpdate({
            target: [workflowCheckpoints.transaction_id, workflowCheckpoints.step_id],
            set: { status: 'failed', error: (error as Error).message },
          })
        }

        // Compensate in reverse order
        await this._compensate(workflowId, completedSteps, resolveContext)

        // Mark execution as failed
        if (this._db) {
          await this._db.update(workflowExecutions)
            .set({ status: 'failed', error: (error as Error).message, completed_at: new Date() })
            .where(eq(workflowExecutions.transaction_id, transactionId))
        }

        throw error
      }
    }

    // Mark execution as completed
    const lastStep = workflow.steps[workflow.steps.length - 1]
    const finalOutput = previousOutput[lastStep.name] as Record<string, unknown>

    if (this._db) {
      await this._db.update(workflowExecutions)
        .set({ status: 'completed', result: finalOutput as any, completed_at: new Date() })
        .where(eq(workflowExecutions.transaction_id, transactionId))
    }

    return finalOutput ?? {}
  }

  /**
   * Resume incomplete workflows (call at bootstrap for crash recovery).
   * Finds workflows stuck in 'running' state and re-runs them.
   */
  async resumeIncomplete(): Promise<number> {
    if (!this._db) return 0

    const incomplete = await this._db.select()
      .from(workflowExecutions)
      .where(eq(workflowExecutions.status, 'running'))

    let resumed = 0
    for (const exec of incomplete) {
      const workflow = this._workflows.get(exec.workflow_name)
      if (!workflow) {
        this._logger?.warn(`[workflow] Cannot resume "${exec.workflow_name}" — not registered`)
        continue
      }

      this._logger?.info(`[workflow] Resuming incomplete: ${exec.transaction_id} (${exec.workflow_name})`)
      try {
        await this.run(exec.workflow_name, {
          input: exec.input as Record<string, unknown>,
          transactionId: exec.transaction_id,
        })
        resumed++
      } catch (err) {
        this._logger?.error(`[workflow] Resume failed for ${exec.transaction_id}: ${(err as Error).message}`)
      }
    }

    return resumed
  }

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
        this._logger?.error(`[workflow:${workflowId}] Compensation failed for step "${step.name}": ${(compError as Error).message}`)
      }
    }

    this._logger?.warn(`[workflow:${workflowId}] Compensation complete`)
  }

  _reset(): void {
    this._workflows.clear()
  }
}
