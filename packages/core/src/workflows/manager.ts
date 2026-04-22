// WorkflowManager — registers and executes imperative workflows.

import { AsyncLocalStorage } from 'node:async_hooks'
import type { MantaApp } from '../app'
import { MantaError } from '../errors/manta-error'
import type { Message } from '../events/types'
import type { IEventBusPort } from '../ports/event-bus'
import type { ILockingPort } from '../ports/locking'
import type { ILoggerPort } from '../ports/logger'
import type { IProgressChannelPort } from '../ports/progress-channel'
import type { IQueuePort } from '../ports/queue'
import type { IWorkflowStorePort, StepState, WorkflowError } from '../ports/workflow-store'
import { CancelledError } from './progress-helper'
import type {
  CompletedStep,
  StepContext,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowResult,
  WorkflowRunOptions,
  WorkflowRunResult,
} from './types'
import { RETRY_POLICY } from './types'
import { isWorkflowYield } from './yield'

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
  /**
   * Durable workflow run store — feeds `/admin/_runs/:runId`, `useCommand`
   * polling, and cancellation. See WORKFLOW_PROGRESS.md §5.1 / §9.1.
   */
  store?: IWorkflowStorePort
  /**
   * Ephemeral progress channel — backs `ctx.progress` and `ctx.forEach`.
   * See WORKFLOW_PROGRESS.md §5.2 / §9.2.
   */
  progressChannel?: IProgressChannelPort
  /**
   * Queue adapter used to schedule serverless continuations after a step
   * calls `ctx.yield(state)`. When absent, paused workflows stay paused
   * until someone calls `manager.resume(runId)` manually (tests / CLI).
   */
  queue?: IQueuePort
  /**
   * Builds the URL the queue should POST to resume a run. Typically wired
   * in init-infra: `(runId) => \`${baseUrl}/api/${ctx}/_workflow/${runId}/resume\``.
   * Called on every yield — cheap. When absent, queue.enqueue is skipped.
   */
  resumeEndpoint?: (runId: string) => string
  /**
   * Wall-clock budget (ms) propagated to every step via `ctx.budgetMs`.
   * On Vercel Hobby this should be ~7000 (10s cap − 3s safety). On
   * long-running Node hosts leave `undefined` (treated as Infinity).
   */
  stepBudgetMs?: number
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
  private _store: IWorkflowStorePort | undefined
  private _progressChannel: IProgressChannelPort | undefined
  private _queue: IQueuePort | undefined
  private _resumeEndpoint: ((runId: string) => string) | undefined
  private _stepBudgetMs: number | undefined
  private _app: MantaApp
  /** Per-run AbortControllers. Keyed by transactionId / runId. */
  private _controllers = new Map<string, AbortController>()

  constructor(app: MantaApp, options?: WorkflowManagerOptions) {
    this._app = app
    this._storage = options?.storage ?? new MemoryStorage()
    this._store = options?.store
    this._progressChannel = options?.progressChannel
    this._queue = options?.queue
    this._resumeEndpoint = options?.resumeEndpoint
    this._stepBudgetMs = options?.stepBudgetMs

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

    // Set up the per-run AbortController (used by ctx.signal + cancel detection).
    const controller = new AbortController()
    this._controllers.set(transactionId, controller)

    // Wire the eventbus-backed cancel channel (WORKFLOW_PROGRESS.md §10.3).
    // When the framework route DELETE /_workflow/:id publishes `workflow:cancel`,
    // the matching run aborts immediately — without waiting for the next step
    // boundary check. Cleanup happens in the outer finally block below.
    let cancelSubscriberId: string | null = null
    if (this._eventBus) {
      cancelSubscriberId = `workflow-cancel:${transactionId}`
      this._eventBus.subscribe(
        'workflow:cancel',
        (msg: Message) => {
          const data = msg.data as { runId?: string } | undefined
          if (data?.runId === transactionId && !controller.signal.aborted) {
            controller.abort('cancelled')
          }
        },
        { subscriberId: cancelSubscriberId },
      )
    }

    // Seed the durable run (best effort — store failures MUST NOT fail the workflow).
    if (this._store) {
      try {
        await this._store.create({
          id: transactionId,
          command_name: workflowId,
          steps: [],
          input,
        })
      } catch (err) {
        this._logger?.warn(`[workflow:${workflowId}] store.create failed: ${(err as Error)?.message ?? err}`)
      }
    }

    try {
      // Durable execution: retry up to RETRY_POLICY.maxAttempts before compensating
      let lastError: Error | null = null
      for (let attempt = 1; attempt <= RETRY_POLICY.maxAttempts; attempt++) {
        try {
          const result = await this._execute(workflow, workflowId, input, transactionId, cleanup, attempt, controller)
          // Terminal: succeeded
          if (this._store) {
            try {
              await this._store.updateStatus(transactionId, 'succeeded', {
                output: result.result,
                completed_at: new Date(),
              })
            } catch (err) {
              this._logger?.warn(
                `[workflow:${workflowId}] store.updateStatus(succeeded) failed: ${(err as Error)?.message ?? err}`,
              )
            }
          }
          if (this._progressChannel) {
            this._progressChannel.clear(transactionId).catch(() => {
              /* clear is observability — swallow */
            })
          }
          return result
        } catch (error) {
          // ctx.yield() is a non-error control flow — NEVER retry, NEVER
          // compensate. The step already persisted its resume_state via
          // createStep / runStep. We transition the run to 'paused' (pre-terminal)
          // and ask the queue port to schedule a continuation. The outer
          // finally releases the lock + cancel subscriber; no explicit
          // cleanup() call needed here.
          if (isWorkflowYield(error)) {
            if (this._store) {
              try {
                await this._store.updateStatus(transactionId, 'paused')
              } catch (err) {
                this._logger?.warn(
                  `[workflow:${workflowId}] store.updateStatus(paused) failed: ${(err as Error)?.message ?? err}`,
                )
              }
            }
            // Ask the queue adapter to schedule a continuation. If no queue
            // is wired, the run stays paused until a manual
            // `manager.resume(runId)` is called (tests / CLI).
            if (this._queue && this._resumeEndpoint) {
              try {
                await this._queue.enqueue({
                  url: this._resumeEndpoint(transactionId),
                  payload: { runId: transactionId },
                  idempotencyKey: `resume:${transactionId}`,
                })
              } catch (err) {
                this._logger?.warn(
                  `[workflow:${workflowId}] queue.enqueue(resume) failed: ${(err as Error)?.message ?? err}`,
                )
              }
            }
            return {
              transaction: { transactionId, state: 'invoking' },
              result: undefined,
            } as WorkflowRunResult
          }
          lastError = error as Error

          // Cancellation short-circuits retries.
          const isCancel = isCancelledError(error)
          if (isCancel) break

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

      // Terminal failure path
      if (this._store && lastError) {
        const cancelled = isCancelledError(lastError)
        const terminalStatus = cancelled ? 'cancelled' : 'failed'
        const fields: { error?: WorkflowError; completed_at?: Date } = { completed_at: new Date() }
        if (!cancelled) {
          fields.error = toWorkflowError(lastError)
        }
        try {
          await this._store.updateStatus(transactionId, terminalStatus, fields)
        } catch (err) {
          this._logger?.warn(
            `[workflow:${workflowId}] store.updateStatus(${terminalStatus}) failed: ${(err as Error)?.message ?? err}`,
          )
        }
      }
      if (this._progressChannel) {
        this._progressChannel.clear(transactionId).catch(() => {
          /* swallow */
        })
      }

      throw lastError!
    } finally {
      this._controllers.delete(transactionId)
      if (cancelSubscriberId && this._eventBus) {
        try {
          this._eventBus.unsubscribe(cancelSubscriberId)
        } catch {
          /* eventbus may be disposed — ignore */
        }
      }
      if (this._locking) {
        await this._locking.release(`workflow:${transactionId}`).catch((err) => {
          ;(this._logger ?? console).warn(`[WorkflowManager] Lock release failed: ${err?.message ?? err}`)
        })
      }
    }
  }

  /**
   * Resume a paused workflow run. Invoked by the HTTP handler for
   * `POST /api/<ctx>/_workflow/:runId/resume` when the queue adapter
   * delivers a continuation.
   *
   * Loads the run's original `command_name` and `input` from the store, then
   * re-enters `run()` with the same `transactionId`. The normal resume
   * machinery picks up:
   *  - completed steps (from workflow_checkpoints) — skipped at zero cost
   *  - paused steps (from workflow_runs.steps[].resume_state) — re-invoked
   *    with ctx.resumeState populated
   *
   * Idempotent: safe to call multiple times — if the run is already terminal,
   * returns early without re-executing.
   */
  async resume(runId: string): Promise<WorkflowRunResult> {
    if (!this._store) {
      throw new MantaError('UNEXPECTED_STATE', 'resume requires an IWorkflowStorePort')
    }
    const run = await this._store.get(runId)
    if (!run) {
      throw new MantaError('NOT_FOUND', `Workflow run "${runId}" not found`)
    }
    if (run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled') {
      this._logger?.info(`[workflow:${run.command_name}] resume(${runId}) skipped — already ${run.status}`)
      return { transaction: { transactionId: runId, state: 'done' } }
    }
    // Re-enter the workflow with the same transactionId. checkpoints + resumeStates
    // are loaded from the store inside _execute.
    return this.run(run.command_name, {
      transactionId: runId,
      input: (run.input as Record<string, unknown>) ?? {},
    })
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
    attempt: number,
    controller: AbortController,
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

    // Load resume states (for steps that ctx.yield()ed on a previous invocation).
    // Empty on a fresh run; populated when the queue delivers a POST to the
    // `/resume` endpoint and `manager.resume(runId)` re-enters _execute.
    const resumeStates = new Map<string, unknown>()
    if (this._store) {
      try {
        const run = await this._store.get(transactionId)
        if (run) {
          for (const step of run.steps ?? []) {
            if (step.status === 'paused' && step.resume_state !== undefined) {
              resumeStates.set(step.name, step.resume_state)
            }
          }
        }
      } catch (err) {
        this._logger?.warn(`[workflow:${workflowId}] store.get(resumeStates) failed: ${(err as Error)?.message ?? err}`)
      }
    }

    // Event buffering
    const eventGroupId = `wf:${transactionId}`

    // Create workflow context (accessible via AsyncLocalStorage)
    const storage = this._storage
    const wfCtx: WorkflowContext = {
      transactionId,
      runId: transactionId,
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
      store: this._store,
      progressChannel: this._progressChannel,
      stepName: undefined,
      signal: controller.signal,
      resumeStates: resumeStates.size > 0 ? resumeStates : undefined,
      budgetMs: this._stepBudgetMs,
    }

    // Attach an internal abort hook so step wrappers can fire the per-run
    // AbortController on cancel detection without needing access to the
    // manager itself.
    ;(wfCtx as WorkflowContext & { __abort?: (reason?: string) => void }).__abort = (reason?: string) => {
      if (!controller.signal.aborted) controller.abort(reason)
    }

    // Build step context — pass wfCtx explicitly for bundler compatibility.
    // Note: progress/forEach/signal on StepContext are injected by the step
    // wrappers (createStep / runStep) via wfCtx, so we don't duplicate them here.
    const stepCtx: StepContext = { app: this._app, __wfCtx: wfCtx, signal: controller.signal }

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
      const cancelled = isCancelledError(error)
      this._logger?.warn(
        `[workflow:${workflowId}] ${cancelled ? 'Cancelled' : 'Failed'} (attempt ${attempt}/${RETRY_POLICY.maxAttempts}): ${(error as Error).message}`,
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

      if (isFinalAttempt || cancelled) {
        // Terminal: compensate. On cancel we compensate immediately (no more retries).
        await this._compensate(workflowId, wfCtx.completedSteps, stepCtx, transactionId)
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

  private async _compensate(
    workflowId: string,
    completedSteps: CompletedStep[],
    ctx: StepContext,
    transactionId: string,
  ): Promise<void> {
    if (completedSteps.length === 0) return
    this._logger?.warn(`[workflow:${workflowId}] Compensating ${completedSteps.length} steps`)

    for (let i = completedSteps.length - 1; i >= 0; i--) {
      const step = completedSteps[i]
      if (!step.compensate) continue
      try {
        await step.compensate(step.output, ctx)
        // Mark the compensated step in the durable store (best effort).
        if (this._store) {
          try {
            await this._store.updateStep(transactionId, step.name, {
              status: 'compensated',
              completed_at: new Date(),
            })
          } catch (err) {
            this._logger?.warn(
              `[workflow:${workflowId}] store.updateStep(compensated, "${step.name}") failed: ${(err as Error)?.message ?? err}`,
            )
          }
        }
      } catch (err) {
        this._logger?.error(`[workflow:${workflowId}] Compensation failed "${step.name}": ${(err as Error).message}`)
      }
    }
  }

  _reset(): void {
    this._workflows.clear()
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function isCancelledError(err: unknown): boolean {
  if (err instanceof CancelledError) return true
  if (err && typeof err === 'object') {
    const e = err as { name?: string; code?: string }
    if (e.code === 'WORKFLOW_CANCELLED') return true
    if (e.name === 'CancelledError') return true
  }
  return false
}

function toWorkflowError(err: unknown): WorkflowError {
  if (err instanceof MantaError) {
    return {
      message: err.message,
      code: err.type,
      stack: err.stack,
    }
  }
  if (err instanceof Error) {
    return {
      message: err.message,
      stack: err.stack,
    }
  }
  return { message: String(err) }
}

// Re-export for internal use (the step wrappers call these).
export type { StepState }
