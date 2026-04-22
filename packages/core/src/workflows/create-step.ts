// createStep() — imperative, self-checkpointing step factory.
// Uses AsyncLocalStorage to access workflow context.

import { createForEach } from './for-each'
import { workflowContextStorage } from './manager'
import { CancelledError, createProgress } from './progress-helper'
import type { StepContext, StepFn, WorkflowContext } from './types'

/**
 * Create a workflow step.
 *
 * @example
 * const createProduct = createStep('create-product',
 *   async (input, { app }) => {
 *     return await app.modules.product.create(input)
 *   },
 *   async (product, { app }) => {
 *     await app.modules.product.delete(product.id)
 *   }
 * )
 */
export function createStep<TInput = unknown, TOutput = unknown>(
  name: string,
  handler: (input: TInput, ctx: StepContext) => Promise<TOutput>,
  compensate?: (output: TOutput, ctx: StepContext) => Promise<void>,
): StepFn<TInput, TOutput> {
  const stepFn: StepFn<TInput, TOutput> = async (input: TInput, ctx: StepContext): Promise<TOutput> => {
    // Get workflow context — try ALS first, then explicit context (bundler compatibility)
    const wfCtx: WorkflowContext | null = workflowContextStorage.getStore() ?? ctx.__wfCtx ?? null

    if (!wfCtx) {
      // Standalone mode — just run the handler directly
      return handler(input, ctx)
    }

    // Generate unique step key (handles loops: step-name, step-name-2, step-name-3...)
    const count = (wfCtx.stepCounter.get(name) ?? 0) + 1
    wfCtx.stepCounter.set(name, count)
    const stepKey = count === 1 ? name : `${name}-${count}`

    // Check for existing checkpoint (crash recovery / resume)
    if (wfCtx.checkpoints.has(stepKey)) {
      const cached = wfCtx.checkpoints.get(stepKey)
      if (compensate) {
        wfCtx.completedSteps.push({
          name: stepKey,
          output: cached,
          compensate: async (output, stepCtx) => compensate(output as TOutput, stepCtx),
        })
      } else {
        wfCtx.completedSteps.push({ name: stepKey, output: cached })
      }
      return cached as TOutput
    }

    // Cancel check BEFORE invoking. Cheap when no store is wired.
    await preStepCancelCheck(wfCtx, stepKey)

    // Tag the current step on wfCtx so ctx.progress / ctx.forEach know which
    // step is reporting, and so the store's updateStep targets the right row.
    const previousStepName = wfCtx.stepName
    wfCtx.stepName = stepKey

    // Durable store — mark step as running (best effort).
    if (wfCtx.store) {
      try {
        await wfCtx.store.updateStep(wfCtx.runId, stepKey, {
          status: 'running',
          started_at: new Date(),
        })
      } catch {
        // Store failures MUST NOT fail the workflow — swallow. The engine's
        // logger wrappers in manager.ts handle the visible cases.
      }
    }

    // Augment the StepContext with progress / signal / forEach bound to this run.
    const augmentedCtx: StepContext = {
      ...ctx,
      __wfCtx: wfCtx,
      signal: wfCtx.signal ?? ctx.signal,
      progress: createProgress(wfCtx),
      forEach: createForEach(wfCtx),
    }

    // Execute the handler
    let output: TOutput
    try {
      output = await handler(input, augmentedCtx)
    } catch (err) {
      const cancelled = isCancel(err)
      if (wfCtx.store) {
        try {
          await wfCtx.store.updateStep(wfCtx.runId, stepKey, {
            status: cancelled ? 'cancelled' : 'failed',
            completed_at: new Date(),
            error: cancelled ? undefined : { message: (err as Error)?.message ?? String(err) },
          })
        } catch {
          /* store errors are non-fatal */
        }
      }
      wfCtx.stepName = previousStepName
      throw err
    }

    // Register for compensation (only if explicit compensate provided)
    if (compensate) {
      wfCtx.completedSteps.push({
        name: stepKey,
        output,
        compensate: async (out, stepCtx) => compensate(out as TOutput, stepCtx),
      })
    } else {
      wfCtx.completedSteps.push({ name: stepKey, output })
    }

    // Save checkpoint (in-memory + persist to storage for crash recovery)
    wfCtx.checkpoints.set(stepKey, output)
    if (wfCtx.saveCheckpoint) await wfCtx.saveCheckpoint(stepKey, output)

    // Durable store — mark step as succeeded (best effort).
    if (wfCtx.store) {
      try {
        await wfCtx.store.updateStep(wfCtx.runId, stepKey, {
          status: 'succeeded',
          completed_at: new Date(),
        })
      } catch {
        /* store errors are non-fatal */
      }
    }

    wfCtx.stepName = previousStepName
    return output
  }

  Object.defineProperty(stepFn, '__stepName', { value: name })
  Object.defineProperty(stepFn, '__isStep', { value: true })

  return stepFn
}

function isCancel(err: unknown): boolean {
  if (err instanceof CancelledError) return true
  if (err && typeof err === 'object') {
    const e = err as { name?: string; code?: string }
    if (e.code === 'WORKFLOW_CANCELLED' || e.name === 'CancelledError') return true
  }
  return false
}

/**
 * Before a step runs, if the store is wired AND we have a runId, check whether
 * cancellation has been requested. If so, abort the controller and throw.
 *
 * Rationale: at PR-3 we don't yet have eventbus-based cancel propagation (that's
 * PR-4). Step-boundary checks are the best we can do; long single steps must
 * cooperate via `ctx.signal` + `ctx.forEach`.
 *
 * Note: `store.get` MAY throw — if it does we let it bubble so an actionable
 * failure is visible, per the plan's resilience invariant.
 */
async function preStepCancelCheck(wfCtx: WorkflowContext, stepKey: string): Promise<void> {
  // Already aborted? Throw immediately.
  if (wfCtx.signal?.aborted) throw new CancelledError(`Workflow ${wfCtx.runId} cancelled before step "${stepKey}"`)
  if (!wfCtx.store) return
  const run = await wfCtx.store.get(wfCtx.runId)
  if (run?.cancel_requested_at) {
    // Abort the per-run controller so any in-flight I/O that listens to
    // `ctx.signal` notices immediately, then throw — the engine catches and
    // transitions the run to `cancelled`.
    const abort = (wfCtx as WorkflowContext & { __abort?: (reason?: string) => void }).__abort
    if (typeof abort === 'function') abort('cancel_requested_at set on run')
    throw new CancelledError(`Workflow ${wfCtx.runId} cancelled`)
  }
}
