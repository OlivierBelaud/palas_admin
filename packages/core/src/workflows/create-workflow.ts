// SPEC-019b — createWorkflow() factory

import type { WorkflowDefinition, StepDefinition } from './types'

/**
 * Define a workflow with a name and ordered steps.
 */
export function createWorkflow(definition: {
  name: string
  steps: StepDefinition[]
}): WorkflowDefinition {
  return {
    name: definition.name,
    steps: definition.steps,
  }
}
