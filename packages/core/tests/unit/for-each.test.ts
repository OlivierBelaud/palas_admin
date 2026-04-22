// W-CTX — ctx.forEach unit tests.
// See WORKFLOW_PROGRESS.md §6.4.

import type { IProgressChannelPort, ProgressSnapshot, WorkflowContext } from '@manta/core'
import { CancelledError, createForEach } from '@manta/core'
import { describe, expect, it } from 'vitest'

class StubChannel implements IProgressChannelPort {
  snapshots: Array<{ runId: string; snap: ProgressSnapshot }> = []
  async set(runId: string, snap: ProgressSnapshot): Promise<void> {
    this.snapshots.push({ runId, snap })
  }
  async get(_runId: string): Promise<ProgressSnapshot | null> {
    return null
  }
  async clear(_runId: string): Promise<void> {}
}

function makeWfCtx(
  overrides?: Partial<WorkflowContext> & { channel?: IProgressChannelPort; signal?: AbortSignal },
): WorkflowContext {
  return {
    transactionId: 'tx_1',
    runId: 'tx_1',
    checkpoints: new Map(),
    completedSteps: [],
    stepCounter: new Map(),
    eventGroupId: 'wf:tx_1',
    stepName: 'import',
    progressChannel: overrides?.channel,
    signal: overrides?.signal,
    ...overrides,
  }
}

describe('ctx.forEach', () => {
  // W-CTX-01 — batches arrays correctly
  it('W-CTX-01 — forEach on array batches correctly (10 items, batchSize 3 → 4 handler calls)', async () => {
    const wf = makeWfCtx()
    const forEach = createForEach(wf)
    const batches: number[][] = []
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

    await forEach(items, { batchSize: 3 }, async (batch) => {
      batches.push([...batch])
    })

    expect(batches).toHaveLength(4)
    expect(batches[0]).toEqual([1, 2, 3])
    expect(batches[1]).toEqual([4, 5, 6])
    expect(batches[2]).toEqual([7, 8, 9])
    expect(batches[3]).toEqual([10])
  })

  // W-CTX-02 — batches AsyncIterables correctly
  it('W-CTX-02 — forEach on AsyncIterable batches correctly (7 items, batchSize 3 → 3 handler calls)', async () => {
    const wf = makeWfCtx()
    const forEach = createForEach(wf)
    const batches: number[][] = []

    async function* gen(): AsyncIterable<number> {
      for (let i = 1; i <= 7; i++) yield i
    }

    await forEach(gen(), { batchSize: 3 }, async (batch) => {
      batches.push([...batch])
    })

    expect(batches).toHaveLength(3)
    expect(batches[0]).toEqual([1, 2, 3])
    expect(batches[1]).toEqual([4, 5, 6])
    expect(batches[2]).toEqual([7])
  })

  // W-CTX-03 — emits progress after each batch
  it('W-CTX-03 — forEach emits progress after each batch', async () => {
    const channel = new StubChannel()
    const wf = makeWfCtx({ channel })
    const forEach = createForEach(wf)
    const items = [1, 2, 3, 4, 5]

    await forEach(items, { batchSize: 2, message: (info) => `done ${info.done}` }, async () => {
      /* noop */
    })

    // 3 batches: [1,2], [3,4], [5] → 3 progress snapshots
    expect(channel.snapshots).toHaveLength(3)
    expect(channel.snapshots[0].snap).toMatchObject({
      stepName: 'import',
      current: 2,
      total: 5,
    })
    expect(channel.snapshots[1].snap.current).toBe(4)
    expect(channel.snapshots[2].snap.current).toBe(5)
    // message was formatted
    expect(channel.snapshots[0].snap.message).toBe('done 2')
  })

  // W-CTX-04 — aborts between batches when signal fires
  it('W-CTX-04 — forEach aborts between batches when signal fires', async () => {
    const controller = new AbortController()
    const wf = makeWfCtx({ signal: controller.signal })
    const forEach = createForEach(wf)

    const items = [1, 2, 3, 4, 5, 6]
    const seen: number[] = []

    const promise = forEach(items, { batchSize: 2 }, async (batch) => {
      seen.push(...batch)
      // Abort after the first batch completes
      if (seen.length === 2) controller.abort()
    })

    await expect(promise).rejects.toBeInstanceOf(CancelledError)
    // First batch processed, second batch never dispatched
    expect(seen).toEqual([1, 2])
  })

  // W-CTX-05 — aborts immediately when signal already fired
  it('W-CTX-05 — forEach aborts immediately when signal already fired before first batch', async () => {
    const controller = new AbortController()
    controller.abort()
    const wf = makeWfCtx({ signal: controller.signal })
    const forEach = createForEach(wf)

    const items = [1, 2, 3]
    const seen: number[] = []

    const promise = forEach(items, { batchSize: 2 }, async (batch) => {
      seen.push(...batch)
    })

    await expect(promise).rejects.toBeInstanceOf(CancelledError)
    expect(seen).toEqual([])
  })
})
