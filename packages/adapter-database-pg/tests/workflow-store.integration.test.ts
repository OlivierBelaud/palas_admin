// Integration test — DrizzleWorkflowStore with real Postgres.
// Verifies the durable run store for workflow progress tracking.

import { TEST_DB_URL } from '@manta/test-utils/pg'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DrizzleWorkflowStore } from '../src/workflow-store'

const DATABASE_URL = TEST_DB_URL

describe('DrizzleWorkflowStore — Integration', () => {
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle db
  let db: any
  // biome-ignore lint/suspicious/noExplicitAny: postgres connection
  let pgSql: any
  let store: DrizzleWorkflowStore

  beforeAll(async () => {
    pgSql = postgres(DATABASE_URL, { max: 3 })
    db = drizzle(pgSql)

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS workflow_runs (
        id TEXT PRIMARY KEY,
        command_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        steps JSONB NOT NULL DEFAULT '[]',
        input JSONB NOT NULL DEFAULT '{}',
        output JSONB,
        error JSONB,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        cancel_requested_at TIMESTAMPTZ,
        heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    // WP-F04 — heartbeat_at is written by updateStep; tolerate tables created
    // before that migration landed.
    await db.execute(
      sql`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    )
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_cmd_started ON workflow_runs(command_name, started_at DESC)
    `)
  })

  afterAll(async () => {
    await pgSql.end()
  })

  beforeEach(async () => {
    store = new DrizzleWorkflowStore(db)
    await db.execute(sql`DELETE FROM workflow_runs WHERE id LIKE 'test-%'`)
  })

  // WS-RUN-01 — create inserts a row with the right shape
  it('WS-RUN-01 — create inserts a row with the right shape', async () => {
    await store.create({
      id: 'test-run-01',
      command_name: 'products:import',
      steps: [
        { name: 'fetch', status: 'pending' },
        { name: 'persist', status: 'pending' },
      ],
      input: { source: 'csv' },
    })

    const got = await store.get('test-run-01')
    expect(got).not.toBeNull()
    expect(got!.id).toBe('test-run-01')
    expect(got!.command_name).toBe('products:import')
    expect(got!.status).toBe('pending')
    expect(got!.steps).toHaveLength(2)
    expect(got!.input).toEqual({ source: 'csv' })
    expect(got!.started_at).toBeInstanceOf(Date)
    expect(got!.completed_at).toBeUndefined()
    expect(got!.cancel_requested_at).toBeUndefined()
  })

  // WS-RUN-02 — get returns null for unknown runId
  it('WS-RUN-02 — get returns null for unknown runId', async () => {
    const result = await store.get('test-nonexistent')
    expect(result).toBeNull()
  })

  // WS-RUN-03 — get roundtrips steps + input + timestamps
  it('WS-RUN-03 — get roundtrips steps + input + timestamps', async () => {
    const steps = [
      { name: 'a', status: 'pending' as const },
      { name: 'b', status: 'pending' as const },
      { name: 'c', status: 'pending' as const },
    ]
    const input = { nested: { deep: { value: 42 } }, tags: ['x', 'y'], empty: '' }

    await store.create({ id: 'test-run-03', command_name: 'cmd', steps, input })
    const got = await store.get('test-run-03')

    expect(got!.steps).toEqual(steps)
    expect(got!.input).toEqual(input)
    expect(got!.started_at).toBeInstanceOf(Date)
  })

  // WS-RUN-04 — updateStep patches matching step by name, preserves others
  it('WS-RUN-04 — updateStep patches matching step by name, preserves others', async () => {
    await store.create({
      id: 'test-run-04',
      command_name: 'cmd',
      steps: [
        { name: 'a', status: 'pending' },
        { name: 'b', status: 'pending' },
        { name: 'c', status: 'pending' },
      ],
      input: {},
    })

    const startedAt = new Date('2026-01-01T00:00:00Z')
    await store.updateStep('test-run-04', 'b', { status: 'running', started_at: startedAt })

    const got = await store.get('test-run-04')
    expect(got!.steps).toHaveLength(3)
    expect(got!.steps[0]).toEqual({ name: 'a', status: 'pending' })
    expect(got!.steps[1].name).toBe('b')
    expect(got!.steps[1].status).toBe('running')
    expect(new Date(got!.steps[1].started_at as unknown as string).toISOString()).toBe(startedAt.toISOString())
    expect(got!.steps[2]).toEqual({ name: 'c', status: 'pending' })
  })

  // WS-RUN-05 — updateStatus sets terminal fields (status + output + completed_at)
  it('WS-RUN-05 — updateStatus sets terminal fields', async () => {
    await store.create({
      id: 'test-run-05',
      command_name: 'cmd',
      steps: [{ name: 'only', status: 'pending' }],
      input: {},
    })

    const completedAt = new Date('2026-02-01T12:34:56Z')
    await store.updateStatus('test-run-05', 'succeeded', {
      output: { result: 'ok', count: 3 },
      completed_at: completedAt,
    })

    const got = await store.get('test-run-05')
    expect(got!.status).toBe('succeeded')
    expect(got!.output).toEqual({ result: 'ok', count: 3 })
    expect(new Date(got!.completed_at as Date).toISOString()).toBe(completedAt.toISOString())
  })

  // WS-RUN-06 — requestCancel sets cancel_requested_at once; idempotent on repeat
  it('WS-RUN-06 — requestCancel is idempotent on repeat', async () => {
    await store.create({
      id: 'test-run-06',
      command_name: 'cmd',
      steps: [{ name: 'only', status: 'pending' }],
      input: {},
    })
    await store.updateStatus('test-run-06', 'running')

    await store.requestCancel('test-run-06')
    const afterFirst = await store.get('test-run-06')
    expect(afterFirst!.cancel_requested_at).toBeInstanceOf(Date)
    const firstTs = (afterFirst!.cancel_requested_at as Date).getTime()

    // Repeat — must not overwrite the original timestamp.
    await store.requestCancel('test-run-06')
    const afterSecond = await store.get('test-run-06')
    expect((afterSecond!.cancel_requested_at as Date).getTime()).toBe(firstTs)
  })

  // WS-RUN-07 — requestCancel is no-op if status already terminal
  it('WS-RUN-07 — requestCancel is no-op if status already terminal', async () => {
    await store.create({
      id: 'test-run-07',
      command_name: 'cmd',
      steps: [{ name: 'only', status: 'succeeded' }],
      input: {},
    })
    await store.updateStatus('test-run-07', 'succeeded', { completed_at: new Date() })

    await store.requestCancel('test-run-07')

    const got = await store.get('test-run-07')
    expect(got!.status).toBe('succeeded')
    expect(got!.cancel_requested_at).toBeUndefined()
  })

  // WS-RUN-08 — concurrent updateStep calls to distinct step names don't lose updates
  it('WS-RUN-08 — concurrent updateStep calls survive (no lost update)', async () => {
    await store.create({
      id: 'test-run-08',
      command_name: 'cmd',
      steps: [
        { name: 'a', status: 'pending' },
        { name: 'b', status: 'pending' },
        { name: 'c', status: 'pending' },
      ],
      input: {},
    })

    await Promise.all([
      store.updateStep('test-run-08', 'a', { status: 'running' }),
      store.updateStep('test-run-08', 'b', { status: 'running' }),
      store.updateStep('test-run-08', 'c', { status: 'running' }),
    ])

    const got = await store.get('test-run-08')
    expect(got!.steps.map((s) => [s.name, s.status]).sort()).toEqual([
      ['a', 'running'],
      ['b', 'running'],
      ['c', 'running'],
    ])
  })

  // WS-RUN-09 — updateStep appends when step name absent, preserving existing steps
  it('WS-RUN-09 — updateStep appends when step name absent, preserving existing steps', async () => {
    await store.create({
      id: 'test-run-09',
      command_name: 'cmd',
      steps: [{ name: 'existing', status: 'succeeded' }],
      input: {},
    })

    const startedAt = new Date('2026-03-01T00:00:00Z')
    await store.updateStep('test-run-09', 'discovered', { status: 'running', started_at: startedAt })

    const got = await store.get('test-run-09')
    expect(got!.steps).toHaveLength(2)
    // Existing step untouched
    expect(got!.steps[0]).toEqual({ name: 'existing', status: 'succeeded' })
    // Newly appended step
    expect(got!.steps[1].name).toBe('discovered')
    expect(got!.steps[1].status).toBe('running')
    expect(new Date(got!.steps[1].started_at as unknown as string).toISOString()).toBe(startedAt.toISOString())
  })

  // WS-RUN-10 — updateStep merges when step name present (existing fields preserved, patched fields updated)
  it('WS-RUN-10 — updateStep merges when step name present, existing fields preserved', async () => {
    const startedAt = new Date('2026-03-02T00:00:00Z')
    await store.create({
      id: 'test-run-10',
      command_name: 'cmd',
      steps: [{ name: 'a', status: 'running', started_at: startedAt }],
      input: {},
    })

    const completedAt = new Date('2026-03-02T00:00:05Z')
    // Patch only status + completed_at; started_at must be preserved from the original row.
    await store.updateStep('test-run-10', 'a', { status: 'succeeded', completed_at: completedAt })

    const got = await store.get('test-run-10')
    expect(got!.steps).toHaveLength(1)
    expect(got!.steps[0].name).toBe('a')
    expect(got!.steps[0].status).toBe('succeeded')
    expect(new Date(got!.steps[0].started_at as unknown as string).toISOString()).toBe(startedAt.toISOString())
    expect(new Date(got!.steps[0].completed_at as unknown as string).toISOString()).toBe(completedAt.toISOString())
  })

  // WS-RUN-11 — concurrent updateStep with one APPEND and one MERGE does not lose data
  it('WS-RUN-11 — concurrent append + merge do not lose data', async () => {
    await store.create({
      id: 'test-run-11',
      command_name: 'cmd',
      steps: [{ name: 'existing', status: 'pending' }],
      input: {},
    })

    await Promise.all([
      // Merge into existing step
      store.updateStep('test-run-11', 'existing', { status: 'running' }),
      // Append a brand-new step
      store.updateStep('test-run-11', 'fresh', { status: 'running' }),
    ])

    const got = await store.get('test-run-11')
    expect(got!.steps).toHaveLength(2)
    const byName = Object.fromEntries(got!.steps.map((s) => [s.name, s.status]))
    expect(byName.existing).toBe('running')
    expect(byName.fresh).toBe('running')
  })
})
