// IWorkflowStorePort interface — durable store for workflow runs.
// Powers the `/admin/_runs/:runId` page, `useCommand` polling, and cancellation.
// See WORKFLOW_PROGRESS.md §5.1 and §9.1 for the full design.

// 'paused' is a pre-terminal status set when a step yields via `ctx.yield(state)`
// — the workflow is waiting for a queued continuation (QStash / in-memory queue)
// to re-invoke `manager.resume(runId)`. Reaper treats it the same as 'pending' /
// 'running' for orphan detection.
export type WorkflowStatus = 'pending' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled'

export type StepStatus = 'pending' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled' | 'compensated'

export interface StepState {
  name: string
  status: StepStatus
  started_at?: Date
  completed_at?: Date
  error?: { message: string; code?: string }
  /**
   * Resume state written by `ctx.yield(state)`. Populated only when the step
   * is paused mid-execution; consumed by the next invocation's handler via
   * `ctx.resumeState` on resume, and cleared on successful completion.
   */
  resume_state?: unknown
}

export interface WorkflowError {
  message: string
  code?: string
  stack?: string
}

export interface WorkflowRun {
  id: string
  command_name: string
  status: WorkflowStatus
  steps: StepState[]
  input: unknown
  output?: unknown
  error?: WorkflowError
  started_at: Date
  completed_at?: Date
  cancel_requested_at?: Date
}

export interface NewWorkflowRun {
  id: string
  command_name: string
  steps: StepState[]
  input: unknown
}

/**
 * Durable workflow run store contract.
 * Adapters: DrizzleWorkflowStore (Postgres).
 *
 * Writes only happen on state transitions (workflow started, step state change,
 * workflow terminal). In-flight progress is NOT stored here — see IProgressChannelPort.
 */
export interface IWorkflowStorePort {
  /**
   * Insert a new run in status='pending' with the initial steps array.
   * Throws if a run with the same id already exists.
   */
  create(run: NewWorkflowRun): Promise<void>

  /**
   * Patch the matching step (by name) within the steps array.
   * Preserves other steps. Undefined fields in `patch` are not overwritten.
   *
   * **Append-on-miss semantics** — if no step with `stepName` exists in the current
   * `steps` array, the adapter MUST append a new `StepState { name: stepName, ...patch }`
   * rather than throw. This is required because:
   *   1. Some steps (e.g. dynamically-named loop iterations) are discovered at runtime
   *      after the initial `create()` call that seeded the steps array.
   *   2. Parallel DAG branches may add steps outside the originally-declared order.
   *   3. It makes the method idempotent and safe for retries.
   *
   * Adapters whose storage requires an explicit "insert if missing" branch (Postgres
   * JSONB with array ops, Mongo with $push, etc.) must handle this internally.
   * See DrizzleWorkflowStore for the reference implementation.
   */
  updateStep(runId: string, stepName: string, patch: Partial<StepState>): Promise<void>

  /**
   * Transition the overall workflow status. Optional terminal fields
   * (output, error, completed_at) are written atomically with the status.
   */
  updateStatus(
    runId: string,
    status: WorkflowStatus,
    fields?: { output?: unknown; error?: WorkflowError; completed_at?: Date },
  ): Promise<void>

  /**
   * Request cancellation of a running workflow.
   * Sets `cancel_requested_at = now()` once. Idempotent — no-op if the run
   * is already terminal (succeeded/failed/cancelled) or already cancel-requested.
   */
  requestCancel(runId: string): Promise<void>

  /**
   * Fetch a run by id. Returns null if not found.
   */
  get(runId: string): Promise<WorkflowRun | null>

  /**
   * List runs in a pre-terminal state ('pending' or 'running') with
   * heartbeat_at older than the threshold. Used by the orphan-reaper job on
   * serverless hosts (WP-F04): the host is no longer alive so the reaper
   * flips the run to failed. Covers both statuses because workflows live as
   * 'pending' from create() through every step until a terminal updateStatus;
   * a crash before the first step leaves the row frozen at 'pending'.
   */
  listOrphans(opts: { olderThan: Date; limit?: number }): Promise<WorkflowRun[]>

  /**
   * Mark a run as failed because its host disappeared (WP-F04). Sets status='failed',
   * error, and completed_at. Idempotent on terminal rows — a row already
   * succeeded/failed/cancelled is not touched. Flips both 'pending' and
   * 'running' (see listOrphans for the rationale).
   */
  markOrphanFailed(runId: string, error: WorkflowError): Promise<void>
}
