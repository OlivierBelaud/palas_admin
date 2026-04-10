// RQ-01..RQ-14 — Unit tests for DrizzleRelationalQuery
// Tests alias resolution, M:N flattening, field expansion, and error handling.
// Uses mock db.query objects to avoid needing a real database.

import { describe, expect, it } from 'vitest'
import type { RelationAliasMap } from '../src/relational-query'
import { DrizzleRelationalQuery } from '../src/relational-query'

/**
 * Create a minimal mock Drizzle db object with db.query.* that returns canned results.
 * Captures every findMany call's opts on `calls[name]` for assertion purposes.
 *
 * IMPORTANT: This mock does NOT honor `where`, `columns`, `with`, or `orderBy`.
 * It only captures `opts.limit` / `opts.offset` for pagination assertions and
 * returns whatever rows were seeded. Use this mock ONLY for call-shape tests
 * (what findMany was called with) or tests that don't depend on filtering.
 *
 * Behaviour tests (soft-delete, relation filters, operator semantics, EXISTS
 * correctness) live in:
 *   - `packages/core/tests/conformance/relational-query.test.ts` (InMemory)
 *   - `packages/adapter-database-pg/tests/relational-query.conformance.test.ts` (real PG)
 *   - `packages/adapter-database-pg/tests/relational-query-pg.integration.test.ts` (real PG)
 */
function createMockDb(entities: Record<string, Record<string, unknown>[]>) {
  const query: Record<string, { findMany: (opts: Record<string, unknown>) => Promise<unknown[]> }> = {}
  const calls: Record<string, Record<string, unknown>[]> = {}
  for (const [name, rows] of Object.entries(entities)) {
    calls[name] = []
    query[name] = {
      findMany: async (opts: Record<string, unknown>) => {
        calls[name].push(opts)
        // Apply limit/offset for pagination tests
        let result = [...rows]
        if (typeof opts.offset === 'number') result = result.slice(opts.offset)
        if (typeof opts.limit === 'number') result = result.slice(0, opts.limit)
        return result
      },
    }
  }
  const db = { query } as unknown as Parameters<(typeof DrizzleRelationalQuery.prototype)['findWithRelations']>[0]
  return { db, calls }
}

describe('DrizzleRelationalQuery', () => {
  // RQ-01 — Basic findWithRelations returns rows
  it('RQ-01: findWithRelations returns rows for a known entity', async () => {
    const { db } = createMockDb({
      products: [
        { id: '1', title: 'Widget' },
        { id: '2', title: 'Gadget' },
      ],
    })
    const rq = new DrizzleRelationalQuery(db as any)

    const results = await rq.findWithRelations({ entity: 'products' })
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({ id: '1', title: 'Widget' })
  })

  // RQ-02 — Throws for unknown entity
  it('RQ-02: findWithRelations throws UNKNOWN_MODULES for missing entity', async () => {
    const { db } = createMockDb({ products: [] })
    const rq = new DrizzleRelationalQuery(db as any)

    await expect(rq.findWithRelations({ entity: 'nonexistent' })).rejects.toThrow('No query target')
  })

  // RQ-03 — Simple alias renaming
  it('RQ-03: simple string alias renames relation keys in results', async () => {
    const { db } = createMockDb({
      products: [{ id: '1', title: 'Widget', productVariants: [{ id: 'v1', sku: 'W-001' }] }],
    })
    const aliases: RelationAliasMap = new Map([['products', { variants: 'productVariants' }]])
    const rq = new DrizzleRelationalQuery(db as any, aliases)

    const results = await rq.findWithRelations({
      entity: 'products',
      fields: ['*', 'variants.*'],
    })

    expect(results[0].variants).toEqual([{ id: 'v1', sku: 'W-001' }])
    expect(results[0].productVariants).toBeUndefined()
  })

  // RQ-04 — M:N through-alias flattening
  it('RQ-04: RelationAlias flattens M:N pivot rows into target entities', async () => {
    const { db } = createMockDb({
      customergroups: [
        {
          id: 'g1',
          name: 'VIP',
          customerCustomerGroup: [
            { customer: { id: 'c1', name: 'Alice' }, type: 'primary' },
            { customer: { id: 'c2', name: 'Bob' }, type: 'secondary' },
          ],
        },
      ],
    })
    const aliases: RelationAliasMap = new Map([
      [
        'customergroups',
        {
          customers: { pivot: 'customerCustomerGroup', through: 'customer', extraColumns: ['type'] },
        },
      ],
    ])
    const rq = new DrizzleRelationalQuery(db as any, aliases)

    const results = await rq.findWithRelations({
      entity: 'customergroups',
      fields: ['*', 'customers.*'],
    })

    expect(results[0].customers).toEqual([
      { id: 'c1', name: 'Alice', type: 'primary' },
      { id: 'c2', name: 'Bob', type: 'secondary' },
    ])
    // Pivot key should not appear in output
    expect(results[0].customerCustomerGroup).toBeUndefined()
  })

  // RQ-05 — M:N flattening without extra columns
  it('RQ-05: RelationAlias without extraColumns returns target only', async () => {
    const { db } = createMockDb({
      customergroups: [
        {
          id: 'g1',
          name: 'VIP',
          customerCustomerGroup: [{ customer: { id: 'c1', name: 'Alice' }, created_at: '2026-01-01' }],
        },
      ],
    })
    const aliases: RelationAliasMap = new Map([
      [
        'customergroups',
        {
          customers: { pivot: 'customerCustomerGroup', through: 'customer' },
        },
      ],
    ])
    const rq = new DrizzleRelationalQuery(db as any, aliases)

    const results = await rq.findWithRelations({
      entity: 'customergroups',
      fields: ['*', 'customers.*'],
    })

    // Should NOT include created_at from pivot
    expect(results[0].customers).toEqual([{ id: 'c1', name: 'Alice' }])
  })

  // RQ-06 — Empty aliases = no transformation
  it('RQ-06: no aliases means results pass through unchanged', async () => {
    const { db } = createMockDb({
      products: [{ id: '1', title: 'Widget', someRel: [{ id: 'r1' }] }],
    })
    const rq = new DrizzleRelationalQuery(db as any)

    const results = await rq.findWithRelations({ entity: 'products' })
    expect(results[0].someRel).toEqual([{ id: 'r1' }])
  })

  // RQ-07 — M:N with null through target
  it('RQ-07: M:N pivot row with missing through target returns empty object', async () => {
    const { db } = createMockDb({
      customergroups: [
        {
          id: 'g1',
          customerCustomerGroup: [
            { type: 'orphan' }, // customer key missing
          ],
        },
      ],
    })
    const aliases: RelationAliasMap = new Map([
      [
        'customergroups',
        {
          customers: { pivot: 'customerCustomerGroup', through: 'customer', extraColumns: ['type'] },
        },
      ],
    ])
    const rq = new DrizzleRelationalQuery(db as any, aliases)

    const results = await rq.findWithRelations({
      entity: 'customergroups',
      fields: ['*', 'customers.*'],
    })

    // Should not crash, should return empty target merged with extras
    expect(results[0].customers).toEqual([{ type: 'orphan' }])
  })

  // RQ-08 — findAndCountWithRelations returns count
  it('RQ-08: findAndCountWithRelations returns [results, count]', async () => {
    const { db } = createMockDb({
      products: [
        { id: '1', title: 'Widget' },
        { id: '2', title: 'Gadget' },
        { id: '3', title: 'Thingamajig' },
      ],
    })
    const rq = new DrizzleRelationalQuery(db as any)

    const [results, count] = await rq.findAndCountWithRelations({
      entity: 'products',
      pagination: { limit: 2, offset: 0 },
    })

    expect(results).toHaveLength(2)
    expect(count).toBe(3) // Total count ignores pagination
  })

  // RQ-09 — Entity name resolution (case insensitive, underscores stripped)
  it('RQ-09: resolves entity names case-insensitively', async () => {
    const { db } = createMockDb({
      customerGroups: [{ id: 'g1', name: 'VIP' }],
    })
    const rq = new DrizzleRelationalQuery(db as any)

    // 'customer_group' should resolve to 'customerGroups'
    const results = await rq.findWithRelations({ entity: 'customer_group' })
    expect(results).toHaveLength(1)
  })

  // RQ-10 — Pagination is applied
  it('RQ-10: pagination limit and offset are respected', async () => {
    const { db } = createMockDb({
      products: Array.from({ length: 20 }, (_, i) => ({ id: String(i), title: `P${i}` })),
    })
    const rq = new DrizzleRelationalQuery(db as any)

    const results = await rq.findWithRelations({
      entity: 'products',
      pagination: { limit: 5, offset: 10 },
    })

    expect(results).toHaveLength(5)
    expect(results[0].id).toBe('10')
  })

  // RQ-11 — Count fast path uses PK-only projection when no relation filters
  it('RQ-11: findAndCountWithRelations with root-only filter uses PK-only projection for count', async () => {
    const { db, calls } = createMockDb({
      products: [
        { id: '1', title: 'Widget', status: 'active' },
        { id: '2', title: 'Gadget', status: 'active' },
        { id: '3', title: 'Thingamajig', status: 'active' },
      ],
    })
    const rq = new DrizzleRelationalQuery(db as any)

    const [results, count] = await rq.findAndCountWithRelations({
      entity: 'products',
      filters: { status: 'active' },
      pagination: { limit: 2 },
    })

    expect(count).toBe(3)
    expect(results).toHaveLength(2)

    // At least one of the findMany calls should have requested PK-only columns.
    // This is the count fast path — it must NOT hydrate full rows.
    const pkOnlyCall = calls.products.find((opts) => {
      const cols = opts.columns as Record<string, unknown> | undefined
      return cols && cols.id === true
    })
    expect(pkOnlyCall).toBeDefined()
  })

  // RQ-12 (REMOVED — fiction post-F29 rewrite).
  // The pre-F29 path used `_queryWithJoins` to hydrate full rows then JS-filter
  // on the relation data. The F29 rewrite compiles relation filters to
  // correlated EXISTS subqueries that execute in SQL. That is no longer
  // observable through a mock that does not honor `where` callbacks, so the
  // behaviour it guarded now lives in the conformance/integration tests.

  // RQ-13 — With relation filters present, `findMany` is called with a
  // function-valued `where` (the combined callback); both root-only and
  // relation-filtered calls go through the same single code path.
  it('RQ-13: where is always a Function when filters are present (single code path)', async () => {
    const { db, calls } = createMockDb({
      products: [{ id: '1', title: 'A' }],
    })
    // biome-ignore lint/suspicious/noExplicitAny: mock db is structurally compatible
    const rq = new DrizzleRelationalQuery(db as any)

    // Root filter only
    await rq.findWithRelations({
      entity: 'products',
      filters: { status: 'active' },
    })
    // Relation filter only (no schema meta present → EXISTS is a no-op, but
    // the root path still builds a where callback)
    await rq.findWithRelations({
      entity: 'products',
      fields: ['*', 'someRel.*'],
      filters: { 'someRel.field': 'x' },
    })

    expect(calls.products).toHaveLength(2)
    for (const opts of calls.products) {
      expect(typeof opts.where).toBe('function')
    }
  })

  // RQ-14 — The pre-F29 `_queryWithJoins` / `_cleanWithClause` code is gone.
  // Asserting the absence of those private methods guards against accidental
  // resurrection during future refactors.
  it('RQ-14: legacy _queryWithJoins and _cleanWithClause methods are removed', () => {
    // biome-ignore lint/suspicious/noExplicitAny: minimal mock db for construction
    const rq = new DrizzleRelationalQuery({ query: {} } as any)
    // biome-ignore lint/suspicious/noExplicitAny: probe private surface
    const anyRq = rq as any
    expect(anyRq._queryWithJoins).toBeUndefined()
    expect(anyRq._cleanWithClause).toBeUndefined()
  })
})
