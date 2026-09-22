import { readFileSync } from 'node:fs'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RawDb } from '../src/modules/cart-tracking/apply-event'
import {
  ingestRecoveredCartEvent,
  recoverPosthogEvents,
  recoveryPageQuery,
} from '../src/modules/cart-tracking/posthog-recovery'
import type { HogQLEventRow } from '../src/modules/cart-tracking/posthog-sync'

const url = process.env.PALAS_TEST_DATABASE_URL
const integration = url ? describe : describe.skip
integration('durable PostHog recovery (isolated PostgreSQL)', () => {
  const sql = postgres(url ?? 'postgresql://localhost/unused', { max: 1, onnotice: () => {} })
  const db: RawDb = {
    raw: async <T>(query: string, values: unknown[] = []) => [...(await sql.unsafe(query, values as never[]))] as T[],
  }
  let rows: HogQLEventRow[] = []
  const row = (id: string, properties: unknown = { cart: { token: `cart-${id}` } }): HogQLEventRow => [
    id,
    'cart:viewed',
    'visitor',
    '2026-09-21 12:00:00.123456',
    properties,
  ]
  const fetchPage = vi.fn(async (query: string) => {
    const cursor = query.match(/toString\(uuid\) > '([^']+)'/)?.[1]
    const limit = Number(query.match(/LIMIT (\d+)/)?.[1])
    return rows.filter((r) => !cursor || String(r[0]) > cursor).slice(0, limit)
  })
  beforeAll(async () => {
    if (!url?.includes('127.0.0.1') || !url.includes('palas_costs_test'))
      throw new Error('Isolated local database required')
    await sql.unsafe('CREATE SCHEMA IF NOT EXISTS posthog_test; SET search_path TO posthog_test')
    await sql.unsafe('CREATE TABLE IF NOT EXISTS carts(last_action text,last_action_at timestamptz)')
    await sql.unsafe(
      readFileSync(new URL('../drizzle/migrations/20260922113000_posthog_recovery.sql', import.meta.url), 'utf8'),
    )
  })
  beforeEach(async () => {
    await sql.unsafe('TRUNCATE posthog_recovery_state, posthog_recovery_receipts, carts')
    rows = []
    fetchPage.mockClear()
  })
  afterAll(async () => {
    await sql.end()
  })
  const run = (ingest: (input: Record<string, unknown>) => Promise<unknown> = vi.fn(async () => ({})), extra = {}) =>
    recoverPosthogEvents({ db, fetchPage, ingest, now: () => Date.parse('2026-09-22T00:00:00Z'), ...extra })

  it('progresses beyond 5000 events with identical microsecond timestamps and deduplicates overlap', async () => {
    rows = Array.from({ length: 5003 }, (_, i) => row(String(i).padStart(6, '0')))
    const ingest = vi.fn(async () => ({}))
    await run(ingest, { maxEvents: 5000 })
    expect(ingest).toHaveBeenCalledTimes(5000)
    await run(ingest)
    expect(ingest).toHaveBeenCalledTimes(5003)
    await run(ingest)
    expect(ingest).toHaveBeenCalledTimes(5003)
    expect(fetchPage.mock.calls.some(([q]) => q.includes('2026-09-21 12:00:00.123456'))).toBe(true)
  }, 60000)

  it('persists poison rows separately and progresses healthy events; retries recover independently', async () => {
    rows = [row('a'), row('b')]
    const ingest = vi.fn(async (input: Record<string, unknown>) => {
      if (input.cart_token === 'cart-a') throw new Error('transient')
      return {}
    })
    await run(ingest)
    expect(ingest).toHaveBeenCalledTimes(2)
    expect((await sql`SELECT status FROM posthog_recovery_receipts WHERE event_uuid='a'`)[0].status).toBe('retry')
    rows = []
    await sql`UPDATE posthog_recovery_receipts SET next_retry_at=now()-interval '1 minute'`
    const recovered = vi.fn(async () => ({}))
    await run(recovered)
    expect(recovered).toHaveBeenCalledTimes(1)
    expect((await sql`SELECT payload FROM posthog_recovery_receipts WHERE event_uuid='a'`)[0].payload).toBeNull()
  })

  it('prevents overlapping workers and resumes after interruption; finds late arrivals', async () => {
    rows = [row('a'), row('b')]
    let stop = false
    const ingest = vi.fn(async () => {
      stop = true
      expect((await run()).busy).toBe(true)
      return {}
    })
    await run(ingest, { shouldStop: () => stop })
    const next = vi.fn(async () => ({}))
    await run(next)
    expect(next).toHaveBeenCalledTimes(1)
    rows.push(row('c'))
    await run(next)
    expect(next).toHaveBeenCalledTimes(2)
  })

  it('retains malformed properties and partial business failures for retry', async () => {
    rows = [row('a', '{invalid'), row('b')]
    const result = await run(vi.fn(async () => ({ recovery_pending: true })))
    expect(result.errors).toBe(2)
    expect(
      await sql`SELECT event_uuid FROM posthog_recovery_receipts WHERE status='retry' ORDER BY event_uuid`,
    ).toHaveLength(2)
  })
  it('does not complete a receipt until cart refresh has also succeeded', async () => {
    rows = [row('a')]
    const commands = {
      ingestCartEvent: vi.fn(async () => ({ cart_id: 'cart-a' })),
      refreshCart: vi.fn(async () => {
        throw new Error('refresh failed')
      }),
    }
    await run((input) => ingestRecoveredCartEvent(input, commands))
    expect((await sql`SELECT status FROM posthog_recovery_receipts WHERE event_uuid='a'`)[0].status).toBe('retry')
    await sql`UPDATE posthog_recovery_receipts SET next_retry_at=now()-interval '1 minute'`
    rows = []
    await run((input) => ingestRecoveredCartEvent(input, { ...commands, refreshCart: async () => ({ selected: 1 }) }))
    expect((await sql`SELECT status FROM posthog_recovery_receipts WHERE event_uuid='a'`)[0].status).toBe('done')
  })

  it('fences expired workers before they can write receipts or cursor progress', async () => {
    rows = [row('a')]
    const ingest = vi.fn(async () => {
      await sql`UPDATE posthog_recovery_state SET lease_token='replacement-worker', lease_until=now()+interval '10 minutes'`
      return {}
    })
    await expect(run(ingest)).rejects.toThrow('lease lost')
    expect(await sql`SELECT * FROM posthog_recovery_receipts`).toHaveLength(0)
    expect((await sql`SELECT cursor_uuid,lease_token FROM posthog_recovery_state`)[0]).toMatchObject({
      cursor_uuid: null,
      lease_token: 'replacement-worker',
    })
    await sql`UPDATE posthog_recovery_state SET lease_until=now()-interval '1 minute'`
    await run()
    expect(await sql`SELECT * FROM posthog_recovery_receipts`).toHaveLength(1)
  })

  it('preserves separate class bootstrap marks and covers genesis for an unseen class', async () => {
    await sql`INSERT INTO carts VALUES ('cart:viewed','2026-09-20T13:14:15.123456Z')`
    await run()
    expect(fetchPage.mock.calls[0][0]).toContain("(event LIKE 'checkout:%')")
    expect(fetchPage.mock.calls[0][0]).toContain('2026-09-19 13:14:15.123456')
  })

  it('stops admitting work at its time budget and resumes without losing a row', async () => {
    rows = [row('a'), row('b')]
    let elapsed = Date.parse('2026-09-22T00:00:00Z')
    const ingest = vi.fn(async () => {
      elapsed += 50
      return {}
    })
    await run(ingest, { now: () => elapsed, budgetMs: 45 })
    expect(ingest).toHaveBeenCalledTimes(1)
    await run(ingest)
    expect(ingest).toHaveBeenCalledTimes(2)
  })
})

describe('PostHog recovery query', () => {
  it('keeps microseconds and uses the same UUID ordering in cursor and ORDER BY', () => {
    const query = recoveryPageQuery(
      {
        cart_since: null,
        checkout_since: null,
        sweep_until: '2026-09-22T00:00:00Z',
        cursor_timestamp: '2026-09-21 12:00:00.123456',
        cursor_uuid: 'abc',
      },
      500,
    )
    expect(query).toContain("toDateTime64('2026-09-21 12:00:00.123456', 6, 'UTC')")
    expect(query).toContain("toString(uuid) > 'abc'")
    expect(query).toContain('ORDER BY timestamp ASC, toString(uuid) ASC LIMIT 500')
  })
})
