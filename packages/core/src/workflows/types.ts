// Workflow types — imperative async-first API

import type { MantaApp } from '../app'
import type { Message } from '../events/types'

// ---------------------------------------------------------------------------
// Step context — passed as 2nd arg to step handlers
// ---------------------------------------------------------------------------

/**
 * Context available inside step invoke and compensate functions.
 */
export interface StepContext {
  app: MantaApp
  /** @internal Workflow context — set by WorkflowManager, used by createStep */
  __wfCtx?: WorkflowContext
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
// Legacy types — kept for backward compatibility during transition
// ---------------------------------------------------------------------------

/** @deprecated Use plain return values instead */
export class StepResponse<TOutput = unknown, TCompensateInput = unknown> {
  readonly __type = 'StepResponse' as const
  readonly output: TOutput
  readonly compensateInput: TCompensateInput | undefined

  constructor(output: TOutput, compensateInput?: TCompensateInput) {
    this.output = output
    this.compensateInput = compensateInput
  }
}

/** @deprecated Workflows return plain values now */
export class WorkflowResponse<TResult = unknown> {
  readonly __type = 'WorkflowResponse' as const
  readonly result: TResult

  constructor(result: TResult) {
    this.result = result
  }
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

// Legacy internal types (used by old DAG-style WorkflowManager)

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

/** @deprecated Use StepContext */
export interface StepExecutionContext {
  app: MantaApp
  __bufferEvent?: (event: Message) => void
}
