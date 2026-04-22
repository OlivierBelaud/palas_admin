// ctx.forEach — ergonomic batching + progress + cancel for iterative steps.
// See WORKFLOW_PROGRESS.md §6.4.
//
// Combines three concerns into one idiom:
// 1. Batch items (array or AsyncIterable) into chunks of `batchSize`.
// 2. Emit a progress snapshot after each batch completes (fire-and-forget).
// 3. Check `ctx.signal` between batches; throw CancelledError if aborted.

import { CancelledError } from './progress-helper'
import type { ForEachInfo, StepContext, WorkflowContext } from './types'

/**
 * Build a `ctx.forEach` function bound to a specific workflow run.
 */
export function createForEach(wfCtx: WorkflowContext): NonNullable<StepContext['forEach']> {
  return async <T>(
    items: T[] | AsyncIterable<T>,
    opts: { batchSize: number; message?: (info: ForEachInfo) => string },
    handler: (batch: T[], info: ForEachInfo) => Promise<void>,
  ): Promise<void> => {
    const isArray = Array.isArray(items)
    const totalKnown: number | null = isArray ? (items as T[]).length : null
    let done = 0
    let batchIndex = 0
    let buffer: T[] = []

    const flush = async (): Promise<void> => {
      if (buffer.length === 0) return
      if (wfCtx.signal?.aborted) throw new CancelledError()
      const info: ForEachInfo = { done, total: totalKnown, batchIndex }
      const batch = buffer
      buffer = []
      await handler(batch, info)
      done += batch.length
      batchIndex += 1
      // Emit progress after the batch completes — fire-and-forget.
      const channel = wfCtx.progressChannel
      if (channel) {
        const stepName = wfCtx.stepName ?? 'unknown'
        const message = opts.message ? safeFormat(opts.message, { done, total: totalKnown, batchIndex }) : undefined
        try {
          const p = channel.set(wfCtx.runId, { stepName, current: done, total: totalKnown, message, at: Date.now() })
          if (p && typeof (p as Promise<unknown>).catch === 'function') {
            ;(p as Promise<unknown>).catch(() => {
              /* swallow — progress is observability */
            })
          }
        } catch {
          /* `.set` is never-throws; belt-and-suspenders */
        }
      }
    }

    // Guard before the very first iteration: if the signal is already aborted,
    // fail immediately without touching items.
    if (wfCtx.signal?.aborted) throw new CancelledError()

    if (isArray) {
      for (const item of items as T[]) {
        buffer.push(item)
        if (buffer.length >= opts.batchSize) await flush()
      }
      await flush()
    } else {
      for await (const item of items as AsyncIterable<T>) {
        buffer.push(item)
        if (buffer.length >= opts.batchSize) await flush()
      }
      await flush()
    }
  }
}

function safeFormat(fn: (info: ForEachInfo) => string, info: ForEachInfo): string | undefined {
  try {
    return fn(info)
  } catch {
    return undefined
  }
}
