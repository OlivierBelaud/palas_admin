// WP-F04 — Integration tests for the orphan-reaper support in DrizzleWorkflowStore.
//
// Covers the new IWorkflowStorePort methods (listOrphans + markOrphanFailed)
// and the heartbeat bump side-effect on updateStep — the three pieces needed
// by the framework-owned orphan-reaper job.

import { TEST_DB_URL } from '@manta/test-utils/pg'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DrizzleWorkflowStore } from '../src/workflow-store'

const DATABASE_URL = TEST_DB_URL

describe('DrizzleWorkflowStore — Orphan support (WS-ORPHAN)', () => {
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle db
  let db: any
  // biome-ignore lint/suspicious/noExplicitAny: postgres connection
  let pgSql: any
  let store: DrizzleWorkflowStore

  beforeAll(async () => {
    pgSql = postgres(DATABASE_URL, { max: 3 })
    db = drizzle(pgSql)

    // Fresh schema with heartbeat_at column (matches the production migration
    // in ensureFrameworkTables). Kept local so the test is honest even if the
    // production DDL is refactored.
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
    // ALTER for tables created before the WP-F04 migration landed.
    await db.execute(
      sql`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    )
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_heartbeat ON workflow_runs(status, heartbeat_at) WHERE status = 'running'
    `)
  })

  afterAll(async () => {
    await pgSql.end()
  })

  beforeEach(async () => {
    store = new DrizzleWorkflowStore(db)
    await db.execute(sql`DELETE FROM workflow_runs WHERE id LIKE 'orphan-%'`)
  })

  // Helper — seed a run with a chosen status + explicit heartbeat_at.
  async function seedRun(id: string, status: string, heartbeatOffsetMs: number): Promise<void> {
    const heartbeatAt = new Date(Date.now() - heartbeatOffsetMs)
    await store.create({ id, command_name: 'cmd', steps: [{ name: 'only', status: 'pending' }], input: {} })
    // Force status + heartbeat_at to our chosen values (create() leaves status='pending'
    // and sets heartbeat_at=NOW() via the column default).
    await db.execute(sql`UPDATE workflow_runs SET status = ${status}, heartbeat_at = ${heartbeatAt} WHERE id = ${id}`)
  }

  // WS-ORPHAN-01 — listOrphans returns runs with status='running' AND heartbeat_at < threshold
  it('WS-ORPHAN-01 — listOrphans returns running runs older than the threshold', async () => {
    // Old orphan (heartbeat 10 min ago)
    await seedRun('orphan-old-1', 'running', 10 * 60 * 1000)
    // Fresh running (heartbeat 30 sec ago) — must be excluded
    await seedRun('orphan-fresh', 'running', 30 * 1000)

    const cutoff = new Date(Date.now() - 5 * 60 * 1000) // 5 min threshold
    const orphans = await store.listOrphans({ olderThan: cutoff })

    const ids = orphans.map((o) => o.id).sort()
    expect(ids).toContain('orphan-old-1')
    expect(ids).not.toContain('orphan-fresh')
  })

  // WS-ORPHAN-02 — listOrphans respects the `limit` parameter
  it('WS-ORPHAN-02 — listOrphans respects the limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      await seedRun(`orphan-many-${i}`, 'running', 10 * 60 * 1000)
    }

    const cutoff = new Date(Date.now() - 5 * 60 * 1000)
    const limited = await store.listOrphans({ olderThan: cutoff, limit: 2 })
    expect(limited.length).toBeLessThanOrEqual(2)

    // Default limit (50) returns all of them.
    const all = await store.listOrphans({ olderThan: cutoff })
    expect(all.length).toBeGreaterThanOrEqual(5)
  })

  // WS-ORPHAN-03 — listOrphans excludes terminal statuses (succeeded/failed/cancelled)
  it('WS-ORPHAN-03 — listOrphans excludes terminal statuses', async () => {
    await seedRun('orphan-succeeded', 'succeeded', 10 * 60 * 1000)
    await seedRun('orphan-failed', 'failed', 10 * 60 * 1000)
    await seedRun('orphan-cancelled', 'cancelled', 10 * 60 * 1000)
    await seedRun('orphan-pending', 'pending', 10 * 60 * 1000)
    await seedRun('orphan-running', 'running', 10 * 60 * 1000)

    const cutoff = new Date(Date.now() - 5 * 60 * 1000)
    const orphans = await store.listOrphans({ olderThan: cutoff })
    const ids = orphans.map((o) => o.id)

    expect(ids).toContain('orphan-running')
    expect(ids).not.toContain('orphan-succeeded')
    expect(ids).not.toContain('orphan-failed')
    expect(ids).not.toContain('orphan-cancelled')
    expect(ids).not.toContain('orphan-pending')
  })

  // WS-ORPHAN-04 — markOrphanFailed sets status + error + completed_at
  it('WS-ORPHAN-04 — markOrphanFailed sets status=failed + error + completed_at', async () => {
    await seedRun('orphan-mark-01', 'running', 10 * 60 * 1000)

    await store.markOrphanFailed('orphan-mark-01', {
      message: 'Workflow orphaned — no heartbeat for 300s',
      code: 'WORKFLOW_ORPHANED',
    })

    const got = await store.get('orphan-mark-01')
    expect(got).not.toBeNull()
    expect(got!.status).toBe('failed')
    expect(got!.error).toEqual({
      message: 'Workflow orphaned — no heartbeat for 300s',
      code: 'WORKFLOW_ORPHANED',
    })
    expect(got!.completed_at).toBeInstanceOf(Date)
  })

  // WS-ORPHAN-05 — markOrphanFailed is a no-op on already-terminal runs
  it('WS-ORPHAN-05 — markOrphanFailed is idempotent/no-op on already-terminal runs', async () => {
    await seedRun('orphan-noop-succeeded', 'succeeded', 10 * 60 * 1000)
    // Set completed_at so the test can assert preservation later.
    const originalCompletedAt = new Date('2020-01-01T00:00:00Z')
    await db.execute(
      sql`UPDATE workflow_runs SET completed_at = ${originalCompletedAt} WHERE id = 'orphan-noop-succeeded'`,
    )

    await store.markOrphanFailed('orphan-noop-succeeded', {
      message: 'should not apply',
      code: 'WORKFLOW_ORPHANED',
    })

    const got = await store.get('orphan-noop-succeeded')
    expect(got!.status).toBe('succeeded') // status not overwritten
    expect(got!.error).toBeUndefined() // error not written
    expect((got!.completed_at as Date).getTime()).toBe(originalCompletedAt.getTime())
  })

  // WS-ORPHAN-06 — updateStep bumps heartbeat_at
  it('WS-ORPHAN-06 — updateStep bumps heartbeat_at on every call', async () => {
    await store.create({
      id: 'orphan-heartbeat-01',
      command_name: 'cmd',
      steps: [{ name: 'a', status: 'pending' }],
      input: {},
    })

    // Force an old heartbeat.
    const stale = new Date(Date.now() - 10 * 60 * 1000)
    await db.execute(sql`UPDATE workflow_runs SET heartbeat_at = ${stale} WHERE id = 'orphan-heartbeat-01'`)

    // Sanity: the update above really set an old heartbeat.
    const beforeRows = await db.execute(sql`SELECT heartbeat_at FROM workflow_runs WHERE id = 'orphan-heartbeat-01'`)
    const beforeHeartbeat = new Date((beforeRows as Array<{ heartbeat_at: string }>)[0].heartbeat_at)
    expect(beforeHeartbeat.getTime()).toBeLessThan(Date.now() - 5 * 60 * 1000)

    // updateStep must bump heartbeat_at to ~NOW().
    await store.updateStep('orphan-heartbeat-01', 'a', { status: 'running', started_at: new Date() })

    const afterRows = await db.execute(sql`SELECT heartbeat_at FROM workflow_runs WHERE id = 'orphan-heartbeat-01'`)
    const afterHeartbeat = new Date((afterRows as Array<{ heartbeat_at: string }>)[0].heartbeat_at)

    // The bumped heartbeat is strictly newer than the stale one.
    expect(afterHeartbeat.getTime()).toBeGreaterThan(beforeHeartbeat.getTime())
    // And very close to NOW (within 30s — generous to accommodate CI jitter).
    expect(Date.now() - afterHeartbeat.getTime()).toBeLessThan(30 * 1000)
  })
})
