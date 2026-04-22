// Workflow types — imperative async-first API

import type { MantaApp } from '../app'
import type { Message } from '../events/types'
import type { IProgressChannelPort } from '../ports/progress-channel'
import type { IWorkflowStorePort } from '../ports/workflow-store'

// ---------------------------------------------------------------------------
// Step context — passed as 2nd arg to step handlers
// ---------------------------------------------------------------------------

/**
 * Per-batch info passed to `ctx.forEach` handler and message formatter.
 * See WORKFLOW_PROGRESS.md §6.4.
 */
export interface ForEachInfo {
  /** Number of items already processed (count before this batch completes). */
  done: number
  /** Total expected count. `null` for unbounded AsyncIterable streams. */
  total: number | null
  /** Zero-based index of the batch that just completed / is being processed. */
  batchIndex: number
}

/**
 * Context available inside step invoke and compensate functions.
 */
export interface StepContext {
  app: MantaApp
  /** @internal Workflow context — set by WorkflowManager, used by createStep */
  __wfCtx?: WorkflowContext
  /**
   * Report progress for the current step. Fire-and-forget, synchronous return, never throws.
   * See WORKFLOW_PROGRESS.md §6.2 and §10.2.
   */
  progress?: (current: number, total: number | null, message?: string) => void
  /**
   * AbortSignal tied to the current workflow run. Fires when cancellation is
   * observed at a step boundary. Long-running steps should pass this to I/O
   * (`fetch(url, { signal: ctx.signal })`) or check `.aborted` between work units.
   * See WORKFLOW_PROGRESS.md §6.3.
   */
  signal?: AbortSignal
  /**
   * Ergonomic helper — iterate `items` in batches of `opts.batchSize`, emitting
   * progress after each batch and checking cancel between batches.
   * See WORKFLOW_PROGRESS.md §6.4.
   */
  forEach?: <T>(
    items: T[] | AsyncIterable<T>,
    opts: { batchSize: number; message?: (info: ForEachInfo) => string },
    handler: (batch: T[], info: ForEachInfo) => Promise<void>,
  ) => Promise<void>
  /**
   * Yield the workflow before the serverless host kills this invocation. The
   * framework persists `resumeState` under the current step and enqueues a
   * continuation via `IQueuePort` — when the queue delivers it, the workflow
   * resumes and the step handler is re-invoked with `ctx.resumeState === resumeState`.
   *
   * Throws a non-retryable `WorkflowYield` error that the manager catches
   * before the retry loop, so yielding is NOT a failure and compensation is
   * NOT triggered. Use when a long-running step exceeds a serverless time
   * budget and has an idempotent way to resume from a cursor.
   *
   * The opposite of `throw new MantaError(...)`: pause, don't fail.
   */
  yield?: (resumeState: unknown) => never
  /**
   * Resume state written by a previous invocation's `ctx.yield(state)`.
   * `undefined` on the first call; set to the yielded value on every
   * subsequent invocation of the same step until it completes.
   */
  resumeState?: unknown
  /**
   * Wall-clock budget (ms) allocated to this step by the manager, computed
   * from the serverless function's max duration minus safety margin. Read
   * this to decide when to `yield()` before the host kills the invocation.
   * `Infinity` when no budget is configured (dev / long-running host).
   */
  budgetMs?: number
}

// ---------------------------------------------------------------------------
// Step function — returned by createStep()
// ---------------------------------------------------------------------------

/**
 * A callable step. Call it inside a workflow to execute with checkpointing.
 * Can also be called standalone (without workflow context) for testing.
 */
export type StepFn<TInput = unknown, TOutput = unknown> = (input: TInput, ctx: StepContext) => Promise<TOutput>

// ---------------------------------------------------------------------------
// Workflow definition — returned by createWorkflow()
// ---------------------------------------------------------------------------

export interface WorkflowDefinition<TInput = unknown, TOutput = unknown> {
  name: string
  fn: (input: TInput, ctx: StepContext) => Promise<TOutput>
}

// ---------------------------------------------------------------------------
// Workflow context — internal
// ---------------------------------------------------------------------------

export interface CompletedStep {
  name: string
  output: unknown
  compensate?: (output: unknown, ctx: StepContext) => Promise<void>
}

export interface WorkflowContext {
  transactionId: string
  /**
   * Alias for `transactionId`. `runId` is the forward-looking name used by the
   * durable workflow store and progress-tracking feature (WORKFLOW_PROGRESS.md
   * §5.1). The two strings are identical; `transactionId` is kept for back-compat.
   */
  runId: string
  /** Checkpoints loaded from DB (step name → output) */
  checkpoints: Map<string, unknown>
  /** Steps completed in this run (for compensation) */
  completedSteps: CompletedStep[]
  /** Counter per step name for uniqueness in loops */
  stepCounter: Map<string, number>
  /** Event buffer group ID */
  eventGroupId: string
  /** Buffer an event for deferred emission */
  bufferEvent?: (event: Message) => void
  /** Persist a checkpoint to storage immediately (durable execution) */
  saveCheckpoint?: (stepKey: string, output: unknown) => Promise<void>
  /**
   * Durable run store — set by WorkflowManager when an IWorkflowStorePort is
   * wired. Used by the engine for `updateStep`/`updateStatus` and cancel checks.
   */
  store?: IWorkflowStorePort
  /**
   * Ephemeral progress channel — set by WorkflowManager when an
   * IProgressChannelPort is wired. Used by `ctx.progress` and `ctx.forEach`.
   */
  progressChannel?: IProgressChannelPort
  /**
   * Name of the step currently executing. Set by WorkflowManager immediately
   * before invoking a step handler, cleared after. Read by `ctx.progress` /
   * `ctx.forEach` so progress snapshots are tagged with the right step.
   */
  stepName?: string
  /**
   * AbortSignal from the per-run AbortController. Fires when cancellation is
   * detected at a step boundary (cancel_requested_at set on the run).
   */
  signal?: AbortSignal
  /**
   * Map of stepKey → resumeState persisted by a previous invocation that
   * `ctx.yield(state)`ed. Populated by the manager on resume from
   * `workflow_runs.steps[*].resume_state`. Consumed by createStep / step.action
   * via `ctx.resumeState` on the matching step; `undefined` on first run.
   */
  resumeStates?: Map<string, unknown>
  /**
   * Wall-clock budget (ms) propagated into every step's `ctx.budgetMs`. Set
   * by the WorkflowManager when serverless host timing is known (`Infinity`
   * otherwise). Steps self-yield via `ctx.yield(state)` when the budget is
   * about to expire.
   */
  budgetMs?: number
}

// ---------------------------------------------------------------------------
// Retry policy — internal, not exposed to users
// ---------------------------------------------------------------------------

/** @internal */
export interface RetryPolicy {
  maxAttempts: number
  initialIntervalMs: number
  backoffMultiplier: number
  maxIntervalMs: number
}

/** @internal Framework default: 3 attempts, exponential backoff */
export const RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  initialIntervalMs: 250,
  backoffMultiplier: 2,
  maxIntervalMs: 5000,
}

// ---------------------------------------------------------------------------
// Run options / result
// ---------------------------------------------------------------------------

export interface WorkflowRunOptions {
  input?: Record<string, unknown>
  transactionId?: string
  /** Checkpoint strategy: 'per-step' (default) or 'batched' (writes all at end) */
  checkpointMode?: 'per-step' | 'batched'
  /** Cleanup checkpoints after successful completion (default: true) */
  cleanup?: boolean
}

export interface WorkflowRunResult {
  transaction: {
    transactionId: string
    state: 'done' | 'invoking' | 'failed'
  }
  result?: unknown
}

// ---------------------------------------------------------------------------
// Typed step config types
// ---------------------------------------------------------------------------

/**
 * Configuration for CRUD steps (step.create, step.update, step.delete).
 */
export interface CrudStepConfig {
  entity: string
  serviceSuffix?: string
}

/**
 * Configuration for action steps (step.action).
 * Compensation is REQUIRED.
 */
export interface ActionStepConfig<TInput = unknown, TOutput = unknown> {
  invoke: (input: TInput, ctx: StepContext) => Promise<TOutput>
  compensate: (output: TOutput, ctx: StepContext) => Promise<void>
}

/**
 * WorkflowResult — returned by createWorkflow().run() via WorkflowManager.
 */
export interface WorkflowResult<T = unknown> {
  transaction: { transactionId: string; state: 'done' | 'invoking' | 'failed' }
  result?: T
}

// Internal types for the workflow step engine

export interface StepDefinition {
  name: string
  handler: (ctx: StepHandlerContext) => Promise<unknown>
  compensation?: (ctx: {
    output: Record<string, unknown>
    context: StepResolveContext
    input?: unknown
  }) => Promise<void>
  __compensateInput?: unknown
  __async?: boolean
  __timeout?: number
  __maxRetries?: number
}

export interface StepHandlerContext {
  input: Record<string, unknown>
  previousOutput: Record<string, unknown>
  context: StepResolveContext
}

export interface StepResolveContext {
  resolve<T>(key: string): T
  _bufferEvent?: (event: Message) => void
  transactionId?: string
}
