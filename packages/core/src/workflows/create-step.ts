// createStep() — imperative, self-checkpointing step factory.
// Uses AsyncLocalStorage to access workflow context.

import { workflowContextStorage } from './manager'
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

    // Execute the handler
    const output = await handler(input, ctx)

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

    return output
  }

  Object.defineProperty(stepFn, '__stepName', { value: name })
  Object.defineProperty(stepFn, '__isStep', { value: true })

  return stepFn
}
