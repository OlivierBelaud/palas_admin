// ensureFrameworkSchema — versioned migration w/ advisory lock.
//
// Tests the logic layer with a fake `sql` tagged-template + `begin(cb)`
// shim. Real Postgres integration lives in the pg adapter integration tests
// (workflow-store.integration.test.ts etc.) which exercise the emitted DDL
// against a live database — here we only assert the decision flow:
//
// 1. Always creates the meta table first (before acquiring the lock).
// 2. Acquires the advisory lock inside a transaction.
// 3. Reads the current version, compares to FRAMEWORK_SCHEMA_VERSION.
// 4. Skips DDL when up-to-date.
// 5. Runs DDL + records the new version when stale.

import { describe, expect, it, vi } from 'vitest'
import { ensureFrameworkSchema, FRAMEWORK_SCHEMA_VERSION } from '../../../src/bootstrap/bootstrap-helpers'

interface Call {
  query: string
  args: unknown[]
}

/**
 * Build a fake postgres.js `sql` — records every query against the passed
 * log, and lets the test control what `SELECT version …` returns via
 * `currentVersion`.
 *
 * The real `sql` is a function (tagged template) with a `.begin(cb)` method.
 * We reproduce that shape exactly so `ensureFrameworkSchema` can't tell
 * it's not the real thing.
 */
function fakeSql(opts: { currentVersion: number | null; log: Call[] }) {
  const tagged = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join('?').trim().replace(/\s+/g, ' ')
    opts.log.push({ query: q, args: values })
    if (q.startsWith('SELECT version FROM manta_schema_versions')) {
      return Promise.resolve(opts.currentVersion === null ? [] : [{ version: opts.currentVersion }])
    }
    return Promise.resolve([])
  }
  ;(tagged as unknown as { begin: unknown }).begin = async (cb: (tx: typeof tagged) => Promise<unknown>) => {
    opts.log.push({ query: 'BEGIN', args: [] })
    const result = await cb(tagged)
    opts.log.push({ query: 'COMMIT', args: [] })
    return result
  }
  return tagged
}

function nullLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    // biome-ignore lint/suspicious/noExplicitAny: test stub
  } as any
}

describe('ensureFrameworkSchema — versioned migration', () => {
  it('creates the meta table BEFORE acquiring the advisory lock', async () => {
    const log: Call[] = []
    const sql = fakeSql({ currentVersion: FRAMEWORK_SCHEMA_VERSION, log })

    await ensureFrameworkSchema(sql, nullLogger())

    const metaIdx = log.findIndex((c) => c.query.includes('CREATE TABLE IF NOT EXISTS manta_schema_versions'))
    const beginIdx = log.findIndex((c) => c.query === 'BEGIN')
    const lockIdx = log.findIndex((c) => c.query.includes('pg_advisory_xact_lock'))
    expect(metaIdx).toBeGreaterThanOrEqual(0)
    expect(beginIdx).toBeGreaterThan(metaIdx)
    expect(lockIdx).toBeGreaterThan(beginIdx)
  })

  it('skips DDL when the current version is already up-to-date', async () => {
    const log: Call[] = []
    const sql = fakeSql({ currentVersion: FRAMEWORK_SCHEMA_VERSION, log })

    await ensureFrameworkSchema(sql, nullLogger())

    // No CREATE TABLE for framework tables should appear.
    const ddlHits = log.filter(
      (c) =>
        c.query.includes('CREATE TABLE IF NOT EXISTS workflow_runs') ||
        c.query.includes('CREATE TABLE IF NOT EXISTS workflow_checkpoints') ||
        c.query.includes('CREATE TABLE IF NOT EXISTS events') ||
        c.query.includes('CREATE TABLE IF NOT EXISTS job_executions'),
    )
    expect(ddlHits).toHaveLength(0)

    // And the version row should NOT be upserted.
    const upsert = log.find((c) => c.query.startsWith('INSERT INTO manta_schema_versions'))
    expect(upsert).toBeUndefined()
  })

  it('runs DDL and records the new version when stale', async () => {
    const log: Call[] = []
    const sql = fakeSql({ currentVersion: null, log }) // fresh DB

    await ensureFrameworkSchema(sql, nullLogger())

    // Framework tables are created.
    expect(log.some((c) => c.query.includes('CREATE TABLE IF NOT EXISTS workflow_runs'))).toBe(true)
    expect(log.some((c) => c.query.includes('CREATE TABLE IF NOT EXISTS workflow_checkpoints'))).toBe(true)
    expect(log.some((c) => c.query.includes('CREATE TABLE IF NOT EXISTS events'))).toBe(true)
    expect(log.some((c) => c.query.includes('CREATE TABLE IF NOT EXISTS job_executions'))).toBe(true)
    expect(log.some((c) => c.query.includes('CREATE TABLE IF NOT EXISTS workflow_progress'))).toBe(true)

    // Legacy table is dropped.
    expect(log.some((c) => c.query.includes('DROP TABLE IF EXISTS workflow_executions'))).toBe(true)

    // Version upserted with the current constant.
    const upsert = log.find((c) => c.query.startsWith('INSERT INTO manta_schema_versions'))
    expect(upsert).toBeDefined()
    expect(upsert?.args).toContain(FRAMEWORK_SCHEMA_VERSION)
  })

  it('upgrades from a lower version', async () => {
    const log: Call[] = []
    const sql = fakeSql({ currentVersion: 0, log }) // stale

    await ensureFrameworkSchema(sql, nullLogger())

    expect(log.some((c) => c.query.includes('CREATE TABLE IF NOT EXISTS workflow_runs'))).toBe(true)
    const upsert = log.find((c) => c.query.startsWith('INSERT INTO manta_schema_versions'))
    expect(upsert?.args).toContain(FRAMEWORK_SCHEMA_VERSION)
  })

  it('re-throws if the underlying query fails (caller decides whether to crash boot)', async () => {
    const tagged = () => Promise.reject(new Error('conn refused'))
    ;(tagged as unknown as { begin: unknown }).begin = () => Promise.reject(new Error('conn refused'))
    await expect(ensureFrameworkSchema(tagged as unknown as never, nullLogger())).rejects.toThrow('conn refused')
  })
})
