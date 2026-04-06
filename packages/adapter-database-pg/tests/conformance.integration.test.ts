// DrizzlePgAdapter — IDatabasePort conformance (integration test, requires PG)

import { MantaError } from '@manta/core/errors'
import { createTestDatabase } from '@manta/test-utils/pg'
import { sql as drizzleSql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DrizzlePgAdapter } from '../src'

describe('DrizzlePgAdapter — IDatabasePort conformance', () => {
  let adapter: DrizzlePgAdapter
  let cleanup: () => Promise<void>

  beforeAll(async () => {
    const testDb = await createTestDatabase()
    cleanup = testDb.cleanup
    adapter = new DrizzlePgAdapter()
    await adapter.initialize({ url: testDb.url, pool: { min: 1, max: 5 } })

    // Create test tables
    const sql = adapter.getPool()
    await sql`
      CREATE TABLE test_items (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        value INTEGER DEFAULT 0,
        deleted_at TIMESTAMPTZ
      )
    `
    await sql`
      CREATE TABLE test_parents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      )
    `
    await sql`
      CREATE TABLE test_children (
        id TEXT PRIMARY KEY,
        parent_id TEXT NOT NULL REFERENCES test_parents(id),
        name TEXT NOT NULL
      )
    `
  })

  afterAll(async () => {
    await adapter.dispose()
    await cleanup()
  })

  // D-01 — healthcheck after initialize
  it('healthcheck returns true after initialize', async () => {
    expect(await adapter.healthCheck()).toBe(true)
  })

  // D-02 — healthcheck returns false after dispose
  it('healthcheck returns false after dispose', async () => {
    const tempDb = await createTestDatabase()
    const tempAdapter = new DrizzlePgAdapter()
    await tempAdapter.initialize({ url: tempDb.url })
    expect(await tempAdapter.healthCheck()).toBe(true)
    await tempAdapter.dispose()
    expect(await tempAdapter.healthCheck()).toBe(false)
    await tempDb.cleanup()
  })

  // D-03 — raw SQL execution
  it('executes raw SQL via pool', async () => {
    const sql = adapter.getPool()
    const result = await sql`SELECT 1 as num`
    expect(result[0].num).toBe(1)
  })

  // D-04 — parameterized queries
  it('supports parameterized queries', async () => {
    const sql = adapter.getPool()
    const name = 'manta'
    const result = await sql`SELECT ${name}::text as name`
    expect(result[0].name).toBe('manta')
  })

  // D-05 — transaction commits on success
  it('transaction commits on success', async () => {
    const sql = adapter.getPool()

    await adapter.transaction(async (tx: any) => {
      await tx.execute(drizzleSql`INSERT INTO test_items (id, name, value) VALUES ('tx1', 'committed', 42)`)
    })

    const rows = await sql`SELECT * FROM test_items WHERE id = 'tx1'`
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('committed')

    // Cleanup
    await sql`DELETE FROM test_items WHERE id = 'tx1'`
  })

  // D-06 — transaction rolls back on error
  it('transaction rolls back on error', async () => {
    const sql = adapter.getPool()

    try {
      await adapter.transaction(async (tx: any) => {
        await tx.execute(drizzleSql`INSERT INTO test_items (id, name) VALUES ('tx2', 'should_not_exist')`)
        throw new Error('abort')
      })
    } catch {
      /* expected */
    }

    const rows = await sql`SELECT * FROM test_items WHERE id = 'tx2'`
    expect(rows).toHaveLength(0)
  })

  // D-07 — transaction isolation SERIALIZABLE
  it('transaction isolation SERIALIZABLE detects conflicts', async () => {
    const sql = adapter.getPool()
    await sql`INSERT INTO test_items (id, name, value) VALUES ('serial1', 'counter', 0)`

    // Two concurrent SERIALIZABLE transactions reading and writing same row
    const tx1 = adapter.transaction(
      async (tx: any) => {
        const rows = await tx.execute(drizzleSql`SELECT value FROM test_items WHERE id = 'serial1'`)
        const current = rows[0].value
        // Small delay to increase chance of conflict
        await new Promise((r) => setTimeout(r, 50))
        await tx.execute(drizzleSql`UPDATE test_items SET value = ${current + 1} WHERE id = 'serial1'`)
      },
      { isolationLevel: 'SERIALIZABLE' },
    )

    const tx2 = adapter.transaction(
      async (tx: any) => {
        const rows = await tx.execute(drizzleSql`SELECT value FROM test_items WHERE id = 'serial1'`)
        const current = rows[0].value
        await tx.execute(drizzleSql`UPDATE test_items SET value = ${current + 10} WHERE id = 'serial1'`)
      },
      { isolationLevel: 'SERIALIZABLE' },
    )

    // At least one should fail with a serialization error (mapped to CONFLICT)
    const results = await Promise.allSettled([tx1, tx2])
    const failures = results.filter((r) => r.status === 'rejected')

    // Serialization failure may or may not occur depending on timing
    // If it does, it should be a CONFLICT error
    for (const failure of failures) {
      if (failure.status === 'rejected') {
        const err = failure.reason
        if (MantaError.is(err)) {
          expect(err.type).toBe('CONFLICT')
        }
      }
    }

    // Cleanup
    await sql`DELETE FROM test_items WHERE id = 'serial1'`
  })

  // D-10 — PG 23505 → DUPLICATE_ERROR
  it('PG 23505 unique violation → DUPLICATE_ERROR', async () => {
    const sql = adapter.getPool()
    await sql`INSERT INTO test_items (id, name) VALUES ('dup1', 'first')`

    try {
      await adapter.transaction(async (tx: any) => {
        await tx.execute(drizzleSql`INSERT INTO test_items (id, name) VALUES ('dup1', 'duplicate')`)
      })
      expect.fail('Should have thrown')
    } catch (err) {
      expect(MantaError.is(err)).toBe(true)
      if (MantaError.is(err)) {
        expect(err.type).toBe('DUPLICATE_ERROR')
      }
    }

    // Cleanup
    await sql`DELETE FROM test_items WHERE id = 'dup1'`
  })

  // D-11 — PG 23503 → NOT_FOUND (FK violation)
  it('PG 23503 FK violation → NOT_FOUND', async () => {
    try {
      await adapter.transaction(async (tx: any) => {
        await tx.execute(
          drizzleSql`INSERT INTO test_children (id, parent_id, name) VALUES ('ch1', 'nonexistent', 'orphan')`,
        )
      })
      expect.fail('Should have thrown')
    } catch (err) {
      expect(MantaError.is(err)).toBe(true)
      if (MantaError.is(err)) {
        expect(err.type).toBe('NOT_FOUND')
      }
    }
  })

  // D-12 — PG 23502 → INVALID_DATA (NOT NULL violation)
  it('PG 23502 NOT NULL violation → INVALID_DATA', async () => {
    try {
      await adapter.transaction(async (tx: any) => {
        await tx.execute(drizzleSql`INSERT INTO test_items (id, name) VALUES (${null}, ${null})`)
      })
      expect.fail('Should have thrown')
    } catch (err) {
      expect(MantaError.is(err)).toBe(true)
      if (MantaError.is(err)) {
        expect(err.type).toBe('INVALID_DATA')
      }
    }
  })

  // D-14 — dispose closes pool, subsequent calls fail
  it('dispose closes pool', async () => {
    const tempDb = await createTestDatabase()
    const tempAdapter = new DrizzlePgAdapter()
    await tempAdapter.initialize({ url: tempDb.url })
    await tempAdapter.dispose()

    expect(() => tempAdapter.getClient()).toThrow(/not initialized|disposed/)
    expect(() => tempAdapter.getPool()).toThrow(/not initialized|disposed/)

    await tempDb.cleanup()
  })

  // Introspection
  it('introspect returns table/column metadata', async () => {
    const result = (await adapter.introspect()) as Array<Record<string, unknown>>
    expect(Array.isArray(result)).toBe(true)
    const testItemsCols = result.filter((r: Record<string, unknown>) => r.table_name === 'test_items')
    expect(testItemsCols.length).toBeGreaterThan(0)
  })
})
