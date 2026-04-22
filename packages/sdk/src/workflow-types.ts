// Workflow-related types for the SDK.
// See WORKFLOW_PROGRESS.md §5 (data model), §6.1 (RunResult), §7 (useCommand shape).
//
// These are deliberately duplicated from @manta/core rather than imported, so the
// SDK bundle stays free of server-only dependencies (drizzle-orm, zod, etc.). The
// shapes MUST stay in sync with packages/core/src/ports/workflow-store.ts and
// packages/core/src/ports/progress-channel.ts.

import type { MantaSDKError } from './client'

/** Overall workflow run status — matches core `WorkflowStatus`. */
export type WorkflowStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** Per-step status — matches core `StepStatus`. */
export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'compensated'

/** Step state as returned by `GET /_workflow/:id` — matches core `StepState`. */
export interface StepState {
  name: string
  status: StepStatus
  started_at?: string
  completed_at?: string
  error?: { message: string; code?: string }
}

/** In-flight progress snapshot from the Redis liveness channel. */
export interface ProgressSnapshot {
  stepName: string
  current: number
  total: number | null
  message?: string
  at: number
}

/** Workflow error payload (JSON-serialised — not a MantaError instance). */
export interface WorkflowError {
  message: string
  code?: string
  stack?: string
}

/**
 * Full snapshot returned by `GET /api/admin/_workflow/:id`.
 * See packages/cli/src/bootstrap/phases/wire/wire-workflow-routes.ts for the
 * authoritative server shape.
 */
export interface WorkflowRunSnapshot {
  id: string
  command_name: string
  status: WorkflowStatus
  steps: StepState[]
  inFlightProgress?: ProgressSnapshot
  output?: unknown
  error?: WorkflowError
  started_at?: string
  completed_at?: string
  cancel_requested_at?: string
}

/**
 * Result returned by `useCommand().run(input)`.
 * Three cases, matching WORKFLOW_PROGRESS.md §6.1:
 *  - `succeeded` — workflow finished within the 300ms inline window.
 *  - `failed`    — workflow failed within the 300ms inline window.
 *  - `running`   — workflow is still running; use `runId` to poll.
 */
export type RunResult<T> =
  | { status: 'succeeded'; result: T; runId?: string }
  | { status: 'failed'; error: MantaSDKError }
  | { status: 'running'; runId: string }

/** Hook-local status — superset of `WorkflowStatus` plus `idle`. */
export type UseCommandStatus = 'idle' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/**
 * Return shape of `useCommand` — see WORKFLOW_PROGRESS.md §7.
 *
 * The primary API is `{ run, runId, status, steps, progress, result, error, cancel }`.
 *
 * Back-compat aliases (`mutateAsync`, `mutate`, `isPending`, `isSuccess`, `isError`,
 * `reset`, `data`) preserve the shape of the pre-PR-4 React-Query mutation so
 * existing call sites continue to work. New code should use the primary API.
 */
export interface UseCommandResult<TInput, TOutput> {
  // ── Primary API ────────────────────────────────────────
  run: (input: TInput) => Promise<RunResult<TOutput>>
  runId: string | undefined
  status: UseCommandStatus
  steps: StepState[] | undefined
  progress: ProgressSnapshot | undefined
  result: TOutput | undefined
  error: MantaSDKError | WorkflowError | undefined
  cancel: () => Promise<void>

  // ── Back-compat aliases (deprecated but functional) ────
  /**
   * Awaits the initial HTTP response only. On inline success, resolves with
   * `result`. On inline failure, throws the `MantaSDKError`. On async response
   * (`status: 'running'`), resolves with `undefined` and emits a dev-warning —
   * migrate such call sites to the new `run()` + `runId` API.
   */
  mutateAsync: (input: TInput) => Promise<TOutput | undefined>
  /** Fire-and-forget variant of `run()`. Ignores errors. */
  mutate: (input: TInput) => void
  isPending: boolean
  isSuccess: boolean
  isError: boolean
  /** Resets the hook to its idle state. */
  reset: () => void
  /** Alias for `result`. */
  data: TOutput | undefined
}

/** Terminal states — polling stops once any of these is reached. */
export function isTerminalStatus(status: UseCommandStatus | WorkflowStatus | undefined): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}
