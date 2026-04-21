// Unit tests — identity-resolver helpers.
// Tests the cache behaviour, metrics accounting, and the pure enrichment
// helper. The network-bound `resolveEmailByDistinctId` / `resolveEmailsBatch`
// are exercised via a mocked global `fetch` to keep tests hermetic.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearIdentityCache,
  enrichEventWithEmail,
  getIdentityMetrics,
  resetIdentityMetrics,
  resolveEmailByDistinctId,
  resolveEmailsBatch,
} from '../src/modules/cart-tracking/identity-resolver'

function mockFetch(response: unknown, ok = true) {
  return vi.fn(async () => ({
    ok,
    json: async () => response,
  })) as unknown as typeof fetch
}

describe('identity-resolver', () => {
  const originalFetch = globalThis.fetch
  const originalHost = process.env.POSTHOG_HOST
  const originalKey = process.env.POSTHOG_API_KEY

  beforeEach(() => {
    clearIdentityCache()
    resetIdentityMetrics()
    process.env.POSTHOG_HOST = 'https://test.posthog'
    process.env.POSTHOG_API_KEY = 'test-key'
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    process.env.POSTHOG_HOST = originalHost
    process.env.POSTHOG_API_KEY = originalKey
  })

  describe('resolveEmailByDistinctId', () => {
    it('returns null when no API key is configured', async () => {
      process.env.POSTHOG_API_KEY = ''
      const email = await resolveEmailByDistinctId('d1')
      expect(email).toBeNull()
      expect(getIdentityMetrics().lookups).toBe(0)
    })

    it('issues a HogQL query and returns the email', async () => {
      globalThis.fetch = mockFetch({ results: [['isa.morin@example.com']] })
      const email = await resolveEmailByDistinctId('d1')
      expect(email).toBe('isa.morin@example.com')
      const m = getIdentityMetrics()
      expect(m.lookups).toBe(1)
      expect(m.recoveries).toBe(1)
      expect(m.misses).toBe(0)
    })

    it('caches the result — second call does not hit the network', async () => {
      const fetchMock = mockFetch({ results: [['isa.morin@example.com']] })
      globalThis.fetch = fetchMock

      await resolveEmailByDistinctId('d1')
      await resolveEmailByDistinctId('d1')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const m = getIdentityMetrics()
      expect(m.lookups).toBe(1)
      expect(m.hits).toBe(1)
    })

    it('caches null results to avoid re-querying missing identities', async () => {
      const fetchMock = mockFetch({ results: [] })
      globalThis.fetch = fetchMock

      expect(await resolveEmailByDistinctId('unknown')).toBeNull()
      expect(await resolveEmailByDistinctId('unknown')).toBeNull()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const m = getIdentityMetrics()
      expect(m.misses).toBe(1)
      expect(m.hits).toBe(1)
    })

    it('returns null on non-OK responses without throwing', async () => {
      globalThis.fetch = mockFetch({}, false)
      const email = await resolveEmailByDistinctId('d1')
      expect(email).toBeNull()
      expect(getIdentityMetrics().misses).toBe(1)
    })

    it('escapes single quotes in the distinct_id to avoid HogQL injection', async () => {
      const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
        ok: true,
        json: async () => ({ results: [['x@y.z']] }),
      }))
      globalThis.fetch = fetchMock as unknown as typeof fetch
      await resolveEmailByDistinctId("bad'id")
      const [, init] = fetchMock.mock.calls[0]
      const body = JSON.parse(init?.body as string) as { query: { query: string } }
      expect(body.query.query).toContain("bad''id")
    })
  })

  describe('resolveEmailsBatch', () => {
    it('returns an empty map when no API key is configured', async () => {
      process.env.POSTHOG_API_KEY = ''
      const map = await resolveEmailsBatch()
      expect(map.size).toBe(0)
    })

    it('returns a distinct_id → email map', async () => {
      globalThis.fetch = mockFetch({
        results: [
          ['d1', 'a@b.com'],
          ['d2', 'c@d.com'],
          ['d3', null],
          [null, 'orphan@e.com'],
        ],
      })
      const map = await resolveEmailsBatch()
      expect(map.get('d1')).toBe('a@b.com')
      expect(map.get('d2')).toBe('c@d.com')
      expect(map.has('d3')).toBe(false)
      expect(map.size).toBe(2)
    })

    it('warms the per-id cache so subsequent singles hit it', async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({ results: [['d1', 'a@b.com']] }),
      }))
      globalThis.fetch = fetchMock as unknown as typeof fetch

      await resolveEmailsBatch()
      const email = await resolveEmailByDistinctId('d1')

      expect(email).toBe('a@b.com')
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(getIdentityMetrics().hits).toBe(1)
    })
  })

  describe('enrichEventWithEmail', () => {
    it('injects $set.email when the event has a recovered identity', () => {
      const evt: { distinct_id?: string | null; properties?: Record<string, unknown> } = {
        distinct_id: 'd1',
        properties: { cart: { token: 't' } },
      }
      const map = new Map([['d1', 'isa.morin@example.com']])
      expect(enrichEventWithEmail(evt, map)).toBe(true)
      expect((evt.properties?.$set as Record<string, unknown>).email).toBe('isa.morin@example.com')
    })

    it('does not overwrite an existing $set.email', () => {
      const evt = {
        distinct_id: 'd1',
        properties: { $set: { email: 'already@set.com' } },
      }
      const map = new Map([['d1', 'isa.morin@example.com']])
      expect(enrichEventWithEmail(evt, map)).toBe(false)
      expect((evt.properties.$set as Record<string, unknown>).email).toBe('already@set.com')
    })

    it('no-op when distinct_id is missing from the map', () => {
      const evt = { distinct_id: 'unknown', properties: {} }
      expect(enrichEventWithEmail(evt, new Map([['d1', 'a@b.com']]))).toBe(false)
      expect(evt.properties).toEqual({})
    })

    it('no-op when the event has no distinct_id', () => {
      const evt = { properties: {} }
      expect(enrichEventWithEmail(evt, new Map([['d1', 'a@b.com']]))).toBe(false)
    })

    it('creates properties.$set when absent', () => {
      const evt: { distinct_id?: string | null; properties?: Record<string, unknown> } = {
        distinct_id: 'd1',
        properties: {},
      }
      enrichEventWithEmail(evt, new Map([['d1', 'a@b.com']]))
      expect(evt.properties?.$set).toEqual({ email: 'a@b.com' })
    })
  })
})
