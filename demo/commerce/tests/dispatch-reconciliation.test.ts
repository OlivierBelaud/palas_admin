import { describe, expect, it } from 'vitest'
import {
  ensureMissingDestinationDispatchLogs,
  type RawDispatchDb,
} from '../src/modules/event-hub/dispatch-runner'

function canonicalRow() {
  return {
    event_id: 'evt_missing_dispatch',
    event_name: 'purchase',
    source_event_name: 'checkout:completed',
    received_at: '2026-07-20T10:00:00.000Z',
    payload_normalized: {
      event_id: 'evt_missing_dispatch',
      event_time: '2026-07-20T10:00:00.000Z',
      validation: {
        destinations: {
          meta_capi: { supported: true, ready: true },
        },
      },
    },
  }
}

describe('Event Hub dispatch reconciliation', () => {
  it('recreates a missing destination row with the durable event key', async () => {
    const writes: Array<{ query: string; params?: unknown[] }> = []
    const db: RawDispatchDb = {
      raw: async <T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]> => {
        if (query.trim().startsWith('SELECT')) return [canonicalRow()] as T[]
        writes.push({ query, params })
        return [{ id: 'dispatch_1' }] as T[]
      },
    }

    const result = await ensureMissingDestinationDispatchLogs({
      db,
      destination: 'meta_capi',
      map: () => ({
        supported: true,
        ok: true,
        payload: { data: [{ event_id: 'evt_missing_dispatch' }] },
        metadata: { event_id: 'evt_missing_dispatch' },
      }),
    })

    expect(result).toEqual({ scanned: 1, inserted: 1, invalid: 0 })
    expect(writes[0].params).toEqual(
      expect.arrayContaining(['evt_missing_dispatch:meta_capi', 'evt_missing_dispatch', 'meta_capi', 'pending']),
    )
    expect(writes[0].query).toContain('ON CONFLICT (event_destination_key) DO NOTHING')
    expect(writes[0].query).toContain('RETURNING id')
  })

  it('is a no-op when another reconciler already inserted the destination row', async () => {
    const db: RawDispatchDb = {
      raw: async <T = Record<string, unknown>>(query: string): Promise<T[]> => {
        if (query.trim().startsWith('SELECT')) return [canonicalRow()] as T[]
        return [] as T[]
      },
    }

    const result = await ensureMissingDestinationDispatchLogs({
      db,
      destination: 'meta_capi',
      map: () => ({
        supported: true,
        ok: true,
        payload: { data: [{ event_id: 'evt_missing_dispatch' }] },
        metadata: {},
      }),
    })

    expect(result).toEqual({ scanned: 1, inserted: 0, invalid: 0 })
  })

  it('keeps an ineligible provider mapping terminal and auditable', async () => {
    const writes: Array<{ params?: unknown[] }> = []
    const db: RawDispatchDb = {
      raw: async <T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]> => {
        if (query.trim().startsWith('SELECT')) return [canonicalRow()] as T[]
        writes.push({ params })
        return [{ id: 'dispatch_invalid' }] as T[]
      },
    }

    const result = await ensureMissingDestinationDispatchLogs({
      db,
      destination: 'meta_capi',
      map: () => ({
        supported: true,
        ok: false,
        errors: ['meta_capi_ad_storage_consent_not_granted'],
        payload: {},
        metadata: { consent: false },
      }),
    })

    expect(result).toEqual({ scanned: 1, inserted: 1, invalid: 1 })
    expect(writes[0].params).toEqual(
      expect.arrayContaining(['invalid', 'meta_capi_ad_storage_consent_not_granted']),
    )
  })
})
