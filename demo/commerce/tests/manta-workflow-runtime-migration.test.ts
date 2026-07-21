import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('Manta workflow runtime compatibility migration', () => {
  it('materializes the durable workflow tables used by the production runtime', async () => {
    const migration = await readFile(
      new URL('../drizzle/migrations/20260721100000_manta_workflow_runtime.sql', import.meta.url),
      'utf8',
    )

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "workflow_runs"')
    expect(migration).toContain('"heartbeat_at" TIMESTAMPTZ NOT NULL')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "workflow_progress"')
    expect(migration).toContain('"at_ms" BIGINT NOT NULL')
  })

  it('preserves recovery evidence on rollback', async () => {
    const rollback = await readFile(
      new URL('../drizzle/migrations/20260721100000_manta_workflow_runtime.down.sql', import.meta.url),
      'utf8',
    )

    expect(rollback).not.toContain('DROP TABLE')
    expect(rollback).not.toContain('DELETE FROM')
  })
})
