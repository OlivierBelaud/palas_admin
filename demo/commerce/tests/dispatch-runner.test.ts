import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DestinationConnector } from '../src/modules/event-hub/destination-connector'
import {
  flushDestinationDispatches,
  flushDispatchLogByEventDestinationKey,
  type RawDispatchDb,
} from '../src/modules/event-hub/dispatch-runner'

function makeDb(rows: Array<Record<string, unknown>>) {
  const selects: Array<{ query: string; params?: unknown[] }> = []
  const updates: Array<{ query: string; params?: unknown[] }> = []
  const db: RawDispatchDb = {
    raw: async <T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]> => {
      if (query.trim().startsWith('SELECT')) {
        selects.push({ query, params })
        return rows as T[]
      }
      updates.push({ query, params })
      return (query.includes('RETURNING id') ? [{ id: params?.[0] }] : []) as T[]
    },
  }
  return { db, updates, selects }
}

function connector(overrides: Partial<DestinationConnector> = {}): DestinationConnector {
  return {
    destination: 'ga4',
    pendingStatuses: ['pending', 'retry', 'not_configured'],
    notConfiguredErrorCode: 'ga4_not_configured',
    notConfiguredMessage: 'Set GA4 env vars',
    isConfigured: () => true,
    send: async () => ({
      status: 'sent',
      http_status: 204,
      error_code: null,
      error_message: null,
      response_payload: null,
    }),
    ...overrides,
  }
}

describe('Event Hub dispatch runner', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('marks malformed dispatch payloads invalid before sending', async () => {
    const { db, updates } = makeDb([
      {
        id: 'row_1',
        event_id: 'evt_1',
        canonical_event_name: 'purchase',
        status: 'pending',
        attempt_count: 0,
        request_payload: '{bad',
      },
    ])

    const result = await flushDestinationDispatches({ db, connector: connector(), batchLimit: 10 })

    expect(result).toMatchObject({ scanned: 1, invalid: 1, sent: 0 })
    expect(updates[0].params).toEqual(['row_1', 1, 0, ['pending', 'retry', 'not_configured']])
    expect(updates[1].params).toEqual([
      'row_1',
      'ga4_payload_missing',
      'ga4 request_payload is empty or invalid JSON',
      1,
    ])
  })

  it('keeps pending rows in not_configured until connector config is present', async () => {
    const { db, updates } = makeDb([
      {
        id: 'row_1',
        event_id: 'evt_1',
        canonical_event_name: 'purchase',
        status: 'pending',
        attempt_count: 2,
        request_payload: { ok: true },
      },
    ])

    const result = await flushDestinationDispatches({
      db,
      connector: connector({ isConfigured: () => false }),
      batchLimit: 10,
    })

    expect(result).toMatchObject({ scanned: 1, not_configured: 1, configured: false })
    expect(updates[0].params).toEqual(['row_1', 3, 2, ['pending', 'retry', 'not_configured']])
    expect(updates[1].params).toEqual(['row_1', 'ga4_not_configured', 'Set GA4 env vars', 3])
  })

  it('persists connector delivery results with retry backoff', async () => {
    const { db, updates } = makeDb([
      {
        id: 'row_1',
        event_id: 'evt_1',
        canonical_event_name: 'purchase',
        status: 'pending',
        attempt_count: 1,
        request_payload: { ok: true },
      },
    ])

    const result = await flushDestinationDispatches({
      db,
      connector: connector({
        send: async () => ({
          status: 'retry',
          http_status: 429,
          error_code: 'rate_limited',
          error_message: 'Too many requests',
          response_payload: { error: 'rate_limited' },
        }),
      }),
      batchLimit: 10,
    })

    expect(result).toMatchObject({ scanned: 1, retry: 1 })
    expect(updates[0].params).toEqual(['row_1', 2, 1, ['pending', 'retry', 'not_configured']])
    expect(updates[1].params).toEqual([
      'row_1',
      'retry',
      429,
      'rate_limited',
      'Too many requests',
      JSON.stringify({ error: 'rate_limited' }),
      2,
      2,
    ])
    expect(updates[1].query).toContain("status = 'sending'")
    expect(updates[1].query).toContain('attempt_count = $8')
  })

  it('flushes a specific live dispatch row by event destination key', async () => {
    const { db, updates } = makeDb([
      {
        id: 'row_live',
        event_id: 'evt_live',
        canonical_event_name: 'page_view',
        status: 'pending',
        attempt_count: 0,
        request_payload: { client_id: 'muid_1', events: [{ name: 'page_view', params: {} }] },
      },
    ])

    const result = await flushDispatchLogByEventDestinationKey({
      db,
      connector: connector(),
      eventDestinationKey: 'evt_live:ga4',
    })

    expect(result).toMatchObject({ scanned: 1, sent: 1, configured: true })
    expect(updates[0].params).toEqual(['row_live', 1, 0, ['pending', 'retry', 'not_configured']])
    expect(updates[1].params).toEqual(['row_live', 'sent', 204, null, null, JSON.stringify({}), null, 1])
  })

  it('recovers stale sending rows during scheduled flushes', async () => {
    const { db, selects } = makeDb([])

    await flushDestinationDispatches({ db, connector: connector(), batchLimit: 10 })

    expect(selects[0].query).toContain("status = 'sending'")
    expect(selects[0].query).toContain("last_attempt_at <= NOW() - INTERVAL '2 minutes'")
  })

  it('does not call the provider when another worker already claimed the row', async () => {
    const send = vi.fn(async () => ({
      status: 'sent' as const,
      http_status: 204,
      error_code: null,
      error_message: null,
      response_payload: null,
    }))
    const db: RawDispatchDb = {
      raw: async <T = Record<string, unknown>>(query: string): Promise<T[]> => {
        if (query.trim().startsWith('SELECT')) {
          return [
            {
              id: 'row_raced',
              event_id: 'evt_raced',
              canonical_event_name: 'purchase',
              status: 'pending',
              attempt_count: 0,
              request_payload: { ok: true },
            },
          ] as T[]
        }
        return [] as T[]
      },
    }

    const result = await flushDestinationDispatches({
      db,
      connector: connector({ send }),
      batchLimit: 10,
    })

    expect(send).not.toHaveBeenCalled()
    expect(result).toMatchObject({ scanned: 1, sent: 0, claim_conflict: 1 })
  })

  it('persists thrown connector failures as retryable without losing the durable row', async () => {
    const { db, updates } = makeDb([
      {
        id: 'row_throw',
        event_id: 'evt_throw',
        canonical_event_name: 'purchase',
        status: 'pending',
        attempt_count: 0,
        request_payload: { ok: true },
      },
    ])

    const result = await flushDestinationDispatches({
      db,
      connector: connector({
        send: async () => {
          throw new Error('socket reset while sending')
        },
      }),
      batchLimit: 10,
    })

    expect(result).toMatchObject({ scanned: 1, retry: 1, error: 0 })
    expect(updates[1].params).toEqual([
      'row_throw',
      'retry',
      null,
      'ga4_connector_exception',
      'socket reset while sending',
      JSON.stringify({}),
      1,
      1,
    ])
  })

  it('aborts a slow provider before the sending lease can be reclaimed', async () => {
    vi.useFakeTimers()
    const { db, updates } = makeDb([
      {
        id: 'row_slow',
        event_id: 'evt_slow',
        canonical_event_name: 'purchase',
        status: 'pending',
        attempt_count: 0,
        request_payload: { ok: true },
      },
    ])
    const send = vi.fn(
      async (_payload: Record<string, unknown>, signal?: AbortSignal) =>
        new Promise<never>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    )

    const flush = flushDestinationDispatches({
      db,
      connector: connector({ send }),
      batchLimit: 10,
    })
    await vi.advanceTimersByTimeAsync(90_000)

    await expect(flush).resolves.toMatchObject({ scanned: 1, retry: 1, sent: 0 })
    expect(send).toHaveBeenCalledTimes(1)
    expect(updates[1].params).toEqual([
      'row_slow',
      'retry',
      null,
      'ga4_connector_exception',
      'ga4 provider request exceeded dispatch lease',
      JSON.stringify({}),
      1,
      1,
    ])
  })
})
