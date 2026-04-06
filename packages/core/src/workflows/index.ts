// Workflow system — public API

export { createStep } from './create-step'
export { createWorkflow } from './create-workflow'
export type { ModuleWorkflowDefinition, WorkflowHandlerContext } from './define-workflow'
export { defineWorkflow } from './define-workflow'
export type { EmitEventStepInput } from './emit-event-step'
export { emitEventStep } from './emit-event-step'
export { WorkflowManager, type WorkflowStorage, workflowContextStorage } from './manager'
export type { ActionStepConfig, CrudStepConfig } from './step'
/** @internal */ export { ENTITY_TAG, step } from './step'
export type {
  CompletedStep,
  StepContext,
  StepDefinition,
  StepExecutionContext,
  StepFn,
  StepHandlerContext,
  StepResolveContext,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowResult,
  WorkflowRunOptions,
  WorkflowRunResult,
} from './types'
// Legacy — kept for backward compat (plugin-medusa, existing tests)
export { StepResponse, WorkflowResponse } from './types'
