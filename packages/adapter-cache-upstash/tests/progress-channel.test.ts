// UpstashProgressChannel — unit tests (Redis mocked).
// Verifies key format, TTL, and the fire-and-forget / never-throw invariant
// (WORKFLOW_PROGRESS.md §10.2 invariant #2).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
}

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn(() => mockRedis),
}))

import { UpstashProgressChannel } from '../src/progress-channel'

describe('UpstashProgressChannel', () => {
  let channel: UpstashProgressChannel

  beforeEach(() => {
    vi.clearAllMocks()
    channel = new UpstashProgressChannel({ url: 'https://fake.upstash.io', token: 'fake-token' })
  })

  // PC-UPSTASH-01 — set uses the spec key format and passes TTL 3600.
  it('PC-UPSTASH-01 — set writes to workflow:{runId}:progress with TTL 3600', async () => {
    mockRedis.set.mockResolvedValue('OK')
    const snap = { stepName: 'fetch', current: 10, total: 100, message: 'hi', at: 1700000000000 }

    await channel.set('run-42', snap)

    expect(mockRedis.set).toHaveBeenCalledWith('workflow:run-42:progress', JSON.stringify(snap), { ex: 3600 })
  })

  // PC-UPSTASH-02 — get parses the JSON snapshot; clear issues DEL on the right key.
  it('PC-UPSTASH-02 — get parses JSON, clear issues DEL', async () => {
    const snap = { stepName: 'x', current: 1, total: null, at: 1 }
    mockRedis.get.mockResolvedValue(JSON.stringify(snap))

    const got = await channel.get('run-7')
    expect(mockRedis.get).toHaveBeenCalledWith('workflow:run-7:progress')
    expect(got).toEqual(snap)

    mockRedis.del.mockResolvedValue(1)
    await channel.clear('run-7')
    expect(mockRedis.del).toHaveBeenCalledWith('workflow:run-7:progress')
  })

  // PC-UPSTASH-03 — set MUST NOT throw when the Redis client fails.
  it('PC-UPSTASH-03 — set never throws when Redis fails', async () => {
    mockRedis.set.mockRejectedValue(new Error('Redis down'))
    const snap = { stepName: 'x', current: 1, total: 1, at: 1 }

    await expect(channel.set('run-err', snap)).resolves.toBeUndefined()
  })
})
