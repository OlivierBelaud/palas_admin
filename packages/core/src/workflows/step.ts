// SPEC-019b — step() factory for workflow step definitions

import type { StepDefinition, StepHandlerContext, StepResolveContext } from './types'

/**
 * Define a workflow step with handler and optional compensation.
 */
export function step(definition: {
  name: string
  handler: (ctx: StepHandlerContext) => Promise<unknown>
  compensation?: (ctx: { output: Record<string, unknown>; context: StepResolveContext }) => Promise<void>
}): StepDefinition {
  return {
    name: definition.name,
    handler: definition.handler,
    compensation: definition.compensation,
  }
}
