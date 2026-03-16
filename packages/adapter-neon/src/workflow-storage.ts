// NeonWorkflowStorageAdapter — persistent workflow checkpoints
import type { IWorkflowStoragePort } from "@manta/core/ports"
import type postgres from "postgres"

export class NeonWorkflowStorageAdapter implements IWorkflowStoragePort {
  constructor(private sql: postgres.Sql) {}

  async save(transactionId: string, stepId: string, data: Record<string, unknown>): Promise<void> {
    await this.sql`
      INSERT INTO workflow_checkpoints (transaction_id, step_id, status, data, updated_at)
      VALUES (${transactionId}, ${stepId}, 'done', ${JSON.stringify(data)}::jsonb, NOW())
      ON CONFLICT (transaction_id, step_id) DO UPDATE
      SET data = ${JSON.stringify(data)}::jsonb, status = 'done', updated_at = NOW()
    `
  }

  async load(transactionId: string, stepId?: string): Promise<Record<string, unknown> | null> {
    if (stepId) {
      const rows = await this.sql`
        SELECT data FROM workflow_checkpoints
        WHERE transaction_id = ${transactionId} AND step_id = ${stepId}
      `
      return rows.length > 0 ? (rows[0].data as Record<string, unknown>) : null
    }
    // Load workflow-level execution data
    const rows = await this.sql`
      SELECT result as data FROM workflow_executions
      WHERE transaction_id = ${transactionId}
    `
    return rows.length > 0 ? (rows[0].data as Record<string, unknown>) : null
  }

  async list(transactionId: string): Promise<Array<{ stepId: string; data: Record<string, unknown> }>> {
    const rows = await this.sql`
      SELECT step_id, data FROM workflow_checkpoints
      WHERE transaction_id = ${transactionId}
      ORDER BY id ASC
    `
    return rows.map((r: any) => ({ stepId: r.step_id, data: r.data as Record<string, unknown> }))
  }

  async delete(transactionId: string): Promise<void> {
    await this.sql`DELETE FROM workflow_checkpoints WHERE transaction_id = ${transactionId}`
    await this.sql`DELETE FROM workflow_executions WHERE transaction_id = ${transactionId}`
  }

  // Extended methods for crash recovery
  async saveExecution(transactionId: string, workflowName: string, input: Record<string, unknown>): Promise<void> {
    await this.sql`
      INSERT INTO workflow_executions (transaction_id, workflow_name, status, input)
      VALUES (${transactionId}, ${workflowName}, 'running', ${JSON.stringify(input)}::jsonb)
      ON CONFLICT (transaction_id) DO UPDATE SET status = 'running', input = ${JSON.stringify(input)}::jsonb
    `
  }

  async completeExecution(transactionId: string, result: Record<string, unknown>): Promise<void> {
    await this.sql`
      UPDATE workflow_executions
      SET status = 'completed', result = ${JSON.stringify(result)}::jsonb, completed_at = NOW()
      WHERE transaction_id = ${transactionId}
    `
  }

  async failExecution(transactionId: string, error: string): Promise<void> {
    await this.sql`
      UPDATE workflow_executions
      SET status = 'failed', error = ${error}, completed_at = NOW()
      WHERE transaction_id = ${transactionId}
    `
  }

  async getIncompleteExecutions(): Promise<Array<{ transactionId: string; workflowName: string; input: Record<string, unknown> }>> {
    const rows = await this.sql`
      SELECT transaction_id, workflow_name, input
      FROM workflow_executions
      WHERE status = 'running'
      AND started_at < NOW() - INTERVAL '60 seconds'
    `
    return rows.map((r: any) => ({
      transactionId: r.transaction_id,
      workflowName: r.workflow_name,
      input: r.input as Record<string, unknown>,
    }))
  }

  async saveStepError(transactionId: string, stepId: string, error: string): Promise<void> {
    await this.sql`
      INSERT INTO workflow_checkpoints (transaction_id, step_id, status, error, updated_at)
      VALUES (${transactionId}, ${stepId}, 'failed', ${error}, NOW())
      ON CONFLICT (transaction_id, step_id) DO UPDATE
      SET status = 'failed', error = ${error}, updated_at = NOW()
    `
  }
}
