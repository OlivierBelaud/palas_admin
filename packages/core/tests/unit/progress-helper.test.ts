// W-PROG — ctx.progress unit tests.
// See WORKFLOW_PROGRESS.md §6.2 and §10.2.

import type { IProgressChannelPort, ProgressSnapshot, WorkflowContext } from '@manta/core'
import { createProgress } from '@manta/core'
import { describe, expect, it, vi } from 'vitest'

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

function makeWfCtx(channel?: IProgressChannelPort, stepName = 'import'): WorkflowContext {
  return {
    transactionId: 'tx_1',
    runId: 'tx_1',
    checkpoints: new Map(),
    completedSteps: [],
    stepCounter: new Map(),
    eventGroupId: 'wf:tx_1',
    stepName,
    progressChannel: channel,
  }
}

describe('ctx.progress', () => {
  // W-PROG-01 — synchronous return
  it('W-PROG-01 — progress is synchronous, returns undefined immediately', () => {
    const channel = new StubChannel()
    const wf = makeWfCtx(channel)
    const progress = createProgress(wf)

    const ret = progress(5, 10, 'hello')

    // Returns undefined synchronously (no Promise)
    expect(ret).toBeUndefined()
  })

  // W-PROG-02 — correct payload
  it('W-PROG-02 — progress calls channel.set with correct payload', async () => {
    const channel = new StubChannel()
    const wf = makeWfCtx(channel, 'import-products')
    const progress = createProgress(wf)

    const before = Date.now()
    progress(3, 10, 'processing')
    // Wait a microtask so the fire-and-forget `.set` resolves.
    await new Promise((r) => setImmediate(r))
    const after = Date.now()

    expect(channel.snapshots).toHaveLength(1)
    const { runId, snap } = channel.snapshots[0]
    expect(runId).toBe('tx_1')
    expect(snap.stepName).toBe('import-products')
    expect(snap.current).toBe(3)
    expect(snap.total).toBe(10)
    expect(snap.message).toBe('processing')
    expect(snap.at).toBeGreaterThanOrEqual(before)
    expect(snap.at).toBeLessThanOrEqual(after)
  })

  // W-PROG-03 — never throws when channel.set rejects
  it('W-PROG-03 — progress never throws when channel.set rejects', async () => {
    const brokenChannel: IProgressChannelPort = {
      set: vi.fn().mockRejectedValue(new Error('redis down')),
      get: async () => null,
      clear: async () => {},
    }
    const wf = makeWfCtx(brokenChannel)
    const progress = createProgress(wf)

    // Must NOT throw — fire and forget.
    expect(() => progress(1, 2)).not.toThrow()

    // Flush microtasks so unhandled rejections surface if any slipped past.
    await new Promise((r) => setImmediate(r))
  })

  // W-PROG-04 — no-op when no channel is present
  it('W-PROG-04 — progress with no channel is a no-op', () => {
    const wf = makeWfCtx(undefined)
    const progress = createProgress(wf)

    expect(() => progress(1, 2, 'hi')).not.toThrow()
    expect(progress(1, 2, 'hi')).toBeUndefined()
  })
})
