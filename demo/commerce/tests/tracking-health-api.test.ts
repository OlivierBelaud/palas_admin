import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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
  afterEach(() => vi.unstubAllEnvs())
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

  it.each([
    ['964292419711028', 'v26.0', '2171485343672971', 'v25.0', '964292419711028', 'v26.0'],
    ['', '', '2171485343672971', 'v24.0', '2171485343672971', 'v24.0'],
    ['', '', '', '', null, 'v25.0'],
  ])('exposes only the effective Meta pixel and API version on both endpoints', async (pixel, version, fallbackPixel, fallbackVersion, expectedPixel, expectedVersion) => {
    vi.stubEnv('META_PIXEL_ID', pixel!)
    vi.stubEnv('META_CAPI_API_VERSION', version!)
    vi.stubEnv('FACEBOOK_PIXEL_ID', fallbackPixel!)
    vi.stubEnv('META_API_VERSION', fallbackVersion!)
    vi.stubEnv('META_ACCESS_TOKEN', 'private-meta-token')
    vi.stubEnv('FACEBOOK_ACCESS_TOKEN', 'private-facebook-token')
    vi.stubEnv('META_TEST_EVENT_CODE', 'private-test-code')
    vi.stubEnv('META_CAPI_ENDPOINT', 'https://custom.example/private-endpoint')
    fixture('sent')
    for (const data of await both()) {
      expect(data.meta_capi).toEqual({ pixel_id: expectedPixel, api_version: expectedVersion })
      const serialized = JSON.stringify(data)
      expect(serialized).not.toContain('private-')
    }
  })

  it('passes the selected event to both destination-counter queries', async () => {
    fixture('sent')
    await load({ event_name: 'add_to_cart' }, { raw } as RawDb)
    await fast.fetch(
      new Request('https://admin.example/api/cart-tracking/admin-tracking-health?event_name=add_to_cart'),
    )
    const calls = raw.mock.calls.filter(([query]) => query.includes('normalized_dispatch_logs'))
    expect(calls).toHaveLength(2)
    for (const [query, params] of calls) {
      expect(params[4]).toBe('add_to_cart')
      expect(query).toContain('canonical_event_name = $5')
      expect(params[3]).toContain('ga4_analytics_consent_not_granted')
    }
  })

  it.skipIf(!process.env.CONTROL_TEST_DATABASE_URL)(
    'executes both counter queries with consent, identity gaps and real errors in PostgreSQL',
    async () => {
      const url = process.env.CONTROL_TEST_DATABASE_URL!
      if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Isolated database required')
      fixture('sent')
      await load({ event_name: 'add_to_cart' }, { raw } as RawDb)
      await fast.fetch(
        new Request('https://admin.example/api/cart-tracking/admin-tracking-health?event_name=add_to_cart'),
      )
      const queries = raw.mock.calls.filter(([query]) => query.includes('normalized_dispatch_logs'))
      const statQueries = raw.mock.calls.filter(([query]) => query.includes('AS consent_analytics_granted'))
      const sql = postgres(url, { max: 1, prepare: false })
      try {
        await sql.unsafe(`CREATE TEMP TABLE dispatch_logs (destination text,status text,error_code text,metadata jsonb,deleted_at timestamptz,event_received_at timestamptz,canonical_event_name text);
        INSERT INTO dispatch_logs VALUES
        ('ga4','invalid','ga4_analytics_consent_not_granted','{}',null,now()-interval '1 minute','add_to_cart'),
        ('ga4','sent',null,'{}',null,now()-interval '1 minute','purchase'),
        ('ga4','invalid','ga4_analytics_consent_not_granted','{"errors":["ga4_analytics_consent_not_granted","ga4_currency_missing"]}',null,now()-interval '1 minute','add_to_cart'),
        ('google_ads','invalid','google_ads_identifier_missing','{"errors":["google_ads_identifier_missing","google_ads_ad_storage_consent_not_granted"]}',null,now()-interval '1 minute','add_to_cart'),
        ('google_ads','invalid','google_ads_identifier_missing','{"errors":["google_ads_identifier_missing"]}',null,now()-interval '1 minute','add_to_cart'),
        ('google_ads','invalid','google_ads_identifier_missing','{"errors":["google_ads_identifier_missing","google_ads_currency_code_missing"]}',null,now()-interval '1 minute','add_to_cart'),
        ('google_ads','error','GOOGLE_DOWN','{}',null,now()-interval '1 minute','add_to_cart'),
        ('google_ads','sent','google_ads_ad_storage_consent_not_granted','{}',null,now()-interval '1 minute','add_to_cart'),
        ('google_ads','sent',null,'{}',now(),now()-interval '1 minute','add_to_cart');
        CREATE TEMP TABLE event_logs (payload_normalized jsonb, identity_email_sha256 text, identity_muid text, distinct_id text, deleted_at timestamptz, received_at timestamptz, event_name text);
        INSERT INTO event_logs (payload_normalized,received_at,event_name) VALUES
        ('{"validation":{"errors":[],"destinations":{"ga4":{"supported":true,"ready":false,"blockers":["analytics_consent_not_granted"]}}}}',now()-interval '1 minute','add_to_cart'),
        ('{"validation":{"errors":[],"destinations":{"ga4":{"supported":true,"ready":false,"blockers":["ga4_client_id_missing"]}}}}',now()-interval '1 minute','add_to_cart');`)
        for (const [query, params] of queries) {
          const rows = await sql.unsafe(query, params)
          const counts = Object.fromEntries(rows.map((r) => [`${r.destination}:${r.status}`, Number(r.count)]))
          expect(counts).toEqual({
            'ga4:consent_blocked': 1,
            'ga4:invalid': 1,
            'google_ads:consent_blocked': 1,
            'google_ads:identifier_missing': 1,
            'google_ads:invalid': 1,
            'google_ads:error': 1,
            'google_ads:sent': 1,
          })
        }
        for (const [query, params] of statQueries) {
          const [counts] = await sql.unsafe(query, params)
          expect(Number(counts.total)).toBe(2)
          expect(Number(counts.valid)).toBe(1)
        }
      } finally {
        await sql.end()
      }
    },
  )

  it('keeps the deployed endpoint admin-only', async () => {
    authorized.value = false
    expect(
      (await fast.fetch(new Request('https://admin.example/api/cart-tracking/admin-tracking-health'))).status,
    ).toBe(401)
    expect(raw).not.toHaveBeenCalled()
  })
})
