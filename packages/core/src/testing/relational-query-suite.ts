// F35 — Shared conformance suite for IRelationalQueryPort.
//
// Consumed by:
//   - `packages/core/tests/conformance/relational-query.test.ts` (InMemory factory)
//   - `packages/adapter-database-pg/tests/relational-query.conformance.test.ts` (PG factory)
//
// The suite seeds a canonical dataset (products, variants, categories, and a
// product_category pivot) then exercises the port contract with a mix of
// root filters, dotted relation filters, operators, pagination, sort, and
// M:N pivot traversal.
//
// IMPORTANT: the suite imports `describe`/`it`/etc from vitest. It is only
// intended to be loaded from test files — do not re-export it from
// `@manta/core` main entry.

import { beforeEach, describe, expect, it } from 'vitest'
import type { IRelationalQueryPort } from '../ports/relational-query'

// ── Canonical seed data ─────────────────────────────────────────────

export interface SeedEntity {
  rows: Record<string, unknown>[]
}

export interface SeedData {
  products: SeedEntity
  variants: SeedEntity
  categories: SeedEntity
  product_categories: SeedEntity
}

export function buildDefaultSeed(): SeedData {
  return {
    products: {
      rows: [
        { id: 'p1', title: 'Shirt', status: 'active', price: 25, deleted_at: null },
        { id: 'p2', title: 'Pants', status: 'active', price: 50, deleted_at: null },
        { id: 'p3', title: 'Deleted Item', status: 'draft', price: 0, deleted_at: '2026-01-01' },
      ],
    },
    variants: {
      rows: [
        { id: 'v1', sku: 'SHIRT-S', price: 25, product_id: 'p1', deleted_at: null },
        { id: 'v2', sku: 'SHIRT-M', price: 30, product_id: 'p1', deleted_at: null },
        { id: 'v3', sku: 'PANTS-L', price: 50, product_id: 'p2', deleted_at: null },
        { id: 'v4', sku: 'DELETED-V', price: 0, product_id: 'p1', deleted_at: '2026-01-01' },
      ],
    },
    categories: {
      rows: [
        { id: 'c1', name: 'Tops', deleted_at: null },
        { id: 'c2', name: 'Bottoms', deleted_at: null },
      ],
    },
    product_categories: {
      rows: [
        { id: 'pc1', product_id: 'p1', category_id: 'c1' },
        { id: 'pc2', product_id: 'p2', category_id: 'c2' },
      ],
    },
  }
}

// ── Factory contract ────────────────────────────────────────────────

export interface RelationalQueryTestFactoryInstance {
  rq: IRelationalQueryPort
  seed: (data: SeedData) => Promise<void>
  teardown: () => Promise<void>
}

export interface RelationalQueryTestFactory {
  name: string
  create: () => Promise<RelationalQueryTestFactoryInstance>
}

// ── Suite runner ────────────────────────────────────────────────────

export function runRelationalQueryConformance(factory: RelationalQueryTestFactory): void {
  describe(`IRelationalQueryPort conformance (${factory.name})`, () => {
    let rq: IRelationalQueryPort
    let teardown: () => Promise<void>

    beforeEach(async () => {
      const instance = await factory.create()
      rq = instance.rq
      teardown = instance.teardown
      await instance.seed(buildDefaultSeed())
      return async () => {
        await teardown()
      }
    })

    // RQ-01 — Basic findWithRelations
    it('RQ-01: findWithRelations with one hasMany relation', async () => {
      const results = await rq.findWithRelations({
        entity: 'product',
        fields: ['*', 'variants.*'],
      })

      expect(results).toHaveLength(2)
      const shirt = results.find((r) => r.id === 'p1')
      expect(shirt).toBeDefined()
      expect(shirt?.variants).toHaveLength(2) // v4 excluded (soft-deleted)
    })

    // RQ-02 — Relation filter (dotted path, equality)
    it('RQ-02: findWithRelations with relation filter (dotted path, equality)', async () => {
      const results = await rq.findWithRelations({
        entity: 'product',
        fields: ['*', 'variants.*'],
        filters: { 'variants.sku': 'SHIRT-S' },
      })

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('p1')
    })

    // RQ-03 — Sort on root entity
    it('RQ-03: findWithRelations with sort', async () => {
      const results = await rq.findWithRelations({
        entity: 'product',
        fields: ['*'],
        sort: { title: 'desc' },
      })

      expect(results).toHaveLength(2)
      expect(results[0].title).toBe('Shirt')
      expect(results[1].title).toBe('Pants')
    })

    // RQ-04 — Soft-delete propagation
    it('RQ-04: soft-delete filters out deleted records by default', async () => {
      const results = await rq.findWithRelations({
        entity: 'product',
        fields: ['*', 'variants.*'],
      })

      expect(results).toHaveLength(2) // p3 excluded
      const shirt = results.find((r) => r.id === 'p1')
      expect(shirt?.variants).toHaveLength(2) // v4 excluded
    })

    // RQ-05 — Pagination + relPagination
    it('RQ-05: pagination and relation pagination', async () => {
      const results = await rq.findWithRelations({
        entity: 'product',
        fields: ['*', 'variants.*'],
        sort: { title: 'asc' }, // deterministic
        pagination: { limit: 1 },
        relPagination: { variants: { limit: 1 } },
      })

      expect(results).toHaveLength(1)
      if (results[0].variants) {
        expect(results[0].variants).toHaveLength(1)
      }
    })

    // RQ-06 — manyToMany via pivot
    it('RQ-06: manyToMany relation via pivot table', async () => {
      const results = await rq.findWithRelations({
        entity: 'product',
        fields: ['*', 'categories.*'],
      })

      expect(results).toHaveLength(2)
      const shirt = results.find((r) => r.id === 'p1')
      expect(shirt?.categories).toHaveLength(1)
    })

    // RQ-07 — withDeleted = true
    it('RQ-07: withDeleted includes soft-deleted records', async () => {
      const results = await rq.findWithRelations({
        entity: 'product',
        fields: ['*', 'variants.*'],
        withDeleted: true,
      })

      expect(results).toHaveLength(3) // includes p3
      const shirt = results.find((r) => r.id === 'p1')
      expect(shirt?.variants).toHaveLength(3) // includes v4
    })

    // findAndCountWithRelations — basic
    it('findAndCountWithRelations returns results + total count', async () => {
      const [results, count] = await rq.findAndCountWithRelations({
        entity: 'product',
        fields: ['*', 'variants.*'],
        pagination: { limit: 1 },
      })

      expect(results).toHaveLength(1)
      expect(count).toBe(2) // total without pagination
    })

    // RQ-BC11 — count must respect relation filters
    it('RQ-BC11: findAndCountWithRelations count respects relation filters', async () => {
      const [results, count] = await rq.findAndCountWithRelations({
        entity: 'product',
        fields: ['*', 'variants.*'],
        filters: { 'variants.sku': 'SHIRT-S' },
        pagination: { limit: 10 },
      })

      expect(count).toBe(1)
      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('p1')
    })

    // belongsTo — inverse direction
    it('resolves belongsTo relation', async () => {
      const results = await rq.findWithRelations({
        entity: 'variant',
        fields: ['*', 'product.*'],
      })

      expect(results).toHaveLength(3) // v4 excluded
      const v1 = results.find((r) => r.id === 'v1')
      expect(v1?.product).toBeTruthy()
      expect((v1?.product as Record<string, unknown> | undefined)?.title).toBe('Shirt')
    })

    // ── F35 additions (RQ-19..RQ-22) ─────────────────────────────────

    // RQ-19 — Root filter with $in operator
    it('RQ-19: root filter with $in operator', async () => {
      const results = await rq.findWithRelations({
        entity: 'product',
        fields: ['*'],
        filters: { id: { $in: ['p1', 'p2', 'pX'] } },
        sort: { title: 'asc' },
      })

      expect(results).toHaveLength(2)
      expect(results.map((r) => r.id).sort()).toEqual(['p1', 'p2'])
    })

    // RQ-20 — Relation dotted-path filter with $in operator
    it('RQ-20: relation dotted-path filter with $in operator', async () => {
      const results = await rq.findWithRelations({
        entity: 'product',
        fields: ['*', 'variants.*'],
        filters: { 'variants.sku': { $in: ['SHIRT-S', 'PANTS-L'] } },
        sort: { title: 'asc' },
      })

      expect(results).toHaveLength(2)
      expect(results.map((r) => r.id).sort()).toEqual(['p1', 'p2'])
    })

    // RQ-21 — findAndCountWithRelations pagination window with relation filter
    it('RQ-21: findAndCountWithRelations pagination window with relation filter', async () => {
      const [results, count] = await rq.findAndCountWithRelations({
        entity: 'product',
        fields: ['*', 'variants.*'],
        filters: { 'variants.price': { $gte: 25 } },
        sort: { title: 'asc' },
        pagination: { limit: 1, offset: 0 },
      })

      // Both p1 (via v1/v2) and p2 (via v3) match $gte 25 on variants.
      expect(count).toBe(2)
      expect(results).toHaveLength(1)
      // First page alphabetically is 'Pants' (p2)
      expect(results[0].id).toBe('p2')

      const [page2, count2] = await rq.findAndCountWithRelations({
        entity: 'product',
        fields: ['*', 'variants.*'],
        filters: { 'variants.price': { $gte: 25 } },
        sort: { title: 'asc' },
        pagination: { limit: 1, offset: 1 },
      })
      expect(count2).toBe(2)
      expect(page2).toHaveLength(1)
      expect(page2[0].id).toBe('p1')
    })

    // RQ-22 — sort + relation filter + pagination together
    it('RQ-22: sort + relation filter + pagination combined', async () => {
      const results = await rq.findWithRelations({
        entity: 'product',
        fields: ['*', 'variants.*'],
        filters: { 'variants.price': { $gt: 20 } },
        sort: { price: 'desc' },
        pagination: { limit: 2, offset: 0 },
      })

      // p2 (price 50) first, then p1 (price 25)
      expect(results.map((r) => r.id)).toEqual(['p2', 'p1'])
    })
  })
}
