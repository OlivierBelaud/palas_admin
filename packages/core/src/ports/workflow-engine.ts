// SPEC-019b — IWorkflowEnginePort interface

import type { Context, WorkflowLifecycleEvent } from './types'

/**
 * Workflow engine port contract.
 * Manages workflow execution, step completion, and lifecycle subscriptions.
 * Adapters: InMemoryWorkflowEngine (test), PgWorkflowEngine (prod).
 */
export interface IWorkflowEnginePort {
  /**
   * Run a registered workflow.
   * @param workflowId - The workflow identifier
   * @param options - Execution options (input, context, transactionId, etc.)
   * @returns Execution result with status, output, and any errors
   */
  run(
    workflowId: string,
    options: {
      input?: unknown
      context?: Context
      transactionId?: string
      resultFrom?: string
      throwOnError?: boolean
    }
  ): Promise<{ status: string; output?: unknown; errors?: unknown[] }>

  /**
   * Get the running transaction state for a workflow.
   * @param workflowId - The workflow identifier
   * @param transactionId - The transaction identifier
   * @returns The transaction state
   */
  getRunningTransaction(workflowId: string, transactionId: string): Promise<unknown>

  /**
   * Mark an async step as succeeded.
   * @param idempotencyKey - The step's idempotency key
   * @param response - The step result
   */
  setStepSuccess(idempotencyKey: string, response: unknown): Promise<void>

  /**
   * Mark an async step as failed.
   * @param idempotencyKey - The step's idempotency key
   * @param error - The error that caused failure
   */
  setStepFailure(idempotencyKey: string, error: Error): Promise<void>

  /**
   * Subscribe to workflow lifecycle events.
   * @param options - Event type and optional workflow filter
   * @param handler - The event handler
   * @returns Unsubscribe function
   */
  subscribe(
    options: { event: WorkflowLifecycleEvent['type']; workflowId?: string },
    handler: (event: WorkflowLifecycleEvent) => Promise<void> | void
  ): () => void
}
