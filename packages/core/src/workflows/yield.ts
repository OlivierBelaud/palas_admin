// WorkflowYield — non-error control-flow exception used by `ctx.yield(state)`
// to pause a workflow mid-step before the serverless host kills the invocation.
//
// Contrast with CancelledError + MantaError:
//   - MantaError / plain throw → workflow failed, compensation runs, retry may trigger
//   - CancelledError          → workflow cancelled by user, compensation runs
//   - WorkflowYield            → workflow paused, NO compensation, resume scheduled
//
// The manager catches this BEFORE the retry+compensation loop (manager.ts),
// persists `resumeState` under the current step, moves the run to status
// `'paused'`, and asks the configured `IQueuePort` to schedule a continuation
// via `POST /api/<ctx>/_workflow/:runId/resume`.

export class WorkflowYield extends Error {
  readonly name = 'WorkflowYield'

  constructor(public readonly resumeState: unknown) {
    super('workflow yielded — scheduled for continuation')
  }
}

/**
 * Type guard for WorkflowYield. Checks `name === 'WorkflowYield'` rather than
 * `instanceof` so it works across module-graph duplicates (e.g. when core is
 * loaded twice under pnpm workspace + Nitro inlining).
 */
export function isWorkflowYield(err: unknown): err is WorkflowYield {
  return err !== null && typeof err === 'object' && (err as { name?: string }).name === 'WorkflowYield'
}
