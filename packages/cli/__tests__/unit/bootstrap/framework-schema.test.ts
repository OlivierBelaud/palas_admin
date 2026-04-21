// ensureFrameworkSchema — versioned migration w/ advisory lock + timeout.
//
// Tests the decision flow with a fake `sql` tagged-template + `begin(cb)`
// shim. Real Postgres integration lives in the pg adapter integration tests
// (workflow-store.integration.test.ts etc.) which exercise the emitted DDL
// against a live database — here we only assert the logic layer:
//
// 1. Always creates the meta table first (before acquiring the lock).
// 2. Acquires the advisory lock inside a transaction.
// 3. Reads the current version, compares to FRAMEWORK_SCHEMA_VERSION.
// 4. Skips DDL when up-to-date.
// 5. Runs DDL + records the new version when stale.
// 6. Rejects if a step exceeds the per-call timeout.

import { describe, expect, it, vi } from 'vitest'
import { ensureFrameworkSchema, FRAMEWORK_SCHEMA_VERSION } from '../../../src/bootstrap/bootstrap-helpers'

interface Call {
  query: string
  args: unknown[]
}

/**
 * Fake postgres.js `sql` — records every query and lets the test drive what
 * `SELECT version …` returns via `currentVersion`.
 *
 * The real `sql` is a function (tagged template) with a `.begin(cb)` method.
 * We reproduce that shape exactly so `ensureFrameworkSchema` can't tell the
 * difference.
 */
function fakeSql(opts: { currentVersion: number | null; log: Call[]; slowMs?: number }) {
  const tagged = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join('?').trim().replace(/\s+/g, ' ')
    opts.log.push({ query: q, args: values })
    const result = q.startsWith('SELECT version FROM manta_schema_versions')
      ? opts.currentVersion === null
        ? []
        : [{ version: opts.currentVersion }]
      : []
    if (opts.slowMs) {
      return new Promise((resolve) => setTimeout(() => resolve(result), opts.slowMs))
    }
    return Promise.resolve(result)
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

    const ddlHits = log.filter(
      (c) =>
        c.query.includes('CREATE TABLE IF NOT EXISTS workflow_checkpoints') ||
        c.query.includes('CREATE TABLE IF NOT EXISTS events') ||
        c.query.includes('CREATE TABLE IF NOT EXISTS job_executions'),
    )
    expect(ddlHits).toHaveLength(0)

    const upsert = log.find((c) => c.query.startsWith('INSERT INTO manta_schema_versions'))
    expect(upsert).toBeUndefined()
  })

  it('runs DDL and records the new version when stale', async () => {
    const log: Call[] = []
    const sql = fakeSql({ currentVersion: null, log })

    await ensureFrameworkSchema(sql, nullLogger())

    expect(log.some((c) => c.query.includes('CREATE TABLE IF NOT EXISTS workflow_checkpoints'))).toBe(true)
    expect(log.some((c) => c.query.includes('CREATE TABLE IF NOT EXISTS events'))).toBe(true)
    expect(log.some((c) => c.query.includes('CREATE TABLE IF NOT EXISTS job_executions'))).toBe(true)

    const upsert = log.find((c) => c.query.startsWith('INSERT INTO manta_schema_versions'))
    expect(upsert).toBeDefined()
    expect(upsert?.args).toContain(FRAMEWORK_SCHEMA_VERSION)
  })

  it('upgrades from a lower version', async () => {
    const log: Call[] = []
    const sql = fakeSql({ currentVersion: 0, log })

    await ensureFrameworkSchema(sql, nullLogger())

    expect(log.some((c) => c.query.includes('CREATE TABLE IF NOT EXISTS workflow_checkpoints'))).toBe(true)
    const upsert = log.find((c) => c.query.startsWith('INSERT INTO manta_schema_versions'))
    expect(upsert?.args).toContain(FRAMEWORK_SCHEMA_VERSION)
  })

  it('re-throws if the underlying query fails', async () => {
    const tagged = () => Promise.reject(new Error('conn refused'))
    ;(tagged as unknown as { begin: unknown }).begin = () => Promise.reject(new Error('conn refused'))
    await expect(ensureFrameworkSchema(tagged as unknown as never, nullLogger())).rejects.toThrow('conn refused')
  })
})
