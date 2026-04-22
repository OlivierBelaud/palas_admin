// InMemoryProgressChannel — unit tests.
// Backs the test-only path of IProgressChannelPort (WORKFLOW_PROGRESS.md §9.2).

import { InMemoryProgressChannel } from '@manta/core'
import { describe, expect, it } from 'vitest'

describe('InMemoryProgressChannel', () => {
  // PC-MEM-01 — set + get roundtrip
  it('PC-MEM-01 — set + get returns the latest snapshot', async () => {
    const channel = new InMemoryProgressChannel()
    const snap = { stepName: 'import', current: 5, total: 10, at: 1700000000000 }

    await channel.set('run-1', snap)
    const got = await channel.get('run-1')

    expect(got).toEqual(snap)
  })

  // PC-MEM-02 — clear removes the snapshot
  it('PC-MEM-02 — clear removes the stored snapshot', async () => {
    const channel = new InMemoryProgressChannel()
    await channel.set('run-2', { stepName: 'x', current: 1, total: 2, at: 1 })

    await channel.clear('run-2')

    expect(await channel.get('run-2')).toBeNull()
  })

  // PC-MEM-03 — get for an unknown runId returns null
  it('PC-MEM-03 — get returns null when no snapshot exists', async () => {
    const channel = new InMemoryProgressChannel()
    expect(await channel.get('nonexistent')).toBeNull()
  })
})
