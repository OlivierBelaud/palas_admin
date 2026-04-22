// DrizzleWorkflowStore — persists workflow runs to Postgres via Drizzle.
// Implements IWorkflowStorePort — see WORKFLOW_PROGRESS.md §5.1 and §9.1.
//
// Distinct from DrizzleWorkflowStorage (checkpoint log for crash recovery).
// This store powers the progress-tracking feature: `/admin/_runs/:runId`,
// `useCommand` polling, and cancellation.

import type {
  IWorkflowStorePort,
  NewWorkflowRun,
  StepState,
  WorkflowError,
  WorkflowRun,
  WorkflowStatus,
} from '@manta/core'
import { workflowRuns } from '@manta/core/db'
import { MantaError } from '@manta/core/errors'
import { and, eq, inArray, isNull, lt, notInArray, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

const TERMINAL_STATUSES: WorkflowStatus[] = ['succeeded', 'failed', 'cancelled']

/**
 * Durable workflow run store backed by Postgres (via Drizzle).
 *
 * @example
 * const store = new DrizzleWorkflowStore(drizzleDb)
 * await store.create({ id: 'run_123', command_name: 'products:import', steps: [...], input: {...} })
 */
export class DrizzleWorkflowStore implements IWorkflowStorePort {
  constructor(private _db: PostgresJsDatabase) {}

  async create(run: NewWorkflowRun): Promise<void> {
    try {
      await this._db.insert(workflowRuns).values({
        id: run.id,
        command_name: run.command_name,
        status: 'pending',
        steps: run.steps as unknown as Record<string, unknown>,
        input: (run.input ?? {}) as Record<string, unknown>,
      })
    } catch (err) {
      throw new MantaError('DB_ERROR', `Failed to create workflow run "${run.id}": ${(err as Error).message}`)
    }
  }

  async updateStep(runId: string, stepName: string, patch: Partial<StepState>): Promise<void> {
    // Read-modify-write inside a transaction to avoid lost updates when
    // sibling steps are patched concurrently.
    //
    // Contract: workflows are function-based; the step DAG is not known at
    // `create` time (steps seeded as []). Steps are discovered at runtime, so
    // `updateStep` must APPEND when the step name is absent and MERGE when it
    // is present. NOT_FOUND applies only to the workflow row, never the step.
    await this._db.transaction(async (tx) => {
      const rows = await tx
        .select({ steps: workflowRuns.steps })
        .from(workflowRuns)
        .where(eq(workflowRuns.id, runId))
        .for('update')

      if (rows.length === 0) {
        throw new MantaError('NOT_FOUND', `Workflow run "${runId}" not found`)
      }

      const current = (rows[0].steps as unknown as StepState[]) ?? []
      let patched = false
      const next = current.map((step) => {
        if (step.name !== stepName) return step
        patched = true
        return { ...step, ...patch }
      })

      if (!patched) {
        next.push({ name: stepName, status: 'pending', ...patch } as StepState)
      }

      await tx
        .update(workflowRuns)
        .set({
          steps: next as unknown as Record<string, unknown>,
          // WP-F04 — bump heartbeat on every step transition. This is the signal
          // the orphan reaper looks at to detect runs whose host disappeared.
          heartbeat_at: sql`NOW()`,
        })
        .where(eq(workflowRuns.id, runId))
    })
  }

  async updateStatus(
    runId: string,
    status: WorkflowStatus,
    fields?: { output?: unknown; error?: WorkflowError; completed_at?: Date },
  ): Promise<void> {
    const set: Record<string, unknown> = { status }
    if (fields?.output !== undefined) set.output = fields.output as Record<string, unknown>
    if (fields?.error !== undefined) set.error = fields.error as unknown as Record<string, unknown>
    if (fields?.completed_at !== undefined) set.completed_at = fields.completed_at

    try {
      await this._db.update(workflowRuns).set(set).where(eq(workflowRuns.id, runId))
    } catch (err) {
      throw new MantaError('DB_ERROR', `Failed to update status for workflow run "${runId}": ${(err as Error).message}`)
    }
  }

  async requestCancel(runId: string): Promise<void> {
    // Idempotent: only set cancel_requested_at if it hasn't been set AND the
    // run is not already terminal. No error if already cancelled or terminal.
    await this._db
      .update(workflowRuns)
      .set({ cancel_requested_at: sql`NOW()` })
      .where(
        and(
          eq(workflowRuns.id, runId),
          isNull(workflowRuns.cancel_requested_at),
          notInArray(workflowRuns.status, TERMINAL_STATUSES),
        ),
      )
  }

  async get(runId: string): Promise<WorkflowRun | null> {
    const rows = await this._db.select().from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1)
    if (rows.length === 0) return null
    const row = rows[0]

    return {
      id: row.id,
      command_name: row.command_name,
      status: row.status as WorkflowStatus,
      steps: (row.steps as unknown as StepState[]) ?? [],
      input: row.input,
      output: row.output ?? undefined,
      error: (row.error as WorkflowError | null) ?? undefined,
      started_at: row.started_at as Date,
      completed_at: (row.completed_at as Date | null) ?? undefined,
      cancel_requested_at: (row.cancel_requested_at as Date | null) ?? undefined,
    }
  }

  async listOrphans(opts: { olderThan: Date; limit?: number }): Promise<WorkflowRun[]> {
    const limit = opts.limit ?? 50
    // Workflows live as 'pending' from `store.create` through every step until
    // a terminal `updateStatus`. A host killed mid-run (serverless timeout,
    // crash) leaves the row frozen at 'pending' — we must reap those too, not
    // just 'running', otherwise the UI polls forever. WP-F04 + hotfix.
    const rows = await this._db
      .select()
      .from(workflowRuns)
      .where(and(inArray(workflowRuns.status, ['pending', 'running']), lt(workflowRuns.heartbeat_at, opts.olderThan)))
      .limit(limit)

    return rows.map((row) => ({
      id: row.id,
      command_name: row.command_name,
      status: row.status as WorkflowStatus,
      steps: (row.steps as unknown as StepState[]) ?? [],
      input: row.input,
      output: row.output ?? undefined,
      error: (row.error as WorkflowError | null) ?? undefined,
      started_at: row.started_at as Date,
      completed_at: (row.completed_at as Date | null) ?? undefined,
      cancel_requested_at: (row.cancel_requested_at as Date | null) ?? undefined,
    }))
  }

  async markOrphanFailed(runId: string, error: WorkflowError): Promise<void> {
    // Idempotent: only flips runs still in a pre-terminal state. If the run
    // already reached succeeded/failed/cancelled, no rows are touched — matches
    // the contract in IWorkflowStorePort. Both 'pending' and 'running' are
    // pre-terminal (see listOrphans for the rationale).
    await this._db
      .update(workflowRuns)
      .set({
        status: 'failed',
        error: error as unknown as Record<string, unknown>,
        completed_at: sql`NOW()`,
      })
      .where(and(eq(workflowRuns.id, runId), inArray(workflowRuns.status, ['pending', 'running'])))
  }
}
