import { readFileSync } from 'node:fs'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { remapGoogleAdsDispatches, requeueValidatedAdDispatches } from '../src/modules/event-hub/ad-dispatch-repair'
import { POST } from '../src/modules/event-hub/api/ingest/route'
import type { DestinationConnector } from '../src/modules/event-hub/destination-connector'
import { repairUnpreparedDispatches } from '../src/modules/event-hub/dispatch-repair'
import { flushDestinationDispatches, type RawDispatchDb } from '../src/modules/event-hub/dispatch-runner'
import { ga4DestinationConnector } from '../src/modules/event-hub/ga4-connector'
import { googleAdsDestinationConnector } from '../src/modules/event-hub/google-ads-connector'
import { metaCapiDestinationConnector } from '../src/modules/event-hub/meta-capi-connector'
import { pinterestDestinationConnector } from '../src/modules/event-hub/pinterest-connector'

const url = process.env.PALAS_TEST_DATABASE_URL
const suite = url ? describe : describe.skip
suite('dispatch PostgreSQL concurrency (isolated schema)', () => {
  const sql = postgres(url || 'postgresql://localhost/unused', {
    max: 4,
    onnotice: () => {},
    connection: { search_path: 'delivery_test' },
  })
  const db: RawDispatchDb = {
    raw: async <T>(query: string, params?: unknown[]) => (await sql.unsafe(query, params as never[])) as unknown as T[],
  }
  const c = (send: DestinationConnector['send']): DestinationConnector => ({
    destination: 'ga4',
    pendingStatuses: ['pending', 'retry', 'not_configured'],
    isConfigured: () => true,
    notConfiguredErrorCode: '',
    notConfiguredMessage: '',
    send,
  })
  const sent = {
    status: 'sent' as const,
    http_status: 204,
    error_code: null,
    error_message: null,
    response_payload: null,
  }
  beforeAll(async () => {
    if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.endsWith('_test'))
      throw new Error('Isolated local test database required')
    await sql.unsafe('CREATE SCHEMA IF NOT EXISTS delivery_test')
    await sql.unsafe(readFileSync('demo/commerce/drizzle/migrations/20260609233000_dispatch_logs.sql', 'utf8'))
    await sql.unsafe(readFileSync('demo/commerce/drizzle/migrations/20260609152000_event_hub_logs.sql', 'utf8'))
    await sql.unsafe(
      readFileSync('demo/commerce/drizzle/migrations/20260922111000_event_dispatch_prepared.sql', 'utf8'),
    )
  })
  beforeEach(async () => {
    vi.restoreAllMocks()
    await sql.unsafe('TRUNCATE dispatch_logs, event_logs')
    await sql.unsafe(
      `INSERT INTO dispatch_logs(id,event_destination_key,event_id,canonical_event_name,destination,status,event_received_at,request_payload) VALUES ('one','evt:ga4','evt','purchase','ga4','pending',NOW(),'{}')`,
    )
  })
  afterAll(async () => {
    await sql.end()
  })
  it('only one concurrent worker sends a candidate', async () => {
    const send = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 25))
      return sent
    })
    await Promise.all(
      Array.from({ length: 8 }, () => flushDestinationDispatches({ db, connector: c(send), batchLimit: 10 })),
    )
    expect(send).toHaveBeenCalledTimes(1)
    expect(await sql.unsafe('SELECT status,attempt_count FROM dispatch_logs')).toMatchObject([
      { status: 'sent', attempt_count: 1 },
    ])
  })
  it('a stale worker cannot overwrite the newer worker result', async () => {
    let resume!: (value: typeof sent) => void
    let started!: () => void
    const ready = new Promise<void>((r) => {
      started = r
    })
    const old = flushDestinationDispatches({
      db,
      connector: c(async () => {
        started()
        return new Promise((r) => {
          resume = r
        })
      }),
      batchLimit: 10,
    })
    await ready
    await sql.unsafe("UPDATE dispatch_logs SET last_attempt_at = NOW() - INTERVAL '3 minutes'")
    await flushDestinationDispatches({ db, connector: c(async () => ({ ...sent, http_status: 202 })), batchLimit: 10 })
    resume(sent)
    await old
    expect(await sql.unsafe('SELECT status,attempt_count,http_status FROM dispatch_logs')).toMatchObject([
      { status: 'sent', attempt_count: 2, http_status: 202 },
    ])
  })
  it('transport failure and cancellation are persisted and later recover', async () => {
    const abort = new AbortController()
    const result = await flushDestinationDispatches({
      db,
      signal: abort.signal,
      connector: c(async () => {
        abort.abort()
        return new Promise(() => {})
      }),
      batchLimit: 10,
    })
    expect(result.retry).toBe(1)
    expect(await sql.unsafe('SELECT status,attempt_count,next_attempt_at FROM dispatch_logs')).toMatchObject([
      { status: 'retry', attempt_count: 1, next_attempt_at: expect.any(Date) },
    ])
    await sql.unsafe('UPDATE dispatch_logs SET next_attempt_at = NOW()')
    await flushDestinationDispatches({ db, connector: c(async () => sent), batchLimit: 10 })
    expect(await sql.unsafe('SELECT status,attempt_count FROM dispatch_logs')).toMatchObject([
      { status: 'sent', attempt_count: 2 },
    ])
  })
  it('HTTP replay preserves compact sent receipts and repairs a missing destination', async () => {
    const connectors = [
      ga4DestinationConnector,
      googleAdsDestinationConnector,
      metaCapiDestinationConnector,
      pinterestDestinationConnector,
    ]
    const sends = connectors.map((connector) => {
      vi.spyOn(connector, 'isConfigured').mockReturnValue(true)
      return vi.spyOn(connector, 'send').mockResolvedValue(sent)
    })
    const request = () => {
      const req = new Request('https://admin.fancypalas.com/api/event-hub/ingest', {
        method: 'POST',
        headers: { origin: 'https://fancypalas.com', 'content-type': 'application/json' },
        body: JSON.stringify({
          event_id: 'purchase123',
          event_name: 'purchase',
          source: 'posthog_proxy',
          event_time: new Date().toISOString(),
          consent: { analytics_storage: true, ad_storage: true, ad_user_data: true, ad_personalization: true },
          user: { muid: 'muid_123', email: 'test@example.com', gclid: 'test_click' },
          context: { url: 'https://fancypalas.com/checkout' },
          ecommerce: {
            transaction_id: 'order123',
            currency: 'EUR',
            value: 20,
            items: [{ item_id: 'v1', price: 20, quantity: 1 }],
          },
        }),
      })
      Object.defineProperty(req, 'app', { value: { infra: { db: { getPool: () => sql, raw: db.raw } } } })
      return req
    }
    expect((await POST(request())).status).toBe(200)
    const first = await sql.unsafe("SELECT destination,status FROM dispatch_logs WHERE event_id='purchase123'")
    expect(first).toHaveLength(4)
    // Preserve terminal receipts even after payload compaction; a missing destination alone is repaired.
    await sql.unsafe("UPDATE dispatch_logs SET status='sent',request_payload=NULL WHERE event_id='purchase123'")
    await sql.unsafe("UPDATE event_logs SET payload_normalized=NULL WHERE event_id='purchase123'")
    await sql.unsafe("DELETE FROM dispatch_logs WHERE event_destination_key='purchase123:meta_capi'")
    for (const send of sends) send.mockClear()
    expect((await POST(request())).status).toBe(200)
    expect(sends[0]).not.toHaveBeenCalled()
    expect(sends[1]).not.toHaveBeenCalled()
    expect(
      await sql.unsafe("SELECT request_payload FROM dispatch_logs WHERE event_destination_key='purchase123:ga4'"),
    ).toMatchObject([{ request_payload: null }])
    expect(
      await sql.unsafe("SELECT payload_normalized,dispatch_prepared_at FROM event_logs WHERE event_id='purchase123'"),
    ).toMatchObject([{ payload_normalized: null, dispatch_prepared_at: expect.any(Date) }])
    expect(
      await sql.unsafe("SELECT count(*)::int AS count FROM dispatch_logs WHERE event_id='purchase123'"),
    ).toMatchObject([{ count: 4 }])
    await sql.unsafe(
      "UPDATE dispatch_logs SET status='invalid',request_payload=NULL WHERE event_destination_key='purchase123:ga4'",
    )
    expect((await POST(request())).status).toBe(200)
    expect(sends[0]).toHaveBeenCalledTimes(1)
    expect(
      await sql.unsafe(
        "SELECT status,request_payload FROM dispatch_logs WHERE event_destination_key='purchase123:ga4'",
      ),
    ).toMatchObject([{ status: 'sent', request_payload: expect.any(Object) }])
    await sql.unsafe(
      "UPDATE dispatch_logs SET status='error',next_attempt_at=NULL WHERE event_destination_key='purchase123:ga4'",
    )
    expect((await POST(request())).status).toBe(200)
    expect(sends[0]).toHaveBeenCalledTimes(2)
  })
  it('Pinterest validation is terminal until explicitly requeued, then sends once', async () => {
    await sql.unsafe("UPDATE dispatch_logs SET destination='pinterest',event_destination_key='evt:pinterest'")
    const send = vi
      .fn()
      .mockResolvedValueOnce({ ...sent, status: 'validated', http_status: 200 })
      .mockResolvedValue(sent)
    const connector = { ...c(send), destination: 'pinterest' as const }
    expect(await flushDestinationDispatches({ db, connector, batchLimit: 10 })).toMatchObject({ validated: 1, sent: 0 })
    expect(await sql.unsafe('SELECT status,sent_at,next_attempt_at FROM dispatch_logs')).toMatchObject([
      { status: 'validated', sent_at: null, next_attempt_at: null },
    ])
    expect(await flushDestinationDispatches({ db, connector, batchLimit: 10 })).toMatchObject({ scanned: 0 })
    expect(await requeueValidatedAdDispatches(db, 'pinterest', ['evt'])).toEqual({ requeued: 1 })
    expect(await flushDestinationDispatches({ db, connector, batchLimit: 10 })).toMatchObject({ sent: 1 })
    expect(await requeueValidatedAdDispatches(db, 'pinterest', ['evt'])).toEqual({ requeued: 0 })
    expect(send).toHaveBeenCalledTimes(2)
  })
  it('remaps retained legacy Google rows but preserves terminal receipts', async () => {
    vi.spyOn(googleAdsDestinationConnector, 'isConfigured').mockReturnValue(true)
    vi.stubEnv('GOOGLE_ADS_CUSTOMER_ID', '1234567890')
    vi.stubEnv('GOOGLE_ADS_PURCHASE_CONVERSION_ACTION_ID', '123')
    try {
      const canonical = {
        event_id: 'evt',
        event_time: new Date().toISOString(),
        user: { gclid: 'test-click' },
        consent: { ad_storage: true, ad_user_data: true, ad_personalization: true },
        ecommerce: { transaction_id: 'order123', value: 20, currency: 'EUR' },
      }
      await sql.unsafe(
        "INSERT INTO event_logs(id,event_id,event_name,source,received_at,payload_normalized) VALUES('evt','evt','purchase','posthog_proxy',NOW(),$1::jsonb)",
        [JSON.stringify(canonical)],
      )
      await sql.unsafe("UPDATE dispatch_logs SET destination='google_ads',request_payload='{\"conversions\":[]}'")
      expect(await remapGoogleAdsDispatches(db)).toEqual({ scanned: 1, remapped: 1 })
      const rows = await sql.unsafe('SELECT status,request_payload FROM dispatch_logs')
      expect(rows[0].status).toBe('pending')
      expect(rows[0].request_payload.events[0].transactionId).toBe('order123')
      await sql.unsafe("UPDATE dispatch_logs SET status='sent',request_payload='{\"conversions\":[]}'")
      expect(await remapGoogleAdsDispatches(db)).toEqual({ scanned: 0, remapped: 0 })
    } finally {
      vi.unstubAllEnvs()
    }
  })
  it('cron repairs every supported destination of old stranded envelopes without browser replay', async () => {
    const send = vi.fn(async () => sent)
    const connector = c(send)
    await sql.unsafe(`INSERT INTO event_logs(id,event_id,event_name,source,received_at,payload_normalized)
      VALUES('old','stranded','purchase','posthog_proxy',NOW()-INTERVAL '45 days',
      '{"event_time":"2026-08-01T00:00:00Z","user":{"ga_client_id":"client123"},"ecommerce":{"transaction_id":"order123","currency":"EUR","value":20}}')`)
    const result = await repairUnpreparedDispatches(db, connector)
    expect(result).toEqual({ scanned: 1, inserted: 4 })
    expect(send).not.toHaveBeenCalled()
    expect(await sql.unsafe("SELECT dispatch_prepared_at FROM event_logs WHERE event_id='stranded'")).toMatchObject([
      { dispatch_prepared_at: expect.any(Date) },
    ])
    expect(await repairUnpreparedDispatches(db, connector)).toEqual({ scanned: 0, inserted: 0 })
  })
  it('repair commits the completion marker only if every destination insert succeeds', async () => {
    await sql.unsafe(`INSERT INTO event_logs(id,event_id,event_name,source,received_at,payload_normalized)
      VALUES('atomic','atomic','purchase','posthog_proxy',NOW(),'{}')`)
    await sql.unsafe(
      "ALTER TABLE dispatch_logs ADD CONSTRAINT delivery_test_fail_meta CHECK (destination <> 'meta_capi')",
    )
    try {
      await expect(
        repairUnpreparedDispatches(
          db,
          c(async () => sent),
        ),
      ).rejects.toThrow()
      expect(await sql.unsafe("SELECT dispatch_prepared_at FROM event_logs WHERE event_id='atomic'")).toMatchObject([
        { dispatch_prepared_at: null },
      ])
      expect(
        await sql.unsafe("SELECT count(*)::int AS count FROM dispatch_logs WHERE event_id='atomic'"),
      ).toMatchObject([{ count: 0 }])
    } finally {
      await sql.unsafe('ALTER TABLE dispatch_logs DROP CONSTRAINT delivery_test_fail_meta')
    }
    expect(
      await repairUnpreparedDispatches(
        db,
        c(async () => sent),
      ),
    ).toMatchObject({ inserted: 4 })
  })
  it('does not schedule permanent provider errors again but retains their payload', async () => {
    const send = vi.fn(async () => ({ ...sent, status: 'error' as const, http_status: 400, error_code: 'bad_request' }))
    const first = await flushDestinationDispatches({ db, connector: c(send), batchLimit: 10 })
    expect(first.error).toBe(1)
    expect(await sql.unsafe('SELECT status,next_attempt_at,request_payload FROM dispatch_logs')).toMatchObject([
      { status: 'error', next_attempt_at: null, request_payload: {} },
    ])
    expect(await flushDestinationDispatches({ db, connector: c(send), batchLimit: 10 })).toMatchObject({ scanned: 0 })
    expect(send).toHaveBeenCalledTimes(1)
  })
})
