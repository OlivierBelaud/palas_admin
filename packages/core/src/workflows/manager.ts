// WorkflowManager — registers and executes imperative workflows.

import { AsyncLocalStorage } from 'node:async_hooks'
import type { MantaApp } from '../app'
import { MantaError } from '../errors/manta-error'
import type { Message } from '../events/types'
import type { IEventBusPort } from '../ports/event-bus'
import type { ILockingPort } from '../ports/locking'
import type { ILoggerPort } from '../ports/logger'
import type {
  CompletedStep,
  StepContext,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowRunOptions,
  WorkflowRunResult,
} from './types'
import { RETRY_POLICY } from './types'

export const workflowContextStorage = new AsyncLocalStorage<WorkflowContext>()

export interface WorkflowStorage {
  save(transactionId: string, stepId: string, data: unknown): Promise<void>
  list(transactionId: string): Promise<Array<{ stepId: string; data: unknown }>>
  delete(transactionId: string): Promise<void>
  /** Track workflow execution start (optional) */
  trackStart?(transactionId: string, workflowName: string, input: unknown): Promise<void>
  /** Track workflow execution completion (optional) */
  trackComplete?(transactionId: string, result: unknown): Promise<void>
  /** Track workflow execution failure (optional) */
  trackFailed?(transactionId: string, error: string): Promise<void>
}

class MemoryStorage implements WorkflowStorage {
  private _store = new Map<string, unknown>()

  async save(transactionId: string, stepId: string, data: unknown): Promise<void> {
    this._store.set(`${transactionId}:${stepId}`, data)
  }

  async list(transactionId: string): Promise<Array<{ stepId: string; data: unknown }>> {
    const results: Array<{ stepId: string; data: unknown }> = []
    for (const [key, value] of this._store) {
      if (key.startsWith(`${transactionId}:`)) {
        results.push({ stepId: key.slice(transactionId.length + 1), data: value })
      }
    }
    return results
  }

  async delete(transactionId: string): Promise<void> {
    for (const key of this._store.keys()) {
      if (key.startsWith(`${transactionId}:`)) this._store.delete(key)
    }
  }
}

export interface WorkflowManagerOptions {
  storage?: WorkflowStorage
}

/**
 * WorkflowManager — registers and runs imperative workflows.
 * Steps access the workflow context via AsyncLocalStorage.
 */
export class WorkflowManager {
  private _workflows = new Map<string, WorkflowDefinition>()
  private _logger: ILoggerPort | null = null
  private _eventBus: IEventBusPort | null = null
  private _locking: ILockingPort | null = null
  private _storage: WorkflowStorage
  private _app: MantaApp

  constructor(app: MantaApp, options?: WorkflowManagerOptions) {
    this._app = app
    this._storage = options?.storage ?? new MemoryStorage()

    this._logger = app.infra.logger ?? null
    this._eventBus = app.infra.eventBus ?? null
    this._locking = app.infra.locking ?? null
  }

  // biome-ignore lint/suspicious/noExplicitAny: workflow definitions have varied type params
  register(workflow: WorkflowDefinition<any, any>): void {
    this._workflows.set(workflow.name, workflow)
  }

  async run(workflowId: string, options: WorkflowRunOptions = {}): Promise<WorkflowRunResult> {
    const workflow = this._workflows.get(workflowId)
    if (!workflow) throw new MantaError('UNKNOWN_MODULES', `Workflow "${workflowId}" not registered`)

    const input = options.input ?? {}
    const transactionId = options.transactionId ?? `tx_${crypto.randomUUID().replace(/-/g, '')}`
    const cleanup = options.cleanup ?? true

    if (this._locking) {
      const acquired = await this._locking.acquire(`workflow:${transactionId}`, { expire: 60000 })
      if (!acquired) throw new MantaError('CONFLICT', `Workflow "${workflowId}" already running: ${transactionId}`)
    }

    try {
      // Durable execution: retry up to RETRY_POLICY.maxAttempts before compensating
      let lastError: Error | null = null
      for (let attempt = 1; attempt <= RETRY_POLICY.maxAttempts; attempt++) {
        try {
          return await this._execute(workflow, workflowId, input, transactionId, cleanup, attempt)
        } catch (error) {
          lastError = error as Error

          if (attempt < RETRY_POLICY.maxAttempts) {
            // Backoff delay before next attempt
            const delay = Math.min(
              RETRY_POLICY.initialIntervalMs * RETRY_POLICY.backoffMultiplier ** (attempt - 1),
              RETRY_POLICY.maxIntervalMs,
            )
            this._logger?.info(
              `[workflow:${workflowId}] Retrying (${attempt + 1}/${RETRY_POLICY.maxAttempts}) in ${delay}ms`,
            )
            await new Promise((resolve) => setTimeout(resolve, delay))
          }
        }
      }

      // Should never reach here, but TypeScript needs it
      throw lastError!
    } finally {
      if (this._locking) {
        await this._locking.release(`workflow:${transactionId}`).catch((err) => {
          ;(this._logger ?? console).warn(`[WorkflowManager] Lock release failed: ${err?.message ?? err}`)
        })
      }
    }
  }

  /**
   * Execute a single attempt. Throws on failure — the retry loop in run() handles retries.
   * On the final attempt, compensates before re-throwing.
   */
  private async _execute(
    workflow: WorkflowDefinition,
    workflowId: string,
    input: Record<string, unknown>,
    transactionId: string,
    cleanup: boolean,
    attempt = 1,
  ): Promise<WorkflowRunResult> {
    const isFinalAttempt = attempt >= RETRY_POLICY.maxAttempts

    // Track execution start
    if (this._storage.trackStart) {
      await this._storage.trackStart(transactionId, workflowId, input).catch((err) => {
        ;(this._logger ?? console).warn(`[WorkflowManager] trackStart failed: ${err?.message ?? err}`)
      })
    }

    // Load existing checkpoints (durable resume — completed steps skip in 0ms)
    const checkpoints = new Map<string, unknown>()
    const existing = await this._storage.list(transactionId)
    for (const cp of existing) checkpoints.set(cp.stepId, cp.data)
    if (checkpoints.size > 0) {
      this._logger?.info(
        `[workflow:${workflowId}] Resuming (attempt ${attempt}): ${checkpoints.size} steps already completed`,
      )
    }

    // Event buffering
    const eventGroupId = `wf:${transactionId}`

    // Create workflow context (accessible via AsyncLocalStorage)
    const storage = this._storage
    const wfCtx: WorkflowContext = {
      transactionId,
      checkpoints,
      completedSteps: [],
      stepCounter: new Map(),
      eventGroupId,
      bufferEvent: this._eventBus
        ? (event: Message) => {
            this._eventBus!.emit(event, { groupId: eventGroupId }).catch((err) => {
              ;(this._logger ?? console).warn(`[WorkflowManager] Event buffer failed: ${err?.message ?? err}`)
            })
          }
        : undefined,
      // Durable execution: persist each checkpoint immediately so retries can resume
      saveCheckpoint: async (stepKey: string, output: unknown) => {
        await storage.save(transactionId, stepKey, output)
      },
    }

    // Build step context — pass wfCtx explicitly for bundler compatibility
    const stepCtx: StepContext = { app: this._app, __wfCtx: wfCtx }

    // Execute within AsyncLocalStorage context
    try {
      const result = await workflowContextStorage.run(wfCtx, () => workflow.fn(input, stepCtx))

      // Release buffered events
      if (this._eventBus) {
        await this._eventBus.releaseGroupedEvents(eventGroupId).catch(() => {
          this._logger?.warn(`[workflow:${workflowId}] Failed to release buffered events`)
        })
      }

      // Track completion
      if (this._storage.trackComplete) {
        await this._storage.trackComplete(transactionId, result).catch((err) => {
          ;(this._logger ?? console).warn(`[WorkflowManager] trackComplete failed: ${err?.message ?? err}`)
        })
      }

      if (cleanup) {
        await this._storage.delete(transactionId).catch((err) => {
          ;(this._logger ?? console).warn(`[WorkflowManager] Checkpoint cleanup failed: ${err?.message ?? err}`)
        })
      }

      return {
        transaction: { transactionId, state: 'done' },
        result: result as Record<string, unknown>,
      }
    } catch (error) {
      this._logger?.warn(
        `[workflow:${workflowId}] Failed (attempt ${attempt}/${RETRY_POLICY.maxAttempts}): ${(error as Error).message}`,
      )

      // Track failure
      if (this._storage.trackFailed) {
        await this._storage.trackFailed(transactionId, (error as Error).message).catch((err) => {
          ;(this._logger ?? console).warn(`[WorkflowManager] trackFailed failed: ${err?.message ?? err}`)
        })
      }

      if (this._eventBus) {
        await this._eventBus.clearGroupedEvents(eventGroupId).catch((err) => {
          ;(this._logger ?? console).warn(`[WorkflowManager] Clear grouped events failed: ${err?.message ?? err}`)
        })
      }

      if (isFinalAttempt) {
        // All retries exhausted — compensate and cleanup
        await this._compensate(workflowId, wfCtx.completedSteps, stepCtx)
        if (cleanup) {
          await this._storage.delete(transactionId).catch((err) => {
            ;(this._logger ?? console).warn(`[WorkflowManager] Checkpoint cleanup failed: ${err?.message ?? err}`)
          })
        }
      }
      // Non-final: checkpoints remain in storage for next attempt to resume from

      throw error
    }
  }

  private async _compensate(workflowId: string, completedSteps: CompletedStep[], ctx: StepContext): Promise<void> {
    if (completedSteps.length === 0) return
    this._logger?.warn(`[workflow:${workflowId}] Compensating ${completedSteps.length} steps`)

    for (let i = completedSteps.length - 1; i >= 0; i--) {
      const step = completedSteps[i]
      if (!step.compensate) continue
      try {
        await step.compensate(step.output, ctx)
      } catch (err) {
        this._logger?.error(`[workflow:${workflowId}] Compensation failed "${step.name}": ${(err as Error).message}`)
      }
    }
  }

  _reset(): void {
    this._workflows.clear()
  }
}
