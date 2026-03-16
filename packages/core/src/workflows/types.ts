// SPEC-019b — Workflow types for createWorkflow/step API

import type { IContainer } from '../container'

/**
 * Context passed to step handlers.
 */
export interface StepHandlerContext {
  input: Record<string, unknown>
  previousOutput: Record<string, unknown>
  context: StepResolveContext
}

/**
 * A resolve-capable context wrapping the container.
 */
export interface StepResolveContext {
  resolve<T>(key: string): T
}

/**
 * A workflow step definition.
 */
export interface StepDefinition {
  name: string
  handler: (ctx: StepHandlerContext) => Promise<unknown>
  compensation?: (ctx: { output: Record<string, unknown>; context: StepResolveContext }) => Promise<void>
}

/**
 * A workflow definition created by createWorkflow().
 */
export interface WorkflowDefinition {
  name: string
  steps: StepDefinition[]
}

/**
 * Options for running a workflow.
 */
export interface WorkflowRunOptions {
  input?: Record<string, unknown>
  container?: IContainer
  throwOnError?: boolean
}

/**
 * Result of a workflow execution.
 */
export interface WorkflowResult {
  status: 'done' | 'failed' | 'compensated'
  output?: unknown
  errors?: unknown[]
}
