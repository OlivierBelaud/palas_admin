import { describe, expect, it, vi } from 'vitest'
import { parseControlRequest } from '../src/modules/tracking-control/local-query'
import { loadTrackingMatrix } from '../src/modules/tracking-control/matrix'

const now = new Date('2026-09-28T14:00:00Z')
const parse = (q: string, clock = now) => parseControlRequest(new URLSearchParams(`destination=meta_capi&${q}`), clock)

describe('tracking matrix calendar periods', () => {
  it('selects today in Paris, capped at now', () => {
    expect(parse('date=2026-09-28').window).toEqual({
      from: '2026-09-27T22:00:00.000Z',
      to: now.toISOString(),
      timezone: 'Europe/Paris',
    })
  })
  it('honors 23 and 25 hour Paris days', () => {
    const spring = parse('date=2026-03-29', new Date('2026-03-30T12:00:00Z')).window
    const autumn = parse('date=2026-10-25', new Date('2026-10-26T12:00:00Z')).window
    expect((Date.parse(spring.to) - Date.parse(spring.from)) / 3600000).toBe(23)
    expect((Date.parse(autumn.to) - Date.parse(autumn.from)) / 3600000).toBe(25)
  })
  it('keeps the oldest Paris day readable in the frozen second request after DST', () => {
    const clock = new Date('2026-10-31T22:30:00Z')
    const window = parse('date=2026-10-25', clock).window
    expect(parse(`view=matrix&from=${window.from}&to=${window.to}`, clock).window.from).toBe(window.from)
  })
  it.each(['date=2026-02-30', 'date=2026-09-29', 'date=2026-09-10', 'date=2026-09-28&hours=4'])('rejects %s', (q) =>
    expect(() => parse(q)).toThrow())
})

describe('tracking matrix evidence', () => {
  it('keeps unsupported blank, GA4 unknown and saved acknowledgements separate from live totals', async () => {
    const raw = vi.fn(async (sql: string) => {
      if (sql.includes('matrix:events')) return [{ event_name: 'page_view', captured: 10, valid: 8 }]
      if (sql.includes('matrix:dispatches'))
        return [
          { event_name: 'page_view', destination: 'meta_capi', sent: 8, acknowledged: 6, unconfirmed: 2, tests: 0 },
          { event_name: 'page_view', destination: 'ga4', sent: 8, acknowledged: 0, unconfirmed: 8, tests: 0 },
        ]
      return []
    })
    const data = await loadTrackingMatrix(parse('hours=4'), { raw: raw as never }, {}, vi.fn())
    const row = data.rows.find((r) => r.event_name === 'page_view')!
    expect(row.captured).toBe(10)
    expect(row.valid).toBe(8)
    expect(row.platforms.google_ads).toBeNull()
    expect(row.platforms.meta_capi).toMatchObject({ sent: 8, received: 6, unconfirmed: 2 })
    expect(row.platforms.ga4?.received).toBeNull()
    expect(data.rows.find((r) => r.event_name === 'purchase')?.platforms.meta_capi).toMatchObject({
      sent: 0,
      received: 0,
    })
    expect(JSON.stringify(data)).not.toMatch(/requestId|access_token|request_payload|response_payload/)
  })
})

const databaseUrl = process.env.CONTROL_TEST_DATABASE_URL || process.env.PALAS_TEST_DATABASE_URL

describe.skipIf(!databaseUrl)('tracking matrix PostgreSQL evidence', () => {
  it('counts each event once and excludes tests, deleted rows and out-of-window events', async () => {
    if (!databaseUrl || !['127.0.0.1', 'localhost'].includes(new URL(databaseUrl).hostname))
      throw new Error('Isolated local database required')
    const { default: postgres } = await import('postgres')
    const sql = postgres(databaseUrl, { max: 1, prepare: false })
    try {
      await sql.unsafe(`CREATE TEMP TABLE event_logs (event_id text, event_name text, received_at timestamptz, deleted_at timestamptz, valid boolean DEFAULT true);
      CREATE TEMP TABLE dispatch_logs (event_id text,destination text,status text,request_payload jsonb,response_payload jsonb,deleted_at timestamptz);
      INSERT INTO event_logs (event_id,event_name,received_at,deleted_at) VALUES ('a','page_view','2026-09-28T12:00:00Z',NULL),('b','page_view','2026-09-28T12:00:00Z',NULL),('c','page_view','2026-09-28T12:00:00Z',NULL),('deleted','page_view','2026-09-28T12:00:00Z',NOW()),('old','page_view','2026-09-28T09:00:00Z',NULL),('end','page_view','2026-09-28T14:00:00Z',NULL);
      INSERT INTO dispatch_logs VALUES ('a','meta_capi','sent','{}','{"events_received":1}',NULL),('b','meta_capi','sent','{"test_event_code":"test"}','{"events_received":1}',NULL),('c','meta_capi','sent',NULL,NULL,NULL),('deleted','meta_capi','sent','{}','{"events_received":1}',NULL),('old','meta_capi','sent','{}','{"events_received":1}',NULL),('end','meta_capi','sent','{}','{"events_received":1}',NULL),('a','ga4','sent','{}',NULL,NULL),('b','ga4','sent','{}','{"validationMessages":[]}',NULL),('c','ga4','sent','{}',NULL,NOW());`)
      await sql.unsafe(
        "UPDATE event_logs SET valid=false WHERE event_id='c'; INSERT INTO dispatch_logs VALUES ('a','google_ads','sent','{}','{\"requestId\":\"shared\"}',NULL),('b','google_ads','sent','{}','{\"requestId\":\"shared\"}',NULL)",
      )
      let requestRows: unknown[] = []
      const result = await loadTrackingMatrix(
        parse('hours=4'),
        {
          raw: (async (q: string, args: unknown[]) => {
            const rows = await sql.unsafe(q, args as never)
            if (q.includes('matrix:google')) requestRows = rows
            return rows
          }) as never,
        },
        {},
        vi.fn(),
        true,
      )
      expect(requestRows).toEqual([expect.objectContaining({ request_id: 'shared', total: '1' })])
      const row = result.rows.find((r) => r.event_name === 'page_view')!
      expect(row.captured).toBe(3)
      expect(row.valid).toBe(2)
      expect(row.platforms.meta_capi).toMatchObject({ sent: 1, received: 1, unconfirmed: 1, unknown_mode: 1, tests: 1 })
      expect(row.platforms.ga4).toMatchObject({ sent: 1, received: null, tests: 1 })
      // Reproduce the retention job after an excluded Meta test and GA4 debug response.
      await sql.unsafe(
        "UPDATE dispatch_logs SET request_payload=NULL,response_payload=NULL WHERE event_id='b' AND destination IN ('meta_capi','ga4')",
      )
      const compacted = await loadTrackingMatrix(
        parse('hours=4'),
        { raw: ((q: string, args: unknown[]) => sql.unsafe(q, args as never)) as never },
        {},
        vi.fn(),
        false,
      )
      const history = compacted.rows.find((r) => r.event_name === 'page_view')!
      expect(history.platforms.meta_capi).toMatchObject({ sent: 1, unknown_mode: 2, received: 1, unconfirmed: 2 })
      expect(history.platforms.ga4).toMatchObject({ sent: 1, unknown_mode: 1, received: null })
    } finally {
      await sql.end()
    }
  })
})
