// ctx.progress — fire-and-forget progress reporting for workflow steps.
// See WORKFLOW_PROGRESS.md §6.2 and §10.2.
//
// Invariants:
// 1. Synchronous return — never awaited on the hot path.
// 2. Never throws — channel errors are logged and swallowed.
// 3. No throttle — the channel adapter copes with volume.

import { MantaError } from '../errors/manta-error'
import type { WorkflowContext } from './types'

/**
 * CancelledError — thrown by step handlers (and by `ctx.forEach`) when the
 * workflow's AbortSignal has fired. Caught by the engine to trigger the
 * `cancelled` status path + compensation (WORKFLOW_PROGRESS.md §10.1 step 6).
 */
export class CancelledError extends MantaError {
  constructor(message = 'Workflow cancelled') {
    super('CONFLICT', message, { code: 'WORKFLOW_CANCELLED' })
    this.name = 'CancelledError'
  }
}

/**
 * Build a `ctx.progress` function bound to a specific workflow run.
 * If no IProgressChannelPort is wired, the returned function is a no-op.
 *
 * The returned function:
 * - Returns `undefined` synchronously (no await on the hot path).
 * - Never throws — channel errors are swallowed (optionally logged).
 */
export function createProgress(
  wfCtx: WorkflowContext,
): (current: number, total: number | null, message?: string) => void {
  return (current, total, message) => {
    const channel = wfCtx.progressChannel
    if (!channel) return
    const stepName = wfCtx.stepName ?? 'unknown'
    try {
      const p = channel.set(wfCtx.runId, { stepName, current, total, message, at: Date.now() })
      if (p && typeof (p as Promise<unknown>).catch === 'function') {
        ;(p as Promise<unknown>).catch(() => {
          // Progress is observability, not correctness — swallow.
        })
      }
    } catch {
      // `.set` is spec'd never to throw, but we belt-and-suspenders it anyway.
    }
  }
}
