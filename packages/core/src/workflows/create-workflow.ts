// createWorkflow() — imperative async workflow factory
//
// Returns a WorkflowDefinition that the WorkflowManager can register and run.
// The workflow function is a plain async function — if/else, for loops, everything works.

import type { StepContext, WorkflowDefinition } from './types'

/**
 * Create a workflow.
 *
 * @param name — unique workflow name
 * @param fn — async function that orchestrates steps
 *
 * @example
 * export default createWorkflow('create-product', async (input, { app }) => {
 *   await validateStep(input, { app })
 *   const product = await createProductStep(input, { app })
 *   return await activateStep(product, { app })
 * })
 */
export function createWorkflow<TInput = unknown, TOutput = unknown>(
  name: string,
  fn: (input: TInput, ctx: StepContext) => Promise<TOutput>,
): WorkflowDefinition<TInput, TOutput> {
  return { name, fn }
}
