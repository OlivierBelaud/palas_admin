import { readFileSync } from 'node:fs'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { compactTrackingHistory, purgeTrackingWorkflows } from '../src/modules/event-hub/retention'

const url = process.env.PALAS_TEST_DATABASE_URL
const suite = url ? describe : describe.skip
suite('tracking retention on isolated PostgreSQL', () => {
  let sql: ReturnType<typeof postgres>
  const db = {
    raw: async <T>(query: string, params: unknown[] = []) => [...(await sql.unsafe(query, params as never[]))] as T[],
  }
  beforeAll(async () => {
    if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Local test DB required')
    sql = postgres(url, { max: 1 })
    await sql`CREATE SCHEMA IF NOT EXISTS retention_test`
    await sql`SET search_path TO retention_test`
    for (const f of ['20260609152000_event_hub_logs.sql', '20260609233000_dispatch_logs.sql']) {
      await sql.unsafe(readFileSync(new URL(`../drizzle/migrations/${f}`, import.meta.url), 'utf8'))
    }
    await sql`ALTER TABLE event_logs ADD COLUMN IF NOT EXISTS dispatch_prepared_at timestamptz`
    await sql`CREATE TABLE IF NOT EXISTS workflow_runs (id text PRIMARY KEY, command_name text, status text, completed_at timestamptz, steps jsonb, input jsonb, output jsonb, error jsonb, started_at timestamptz DEFAULT NOW())`
    await sql`CREATE TABLE IF NOT EXISTS workflow_checkpoints (transaction_id text, data jsonb)`
    await sql`TRUNCATE event_logs, dispatch_logs, workflow_runs, workflow_checkpoints`
  })
  afterAll(async () => {
    if (sql) {
      await sql`DROP SCHEMA retention_test CASCADE`
      await sql.end()
    }
  })
  it('compacts old sent diagnostics but preserves receipts, fresh deliveries and pending work', async () => {
    for (const [id, status, age] of [
      ['old', 'sent', 48],
      ['pending', 'pending', 48],
      ['recent', 'sent', 1],
      ['unconfigured', 'not_configured', 48],
      ['error', 'error', 48],
    ]) {
      await sql`INSERT INTO dispatch_logs(id,event_destination_key,event_id,canonical_event_name,destination,status,event_received_at,updated_at,sent_at,request_payload,response_payload,metadata) VALUES(${id},${id},${id},'purchase','meta_capi',${status},NOW()-INTERVAL '10 days',NOW()-${age}*INTERVAL '1 hour',NOW()-${age}*INTERVAL '1 hour','{"customer":"private"}','{"ok":true}','{"email":"private"}')`
      await sql`INSERT INTO event_logs(id,event_id,event_name,source,received_at,payload_normalized,dispatch_prepared_at) VALUES(${id},${id},'purchase','test',NOW()-INTERVAL '10 days','{"private":true}',NOW()-INTERVAL '10 days')`
    }
    await compactTrackingHistory(db)
    const rows = await sql`SELECT id,request_payload FROM dispatch_logs ORDER BY id`
    expect(rows).toHaveLength(5)
    expect(rows.find((r) => r.id === 'old')?.request_payload).toBeNull()
    for (const id of ['pending', 'recent', 'unconfigured', 'error'])
      expect(rows.find((r) => r.id === id)?.request_payload).not.toBeNull()
    const events = await sql`SELECT id,payload_normalized FROM event_logs`
    expect(events.find((r) => r.id === 'old')?.payload_normalized).toBeNull()
    expect(events.find((r) => r.id === 'pending')?.payload_normalized).not.toBeNull()
  })
  it('preserves partially provisioned canonical events', async () => {
    await sql`INSERT INTO event_logs(id,event_id,event_name,source,received_at,payload_normalized) VALUES('partial','partial','purchase','test',NOW()-INTERVAL '2 days','{"private":true}')`
    await compactTrackingHistory(db)
    expect(
      (await sql`SELECT payload_normalized FROM event_logs WHERE id='partial'`)[0].payload_normalized,
    ).not.toBeNull()
  })
  it('removes only old successful allowlisted workflows and their checkpoints', async () => {
    for (const [id, command, status] of [
      ['ok', 'cmd:ingestCartEvent', 'succeeded'],
      ['active', 'cmd:ingestCartEvent', 'pending'],
      ['business', 'cmd:placeOrder', 'succeeded'],
      ['failed', 'cmd:ingestCartEvent', 'failed'],
    ]) {
      await sql`INSERT INTO workflow_runs(id,command_name,status,completed_at,steps,input,output,error) VALUES(${id},${command},${status},NOW()-INTERVAL '2 days','[]','{}','{}',NULL)`
      await sql`INSERT INTO workflow_checkpoints VALUES(${id},'{"private":true}')`
    }
    await compactTrackingHistory(db)
    expect((await sql`SELECT id FROM workflow_runs ORDER BY id`).map((r) => r.id)).toEqual([
      'active',
      'business',
      'failed',
    ])
    expect(
      (await sql`SELECT transaction_id FROM workflow_checkpoints ORDER BY transaction_id`).map((r) => r.transaction_id),
    ).toEqual(['active', 'business', 'failed'])
  })

  it('does not scan the entire checkpoint history to prune a bounded workflow batch', async () => {
    await sql`TRUNCATE event_logs, dispatch_logs, workflow_runs, workflow_checkpoints`
    await sql`CREATE INDEX IF NOT EXISTS retention_checkpoint_tx_idx ON workflow_checkpoints(transaction_id)`
    await sql`INSERT INTO workflow_runs(id,command_name,status,started_at,completed_at)
      SELECT 'eligible-' || n, 'cmd:ingestCartEvent', 'succeeded',
        NOW()-INTERVAL '3 days', NOW()-INTERVAL '2 days'
      FROM generate_series(1,1000) n`
    await sql`INSERT INTO workflow_checkpoints(transaction_id,data)
      SELECT 'eligible-' || n, '{}'::jsonb FROM generate_series(1,1000) n`
    await sql`INSERT INTO workflow_checkpoints(transaction_id,data)
      SELECT 'unrelated-' || (n % 12000), '{}'::jsonb FROM generate_series(1,600000) n`
    await sql`ANALYZE workflow_runs`
    await sql`ANALYZE workflow_checkpoints`

    const scans: string[] = []
    type PlanNode = { 'Node Type': string; 'Relation Name'?: string; Plans?: PlanNode[] }
    function collectScans(node: PlanNode) {
      if (node['Relation Name'] === 'workflow_checkpoints') scans.push(node['Node Type'])
      for (const child of node.Plans ?? []) collectScans(child)
    }
    const measuredDb = {
      raw: async <T>(query: string, params: unknown[] = []) => {
        if (query.includes('DELETE FROM workflow_checkpoints')) {
          const plan = await sql.unsafe(`EXPLAIN (FORMAT JSON) ${query}`, params as never[])
          collectScans(plan[0]['QUERY PLAN'][0].Plan)
        }
        return [...(await sql.unsafe(query, params as never[]))] as T[]
      },
    }
    const result = await compactTrackingHistory(measuredDb)
    expect(result.workflows_deleted).toBe(200)
    expect(scans).not.toContain('Seq Scan')
    expect((await sql`SELECT COUNT(*)::int AS count FROM workflow_runs`)[0].count).toBe(800)
    expect(
      (await sql`SELECT COUNT(*)::int AS count FROM workflow_checkpoints WHERE transaction_id LIKE 'unrelated-%'`)[0]
        .count,
    ).toBe(600000)
  }, 30_000)

  it('selects a diagnostic batch from a large backlog using the retention index', async () => {
    await sql`TRUNCATE event_logs, dispatch_logs, workflow_runs, workflow_checkpoints`
    await sql`INSERT INTO dispatch_logs(id,event_destination_key,event_id,canonical_event_name,
      destination,status,event_received_at,updated_at,request_payload)
      SELECT n::text,n::text,n::text,'purchase','meta_capi',
        CASE WHEN n <= 20000 THEN 'sent' ELSE 'pending' END,
        NOW()-INTERVAL '3 days',NOW()-INTERVAL '2 days','{"diagnostic":true}'::jsonb
      FROM generate_series(1,30000) n`
    const migration = readFileSync(new URL('../scripts/neon-retention-indexes.sql', import.meta.url), 'utf8')
    for (const statement of migration.split(';').filter((part) => part.trim())) await sql.unsafe(statement)
    await sql`ANALYZE dispatch_logs`

    let planText = ''
    const measuredDb = {
      raw: async <T>(query: string, params: unknown[] = []) => {
        if (query.includes('UPDATE dispatch_logs SET request_payload')) {
          const plan = await sql.unsafe(`EXPLAIN (FORMAT JSON) ${query}`, params as never[])
          planText = JSON.stringify(plan[0]['QUERY PLAN'])
        }
        return [...(await sql.unsafe(query, params as never[]))] as T[]
      },
    }
    const result = await compactTrackingHistory(measuredDb)
    expect(result.dispatches_compacted).toBe(1000)
    expect(planText).toContain('dispatch_logs_retention_pending_idx')
    expect(
      (
        await sql`SELECT COUNT(*)::int AS count FROM dispatch_logs WHERE status='pending' AND request_payload IS NOT NULL`
      )[0].count,
    ).toBe(10000)
  }, 30_000)
  it('drains a larger explicit batch without deleting active, failed, recent or business workflows', async () => {
    await sql`TRUNCATE event_logs, dispatch_logs, workflow_runs, workflow_checkpoints`
    await sql`INSERT INTO workflow_runs(id,command_name,status,started_at,completed_at)
      SELECT 'backlog-' || n, 'cmd:ingestCartEvent', 'succeeded',
        NOW()-INTERVAL '3 days', NOW()-INTERVAL '2 days' FROM generate_series(1,1500) n`
    await sql`INSERT INTO workflow_checkpoints(transaction_id,data)
      SELECT 'backlog-' || n, '{}'::jsonb FROM generate_series(1,1500) n`
    for (const [id, command, status, completed] of [
      ['active', 'cmd:ingestCartEvent', 'running', '2026-01-01'],
      ['failed', 'cmd:ingestCartEvent', 'failed', '2026-01-01'],
      ['business', 'cmd:placeOrder', 'succeeded', '2026-01-01'],
      ['incomplete', 'cmd:ingestCartEvent', 'succeeded', null],
      ['recent', 'cmd:ingestCartEvent', 'succeeded', new Date().toISOString()],
    ]) {
      await sql`INSERT INTO workflow_runs(id,command_name,status,completed_at)
        VALUES(${id},${command},${status},${completed})`
      await sql`INSERT INTO workflow_checkpoints VALUES(${id},'{}'::jsonb)`
    }
    expect(await purgeTrackingWorkflows(db, 1000)).toBe(1000)
    expect((await sql`SELECT count(*)::int AS n FROM workflow_runs WHERE id LIKE 'backlog-%'`)[0].n).toBe(500)
    for (const id of ['active', 'failed', 'business', 'incomplete', 'recent']) {
      expect(await sql`SELECT id FROM workflow_runs WHERE id=${id}`).toHaveLength(1)
      expect(await sql`SELECT transaction_id FROM workflow_checkpoints WHERE transaction_id=${id}`).toHaveLength(1)
    }
    expect(
      (await sql`SELECT count(*)::int AS n FROM workflow_checkpoints WHERE transaction_id LIKE 'backlog-%'`)[0].n,
    ).toBe(500)
  })
  it.each([
    0,
    -1,
    5001,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects unsafe operator batch size %s before issuing SQL', async (limit) => {
    let calls = 0
    const guardedDb = {
      raw: async <T>(): Promise<T[]> => {
        calls += 1
        return []
      },
    }
    await expect(purgeTrackingWorkflows(guardedDb, limit)).rejects.toThrow(RangeError)
    expect(calls).toBe(0)
  })
})
