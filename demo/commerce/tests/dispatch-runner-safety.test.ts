import { describe, expect, it, vi } from 'vitest'
import type { DestinationConnector } from '../src/modules/event-hub/destination-connector'
import { repairUnpreparedDispatches } from '../src/modules/event-hub/dispatch-repair'
import { flushDestinationDispatches } from '../src/modules/event-hub/dispatch-runner'

const connector = (
  send = vi.fn(async () => {
    throw new Error('network down')
  }),
): DestinationConnector => ({
  destination: 'ga4',
  pendingStatuses: ['pending', 'retry', 'not_configured'],
  notConfiguredErrorCode: 'disabled',
  notConfiguredMessage: 'disabled',
  isConfigured: () => true,
  send,
})
describe('durable dispatch safety', () => {
  it('does no database work when disabled', async () => {
    const raw = vi.fn()
    const c = connector()
    c.isConfigured = () => false
    expect(await flushDestinationDispatches({ db: { raw }, connector: c, batchLimit: 10 })).toMatchObject({
      scanned: 0,
      configured: false,
    })
    expect(await repairUnpreparedDispatches({ raw }, c)).toEqual({ scanned: 0, inserted: 0 })
    expect(raw).not.toHaveBeenCalled()
  })
  it('persists thrown transport exceptions as retry after an atomic claim', async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'one', attempt_count: 0 }])
      .mockResolvedValueOnce([{ id: 'one', attempt_count: 1, request_payload: { events: [] } }])
      .mockResolvedValueOnce([{ id: 'one' }])
    expect(await flushDestinationDispatches({ db: { raw }, connector: connector(), batchLimit: 10 })).toMatchObject({
      retry: 1,
    })
    expect(raw.mock.calls[1][0]).toContain('RETURNING')
    expect(raw.mock.calls[2][0]).toContain('attempt_count = $8')
    expect(raw.mock.calls[2][1][1]).toBe('retry')
  })
  it('does not send if another worker claimed the candidate', async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'one', attempt_count: 0 }])
      .mockResolvedValueOnce([])
    const c = connector()
    await flushDestinationDispatches({ db: { raw }, connector: c, batchLimit: 10 })
    expect(c.send).not.toHaveBeenCalled()
  })
  it('times out hung transport before the stale-claim lease and keeps a retry', async () => {
    vi.useFakeTimers()
    try {
      const raw = vi
        .fn()
        .mockResolvedValueOnce([{ id: 'one', attempt_count: 0 }])
        .mockResolvedValueOnce([{ id: 'one', attempt_count: 1, request_payload: {} }])
        .mockResolvedValueOnce([{ id: 'one' }])
      const c = connector()
      c.send = async () => new Promise(() => {})
      const result = flushDestinationDispatches({ db: { raw }, connector: c, batchLimit: 10 })
      await vi.advanceTimersByTimeAsync(90_000)
      expect(await result).toMatchObject({ retry: 1 })
    } finally {
      vi.useRealTimers()
    }
  })
})
