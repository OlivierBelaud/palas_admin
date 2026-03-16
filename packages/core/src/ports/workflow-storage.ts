// SPEC-020 — IWorkflowStoragePort interface

/**
 * Workflow storage port contract.
 * Persists workflow step checkpoints for recovery.
 * Adapters: InMemoryWorkflowStorage (test), PgWorkflowStorage (prod).
 */
export interface IWorkflowStoragePort {
  /**
   * Save a checkpoint for a workflow step.
   * @param transactionId - The workflow transaction identifier
   * @param stepId - The step identifier
   * @param data - The checkpoint data
   */
  save(transactionId: string, stepId: string, data: Record<string, unknown>): Promise<void>

  /**
   * Load checkpoint data for a workflow or specific step.
   * @param transactionId - The workflow transaction identifier
   * @param stepId - Optional step identifier (if omitted, loads workflow-level data)
   * @returns The checkpoint data or null if not found
   */
  load(transactionId: string, stepId?: string): Promise<Record<string, unknown> | null>

  /**
   * List all step checkpoints for a workflow transaction.
   * @param transactionId - The workflow transaction identifier
   * @returns Array of step checkpoints
   */
  list(transactionId: string): Promise<Array<{ stepId: string; data: Record<string, unknown> }>>

  /**
   * Delete all checkpoints for a workflow transaction.
   * @param transactionId - The workflow transaction identifier
   */
  delete(transactionId: string): Promise<void>
}
