// CRM-V1-Phase-2A — Visitor identify resolver (multichannel).
//
// The route itself only adds CORS + Redis caching on top of these helpers,
// so we drive the helpers directly with mocked module + global fetch.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signContactToken } from '../src/utils/manta-uid'
import {
  buildPayloadFromContact,
  type ContactModuleLike,
  resolveByDistinctId,
  resolveByKlaviyoExchangeId,
  resolveByMantaUidToken,
} from '../src/utils/visitor-resolver'

interface ContactRow {
  email: string
  distinct_id?: string | null
}

interface OrderRow {
  email: string
  status: string | null
  placed_at: Date | string | null
}

interface ExchangeRow {
  exchange_id: string
  email: string
}

function makeModule(opts?: {
  contacts?: ContactRow[]
  orders?: OrderRow[]
  exchanges?: ExchangeRow[]
}): ContactModuleLike & { _exchanges: ExchangeRow[] } {
  const contacts = opts?.contacts ?? []
  const orders = opts?.orders ?? []
  const exchanges = opts?.exchanges ?? []
  return {
    listContacts: vi.fn(async (filters: Record<string, unknown>) =>
      contacts.filter((c) =>
        Object.entries(filters).every(([k, v]) => (c as unknown as Record<string, unknown>)[k] === v),
      ),
    ),
    listOrders: vi.fn(async (filters: Record<string, unknown>) =>
      orders.filter((o) =>
        Object.entries(filters).every(([k, v]) => (o as unknown as Record<string, unknown>)[k] === v),
      ),
    ),
    listKlaviyoExchangeResolveds: vi.fn(async (filters: Record<string, unknown>) =>
      exchanges.filter((e) =>
        Object.entries(filters).every(([k, v]) => (e as unknown as Record<string, unknown>)[k] === v),
      ),
    ),
    createKlaviyoExchangeResolveds: vi.fn(async (data: Record<string, unknown>) => {
      exchanges.push({ exchange_id: data.exchange_id as string, email: data.email as string })
      return data
    }),
    _exchanges: exchanges,
  }
}

describe('buildPayloadFromContact', () => {
  it('returns tier "a" when no contact is found', () => {
    const p = buildPayloadFromContact(null)
    expect(p.t).toBe('a')
    expect(p.n).toBeUndefined()
    expect(p.o).toBeUndefined()
  })

  it('returns tier "l" (lead) when contact has zero orders', () => {
    const p = buildPayloadFromContact({ email: 'x@y.z' }, [])
    expect(p.t).toBe('l')
    expect(p.n).toBeUndefined()
    expect(p.o).toBeUndefined()
  })

  it('returns tier "c" (customer) with order count + last order date from live orders', () => {
    const p = buildPayloadFromContact({ email: 'x@y.z' }, [
      { email: 'x@y.z', status: 'paid', placed_at: new Date('2025-11-01T10:00:00Z') },
      { email: 'x@y.z', status: 'fulfilled', placed_at: new Date('2025-12-01T10:00:00Z') },
      { email: 'x@y.z', status: 'cancelled', placed_at: new Date('2026-01-01T10:00:00Z') },
    ])
    expect(p.t).toBe('c')
    expect(p.n).toBe(2)
    expect(p.o).toBe(20251201)
  })

  it('codifies placed_at when stored as ISO string (DB row shape)', () => {
    const p = buildPayloadFromContact({ email: 'x@y.z' }, [
      { email: 'x@y.z', status: 'paid', placed_at: '2026-01-15T00:00:00Z' },
    ])
    expect(p.t).toBe('c')
    expect(p.o).toBe(20260115)
  })
})

describe('resolveByKlaviyoExchangeId', () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.KLAVIYO_API_KEY

  beforeEach(() => {
    process.env.KLAVIYO_API_KEY = 'pk_test'
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    process.env.KLAVIYO_API_KEY = originalKey
  })

  it('hits the DB cache (klaviyo_exchange_resolved) — no Klaviyo API call', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: { attributes: {} } }) }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const mod = makeModule({
      exchanges: [{ exchange_id: 'KX-1', email: 'jane@example.com' }],
      contacts: [{ email: 'jane@example.com' }],
      orders: [
        { email: 'jane@example.com', status: 'paid', placed_at: new Date('2025-10-10T00:00:00Z') },
        { email: 'jane@example.com', status: 'fulfilled', placed_at: new Date('2025-11-10T00:00:00Z') },
      ],
    })

    const { payload } = await resolveByKlaviyoExchangeId(mod, 'KX-1')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(payload.t).toBe('c')
    expect(payload.n).toBe(2)
    expect(payload.o).toBe(20251110)
  })

  it('falls back to the Klaviyo API on cache miss + persists the resolution', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { attributes: { email: 'NewUser@Example.com' } } }),
    }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const mod = makeModule({
      contacts: [{ email: 'newuser@example.com' }],
    })

    const { payload, transient } = await resolveByKlaviyoExchangeId(mod, 'KX-2')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mod.createKlaviyoExchangeResolveds).toHaveBeenCalledTimes(1)
    const created = (mod.createKlaviyoExchangeResolveds as unknown as { mock: { calls: [Record<string, unknown>][] } })
      .mock.calls[0][0]
    expect(created.exchange_id).toBe('KX-2')
    expect(created.email).toBe('newuser@example.com') // lowercased
    expect(payload.t).toBe('l') // identified, no orders -> lead
    expect(transient).toBe(false)
  })

  it('returns transient anonymous when Klaviyo API fails', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500 })) as unknown as typeof fetch

    const mod = makeModule()
    const { payload, transient } = await resolveByKlaviyoExchangeId(mod, 'KX-broken')

    expect(payload.t).toBe('a')
    expect(transient).toBe(true)
    expect(mod.createKlaviyoExchangeResolveds).not.toHaveBeenCalled()
  })

  it('returns anonymous (non-transient) when Klaviyo says profile is not yet identified', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { attributes: { email: null } } }),
    })) as unknown as typeof fetch

    const mod = makeModule()
    const { payload, transient } = await resolveByKlaviyoExchangeId(mod, 'KX-anon')

    expect(payload.t).toBe('a')
    expect(transient).toBe(false)
  })
})

describe('resolveByMantaUidToken', () => {
  it('returns codified payload for a valid token + known contact', async () => {
    const token = signContactToken('jane@example.com')
    const mod = makeModule({
      contacts: [{ email: 'jane@example.com' }],
      orders: [
        { email: 'jane@example.com', status: 'paid', placed_at: new Date('2025-05-20T00:00:00Z') },
        { email: 'jane@example.com', status: 'paid', placed_at: new Date('2025-06-20T00:00:00Z') },
        { email: 'jane@example.com', status: 'paid', placed_at: new Date('2025-07-20T00:00:00Z') },
        { email: 'jane@example.com', status: 'paid', placed_at: new Date('2025-08-20T00:00:00Z') },
        { email: 'jane@example.com', status: 'fulfilled', placed_at: new Date('2025-09-20T00:00:00Z') },
      ],
    })

    const payload = await resolveByMantaUidToken(mod, token)
    expect(payload.t).toBe('c')
    expect(payload.n).toBe(5)
    expect(payload.o).toBe(20250920)
  })

  it('returns tier "a" when the token is expired', async () => {
    const old = Date.now() - (90 * 24 * 60 * 60 * 1000 + 1000)
    const token = signContactToken('jane@example.com', { now: old })
    const mod = makeModule({
      contacts: [{ email: 'jane@example.com' }],
      orders: [{ email: 'jane@example.com', status: 'paid', placed_at: new Date() }],
    })

    const payload = await resolveByMantaUidToken(mod, token)
    expect(payload.t).toBe('a')
    expect(mod.listContacts).not.toHaveBeenCalled()
  })

  it('returns tier "a" when the token is malformed', async () => {
    const mod = makeModule()
    const payload = await resolveByMantaUidToken(mod, 'not-a-real-token')
    expect(payload.t).toBe('a')
  })

  it('returns tier "l" when the token is valid but contact has no orders', async () => {
    const token = signContactToken('newish@example.com')
    const mod = makeModule({
      contacts: [{ email: 'newish@example.com' }],
    })
    const payload = await resolveByMantaUidToken(mod, token)
    expect(payload.t).toBe('l')
  })
})

describe('resolveByDistinctId', () => {
  it('returns codified payload for a known distinct_id', async () => {
    const mod = makeModule({
      contacts: [
        {
          email: 'jane@example.com',
          distinct_id: 'd-jane',
        },
      ],
      orders: [{ email: 'jane@example.com', status: 'paid', placed_at: '2025-08-01T12:00:00Z' }],
    })

    const payload = await resolveByDistinctId(mod, 'd-jane')
    expect(payload.t).toBe('c')
    expect(payload.n).toBe(1)
    expect(payload.o).toBe(20250801)
  })

  it('returns tier "a" for an unknown distinct_id', async () => {
    const mod = makeModule({ contacts: [] })
    const payload = await resolveByDistinctId(mod, 'd-unknown')
    expect(payload.t).toBe('a')
  })

  it('returns tier "a" for an empty distinct_id (whitespace)', async () => {
    const mod = makeModule()
    const payload = await resolveByDistinctId(mod, '   ')
    expect(payload.t).toBe('a')
    expect(mod.listContacts).not.toHaveBeenCalled()
  })
})
