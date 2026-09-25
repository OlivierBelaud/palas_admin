import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { RawDb } from '../src/utils/raw-db'

const { raw, authorized } = vi.hoisted(() => ({ raw: vi.fn(), authorized: { value: true } }))
vi.mock('../vercel-fast-functions/runtime.mjs', async (importOriginal) => {
  const runtime = await importOriginal<Record<string, unknown>>()
  return { ...runtime, db: () => ({ unsafe: raw }), requireAdmin: () => (authorized.value ? { type: 'admin' } : null) }
})

describe('tracking health provider diagnostics API parity', () => {
  let load: typeof import('../src/queries/admin/tracking-health').loadTrackingHealthData
  let fast: { fetch: (req: Request) => Promise<Response> }
  beforeAll(async () => {
    vi.stubGlobal('defineQuery', (value: unknown) => value)
    vi.stubGlobal('z', z)
    load = (await import('../src/queries/admin/tracking-health')).loadTrackingHealthData
    // @ts-expect-error The deployed Vercel handler is JavaScript; its HTTP contract is exercised below.
    fast = (await import('../vercel-fast-functions/admin-tracking-health.mjs')).default
  })
  afterAll(() => vi.unstubAllGlobals())
  beforeEach(() => {
    raw.mockReset()
    authorized.value = true
  })

  function fixture(status: string, legacy = false, hasReceipt = !legacy) {
    const at = '2026-09-25T06:00:00.000Z'
    const destinations = legacy
      ? {}
      : Object.fromEntries(
          ['google_ads', 'pinterest'].map((name) => [
            name,
            {
              supported: true,
              ready: true,
              blockers: [],
            },
          ]),
        )
    raw.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM event_logs')) {
        expect(params[2]).not.toContain('cart:updated')
        expect(params[2]).not.toContain('cart:closed')
        expect(params[2]).not.toContain('checkout:address_info_submitted')
        if (sql.includes('COUNT(*) OVER()'))
          return [
            {
              id: 'row1',
              event_id: 'event1',
              event_name: 'purchase',
              source: 'posthog',
              received_at: at,
              page_type: null,
              market: null,
              identity_muid: null,
              identity_email_sha256: null,
              distinct_id: null,
              payload_normalized: { validation: { errors: [], destinations } },
              total_count: '1',
            },
          ]
        if (sql.includes('GROUP BY event_name')) return []
        return [{ total: '1', valid: '1' }]
      }
      if (sql.includes('normalized_dispatch_logs')) {
        expect(params[2]).toContain('pinterest')
        expect(params[3]).toContain('pinterest_ad_storage_consent_not_granted')
        return ['google_ads', 'pinterest'].flatMap((destination) => [
          { destination, status: 'sent', count: '2' },
          { destination, status: 'validated', count: '3' },
        ])
      }
      if (sql.includes('FROM dispatch_logs')) {
        expect(params[1]).toContain('pinterest')
        return !hasReceipt
          ? []
          : ['google_ads', 'pinterest'].map((destination) => ({
              event_id: 'event1',
              destination,
              status,
              http_status: 200,
              attempt_count: 1,
              error_code: null,
              error_message: null,
              sent_at: status === 'sent' ? at : null,
            }))
      }
      return []
    })
  }

  async function both() {
    const query = await load({}, { raw } as RawDb)
    const response = await fast.fetch(new Request('https://admin.example/api/cart-tracking/admin-tracking-health'))
    expect(response.status).toBe(200)
    const deployed = (await response.json()).data
    return [query, deployed]
  }

  it.each([
    'validated',
    'sent',
    'retry',
    'not_configured',
    'error',
    'invalid',
  ])('preserves %s delivery state on both endpoints', async (status) => {
    fixture(status)
    for (const data of await both()) {
      expect(data.events[0]).toMatchObject({
        google_ads_status: status,
        pinterest_status: status,
        pinterest_http_status: 200,
        pinterest_attempt_count: 1,
        pinterest_blockers: [],
        pinterest_sent_at: status === 'sent' ? '2026-09-25T06:00:00.000Z' : null,
      })
      expect(data.kpis).toMatchObject({
        google_ads_sent: 2,
        google_ads_validated: 3,
        pinterest_sent: 2,
        pinterest_validated: 3,
      })
    }
  })

  it('treats older events without Pinterest metadata as unsupported', async () => {
    fixture('sent', true)
    for (const data of await both()) {
      expect(data.events[0]).toMatchObject({
        pinterest_status: 'unsupported',
        pinterest_ready: false,
        pinterest_sent_at: null,
        pinterest_blockers: [],
      })
    }
  })

  it.each([
    'validated',
    'sent',
    'pending',
  ])('reports the actual Pinterest %s receipt when repaired legacy metadata omits the destination', async (status) => {
    fixture(status, true, true)
    for (const data of await both()) {
      expect.soft(data.events[0]).toMatchObject({
        pinterest_status: status,
        pinterest_ready: status !== 'validated',
        pinterest_sent_at: status === 'sent' ? '2026-09-25T06:00:00.000Z' : null,
        pinterest_blockers: [],
      })
      if ('ad_destinations' in data.events[0]) {
        expect.soft(data.events[0].ad_destinations).toContainEqual({
          destination: 'pinterest',
          supported: true,
          ready: status !== 'validated',
          blockers: [],
        })
      }
    }
  })

  it('keeps the deployed endpoint admin-only', async () => {
    authorized.value = false
    expect(
      (await fast.fetch(new Request('https://admin.example/api/cart-tracking/admin-tracking-health'))).status,
    ).toBe(401)
    expect(raw).not.toHaveBeenCalled()
  })
})
