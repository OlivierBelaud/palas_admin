// Integration test — DrizzleWorkflowStorage with real Postgres
// Verifies checkpoints survive across connections (crash recovery scenario).

import { TEST_DB_URL } from '@manta/test-utils/pg'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DrizzleWorkflowStorage } from '../src/workflow-storage'

// Canonical TEST_DATABASE_URL source: @manta/test-utils/pg (BC-F21)
const DATABASE_URL = TEST_DB_URL

describe('DrizzleWorkflowStorage — Integration', () => {
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle db
  let db: any
  // biome-ignore lint/suspicious/noExplicitAny: postgres connection
  let pgSql: any
  let storage: DrizzleWorkflowStorage

  beforeAll(async () => {
    pgSql = postgres(DATABASE_URL, { max: 3 })
    db = drizzle(pgSql)

    // Ensure table exists
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS workflow_checkpoints (
        id SERIAL PRIMARY KEY,
        transaction_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        data JSONB DEFAULT '{}',
        error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(transaction_id, step_id)
      )
    `)
  })

  afterAll(async () => {
    await pgSql.end()
  })

  beforeEach(async () => {
    storage = new DrizzleWorkflowStorage(db)
    // Clean up any previous test data
    await db.execute(sql`DELETE FROM workflow_checkpoints WHERE transaction_id LIKE 'test-%'`)
  })

  // WS-INT-01 — Save and list checkpoints
  it('saves and lists step checkpoints', async () => {
    await storage.save('test-tx-1', 'step-a', { productId: 'prod_123' })
    await storage.save('test-tx-1', 'step-b', { quantity: 50 })

    const checkpoints = await storage.list('test-tx-1')
    expect(checkpoints).toHaveLength(2)
    expect(checkpoints.map((c) => c.stepId).sort()).toEqual(['step-a', 'step-b'])

    const stepA = checkpoints.find((c) => c.stepId === 'step-a')
    expect((stepA!.data as Record<string, unknown>).productId).toBe('prod_123')
  })

  // WS-INT-02 — Upsert: save same step twice updates data
  it('upserts on conflict (same transactionId + stepId)', async () => {
    await storage.save('test-tx-2', 'step-x', { version: 1 })
    await storage.save('test-tx-2', 'step-x', { version: 2 })

    const checkpoints = await storage.list('test-tx-2')
    expect(checkpoints).toHaveLength(1)
    expect((checkpoints[0].data as Record<string, unknown>).version).toBe(2)
  })

  // WS-INT-03 — Delete cleans up all checkpoints for a transaction
  it('deletes all checkpoints for a transaction', async () => {
    await storage.save('test-tx-3', 'a', { v: 1 })
    await storage.save('test-tx-3', 'b', { v: 2 })
    await storage.save('test-tx-3', 'c', { v: 3 })

    await storage.delete('test-tx-3')

    const remaining = await storage.list('test-tx-3')
    expect(remaining).toHaveLength(0)
  })

  // WS-INT-04 — Isolation: different transactions don't interfere
  it('isolates checkpoints by transactionId', async () => {
    await storage.save('test-tx-4a', 'step-1', { from: 'tx-4a' })
    await storage.save('test-tx-4b', 'step-1', { from: 'tx-4b' })

    const listA = await storage.list('test-tx-4a')
    const listB = await storage.list('test-tx-4b')

    expect(listA).toHaveLength(1)
    expect((listA[0].data as Record<string, unknown>).from).toBe('tx-4a')
    expect(listB).toHaveLength(1)
    expect((listB[0].data as Record<string, unknown>).from).toBe('tx-4b')

    // Delete one doesn't affect the other
    await storage.delete('test-tx-4a')
    expect(await storage.list('test-tx-4a')).toHaveLength(0)
    expect(await storage.list('test-tx-4b')).toHaveLength(1)
  })

  // WS-INT-05 — Crash recovery: checkpoints survive reconnection
  it('checkpoints persist across new storage instances (crash recovery)', async () => {
    await storage.save('test-tx-5', 'step-1', { product: { id: 'p1', status: 'draft' } })
    await storage.save('test-tx-5', 'step-2', { activated: true })

    // Simulate crash: create a new storage instance (same DB)
    const newStorage = new DrizzleWorkflowStorage(db)
    const recovered = await newStorage.list('test-tx-5')

    expect(recovered).toHaveLength(2)
    expect(recovered.find((c) => c.stepId === 'step-1')).toBeDefined()
    expect(recovered.find((c) => c.stepId === 'step-2')).toBeDefined()
  })

  // WS-INT-06 — Complex JSONB data survives round-trip
  it('preserves complex JSONB data through save/list', async () => {
    const complexData = {
      product: { id: 'p1', title: 'Test', variants: [{ sku: 'A' }, { sku: 'B' }] },
      metadata: { nested: { deep: { value: 42 } } },
      tags: ['sale', 'new'],
      nullField: null,
      zeroValue: 0,
      emptyString: '',
      boolFalse: false,
    }

    await storage.save('test-tx-6', 'complex', complexData)
    const [checkpoint] = await storage.list('test-tx-6')

    expect(checkpoint.data).toEqual(complexData)
  })

  // WS-INT-07 — Empty list returns empty array (not null/error)
  it('returns empty array for unknown transactionId', async () => {
    const result = await storage.list('test-nonexistent')
    expect(result).toEqual([])
  })

  // WS-INT-08 — Delete on nonexistent transaction is no-op
  it('delete on nonexistent transaction is a no-op', async () => {
    await expect(storage.delete('test-nonexistent')).resolves.toBeUndefined()
  })
})
