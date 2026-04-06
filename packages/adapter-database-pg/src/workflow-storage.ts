// DrizzleWorkflowStorage — persists workflow checkpoints to Postgres via Drizzle.
// Implements the WorkflowStorage interface from @manta/core WorkflowManager.

import { workflowCheckpoints } from '@manta/core/db'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

/**
 * WorkflowStorage backed by Postgres (via Drizzle).
 * Inject into WorkflowManager for serverless persistence / crash recovery.
 *
 * @example
 * const storage = new DrizzleWorkflowStorage(drizzleDb)
 * const manager = new WorkflowManager(app, { storage })
 */
export class DrizzleWorkflowStorage {
  constructor(private _db: PostgresJsDatabase) {}

  async save(transactionId: string, stepId: string, data: unknown): Promise<void> {
    const jsonData = (data != null && typeof data === 'object' ? data : { value: data }) as Record<string, unknown>
    await this._db
      .insert(workflowCheckpoints)
      .values({
        transaction_id: transactionId,
        step_id: stepId,
        status: 'done',
        data: jsonData,
      })
      .onConflictDoUpdate({
        target: [workflowCheckpoints.transaction_id, workflowCheckpoints.step_id],
        set: { status: 'done', data: jsonData },
      })
  }

  async list(transactionId: string): Promise<Array<{ stepId: string; data: unknown }>> {
    const rows = await this._db
      .select()
      .from(workflowCheckpoints)
      .where(and(eq(workflowCheckpoints.transaction_id, transactionId), eq(workflowCheckpoints.status, 'done')))

    return rows.map((row) => ({
      stepId: row.step_id,
      data: row.data as unknown,
    }))
  }

  async delete(transactionId: string): Promise<void> {
    await this._db.delete(workflowCheckpoints).where(eq(workflowCheckpoints.transaction_id, transactionId))
  }
}
