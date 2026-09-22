import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildLifecycleActorDailyFacts, refreshLifecycleFacts } from '../src/modules/visitor-session/lifecycle-facts'

const url = process.env.PALAS_TEST_DATABASE_URL
const suite = url ? describe : describe.skip
suite('lifecycle facts isolated PostgreSQL', () => {
  let sql: ReturnType<typeof postgres>
  const db = { raw: async <T>(q: string, p: unknown[] = []) => [...(await sql.unsafe(q, p as never[]))] as T[] }
  const range = { from: new Date('2026-09-19'), to: new Date('2026-09-19') }
  beforeAll(async () => {
    if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Local database required')
    sql = postgres(url, { max: 1, onnotice: () => {} })
    await sql`CREATE SCHEMA lifecycle_test`
    await sql`SET search_path TO lifecycle_test`
    await sql`CREATE TABLE visitor_sessions (distinct_id text, started_at timestamptz, last_event_at timestamptz, segment_at_session_start text, contact_id text, carts_viewed_in_session int, carts_created_in_session int, carts_updated_in_session int, cart_converted boolean, order_id text, became_customer_in_session boolean, email_acquired_in_session boolean, updated_at timestamptz DEFAULT NOW(), deleted_at timestamptz)`
    await sql`INSERT INTO visitor_sessions (distinct_id,started_at,last_event_at,segment_at_session_start,carts_viewed_in_session,cart_converted) SELECT 'actor-'||n,'2026-09-19T01:00Z','2026-09-19T02:00Z','unknown',1,false FROM generate_series(1,4250) n`
  })
  afterAll(async () => {
    if (sql) {
      await sql`DROP SCHEMA lifecycle_test CASCADE`
      await sql.end()
    }
  })
  it('refreshes 4250 actors without PostgreSQL parameter overflow', async () => {
    expect(await refreshLifecycleFacts(db, range)).toMatchObject({ facts: 4250, sessions: 4250, days: 1 })
  })
  it('leaves previous facts and ready snapshot intact on write failure', async () => {
    await sql`CREATE FUNCTION fail_fact() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected fact failure'; END $$`
    await sql`CREATE TRIGGER fail_fact BEFORE INSERT OR UPDATE ON visitor_lifecycle_actor_daily_facts FOR EACH ROW EXECUTE FUNCTION fail_fact()`
    await expect(refreshLifecycleFacts(db, range)).rejects.toThrow('injected fact failure')
    expect(Number((await sql`SELECT count(*) FROM visitor_lifecycle_actor_daily_facts`)[0].count)).toBe(4250)
    expect((await sql`SELECT status FROM visitor_lifecycle_day_snapshots`)[0].status).toBe('ready')
    await sql`DROP TRIGGER fail_fact ON visitor_lifecycle_actor_daily_facts`
  })
  it('detects metadata updates even when another session has a future event timestamp', async () => {
    await sql`UPDATE visitor_sessions SET last_event_at='2029-01-01' WHERE distinct_id='actor-2'`
    await refreshLifecycleFacts(db, range)
    await sql`UPDATE visitor_sessions SET contact_id='late-contact', updated_at=NOW() WHERE distinct_id='actor-3'`
    expect(await refreshLifecycleFacts(db, { ...range, onlyChanged: true })).toMatchObject({ days: 1 })
  })
  it('skips unchanged days and refreshes metadata changes and deleted sessions', async () => {
    expect(await refreshLifecycleFacts(db, { ...range, onlyChanged: true })).toMatchObject({ days: 0 })
    await sql`UPDATE visitor_sessions SET contact_id='contact', segment_at_session_start='returning_customer', updated_at=NOW()+INTERVAL '1 second' WHERE distinct_id='actor-1'`
    expect(await refreshLifecycleFacts(db, { ...range, onlyChanged: true })).toMatchObject({ days: 1 })
    expect(
      (await sql`SELECT segment_at_day_start FROM visitor_lifecycle_actor_daily_facts WHERE actor_key='actor-1'`)[0]
        .segment_at_day_start,
    ).toBe('returning_customer')
    await sql`UPDATE visitor_sessions SET deleted_at=NOW(), updated_at=NOW()+INTERVAL '2 seconds'`
    expect(await refreshLifecycleFacts(db, { ...range, onlyChanged: true })).toMatchObject({
      days: 1,
      facts: 0,
      sessions: 0,
    })
    expect(Number((await sql`SELECT count(*) FROM visitor_lifecycle_actor_daily_facts`)[0].count)).toBe(0)
  })
  it('matches the existing JS fold for multiple sessions and transitions', async () => {
    await sql`TRUNCATE visitor_sessions`
    await sql`INSERT INTO visitor_sessions VALUES ('a','2026-09-19T01:00Z','2026-09-19T02:00Z','unknown',NULL,1,0,0,false,NULL,false,false,NOW(),NULL),('a','2026-09-19T03:00Z','2026-09-19T04:00Z','known_no_purchase',NULL,0,1,1,true,'order',true,true,NOW(),NULL)`
    const sessions = await db.raw<Parameters<typeof buildLifecycleActorDailyFacts>[0][number]>(
      'SELECT * FROM visitor_sessions ORDER BY started_at',
    )
    await refreshLifecycleFacts(db, range)
    const expected = buildLifecycleActorDailyFacts(sessions, '2026-09-19', '2026-09-22T00:00:00Z')[0]
    const actual = (await sql`SELECT * FROM visitor_lifecycle_actor_daily_facts`)[0]
    for (const key of [
      'sessions',
      'segment_at_day_start',
      'cart_viewed',
      'cart_initiated',
      'cart_updated',
      'converted',
      'converted_sessions',
      'became_known',
      'became_customer',
      'known_without_contact',
      'converted_without_order_id',
      'became_customer_without_contact',
      'order_ids',
    ])
      expect(actual[key]).toEqual(expected[key as keyof typeof expected])
  })
})
