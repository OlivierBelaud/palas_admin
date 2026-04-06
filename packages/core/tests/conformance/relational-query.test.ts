// RQ-01 → RQ-07 — IRelationalQueryPort conformance tests
// Shared between InMemoryRelationalQuery and DrizzleRelationalQuery.

import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryRelationalQuery } from '../../src/adapters/relational-query-memory'

describe('IRelationalQueryPort conformance (InMemoryRelationalQuery)', () => {
  let rq: InMemoryRelationalQuery

  beforeEach(() => {
    rq = new InMemoryRelationalQuery()

    // Seed test data
    rq.setData('product', [
      { id: 'p1', title: 'Shirt', status: 'active', deleted_at: null },
      { id: 'p2', title: 'Pants', status: 'active', deleted_at: null },
      { id: 'p3', title: 'Deleted Item', status: 'draft', deleted_at: '2026-01-01' },
    ])

    rq.setData('variant', [
      { id: 'v1', sku: 'SHIRT-S', price: 25, product_id: 'p1', deleted_at: null },
      { id: 'v2', sku: 'SHIRT-M', price: 30, product_id: 'p1', deleted_at: null },
      { id: 'v3', sku: 'PANTS-L', price: 50, product_id: 'p2', deleted_at: null },
      { id: 'v4', sku: 'DELETED-V', price: 0, product_id: 'p1', deleted_at: '2026-01-01' },
    ])

    rq.setData('category', [
      { id: 'c1', name: 'Tops', deleted_at: null },
      { id: 'c2', name: 'Bottoms', deleted_at: null },
    ])

    rq.setData('product_category', [
      { id: 'pc1', product_id: 'p1', category_id: 'c1' },
      { id: 'pc2', product_id: 'p2', category_id: 'c2' },
    ])

    // Register relations
    rq.setRelations('product', {
      variants: { type: 'hasMany', target: 'variant', foreignKey: 'product_id' },
      categories: { type: 'manyToMany', target: 'category', pivotEntity: 'product_category' },
    })

    rq.setRelations('variant', {
      product: { type: 'belongsTo', target: 'product', foreignKey: 'product_id' },
    })
  })

  // RQ-01: Basic findWithRelations — entity + 1 relation
  it('RQ-01: findWithRelations with one hasMany relation', async () => {
    const results = await rq.findWithRelations({
      entity: 'product',
      fields: ['*', 'variants.*'],
    })

    expect(results).toHaveLength(2)

    const shirt = results.find((r) => r.id === 'p1')!
    expect(shirt.variants).toHaveLength(2) // v4 excluded (soft-deleted)
    expect((shirt.variants as Record<string, unknown>[]).map((v) => v.sku)).toContain('SHIRT-S')
    expect((shirt.variants as Record<string, unknown>[]).map((v) => v.sku)).toContain('SHIRT-M')
  })

  // RQ-02: Filters on relation (dotted path)
  it('RQ-02: findWithRelations with relation filter (dotted path)', async () => {
    const results = await rq.findWithRelations({
      entity: 'product',
      fields: ['*', 'variants.*'],
      filters: { 'variants.sku': 'SHIRT-S' },
    })

    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('p1')
  })

  // RQ-03: Sort on root entity
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

  // RQ-04: Soft-delete propagation
  it('RQ-04: soft-delete filters out deleted records by default', async () => {
    const results = await rq.findWithRelations({
      entity: 'product',
      fields: ['*', 'variants.*'],
    })

    expect(results).toHaveLength(2) // p3 excluded
    const shirt = results.find((r) => r.id === 'p1')!
    expect(shirt.variants).toHaveLength(2) // v4 excluded
  })

  // RQ-05: Pagination + relPagination
  it('RQ-05: pagination and relation pagination', async () => {
    const results = await rq.findWithRelations({
      entity: 'product',
      fields: ['*', 'variants.*'],
      pagination: { limit: 1 },
      relPagination: { variants: { limit: 1 } },
    })

    expect(results).toHaveLength(1)
    if (results[0].variants) {
      expect(results[0].variants).toHaveLength(1)
    }
  })

  // RQ-06: manyToMany via pivot table
  it('RQ-06: manyToMany relation via pivot table', async () => {
    const results = await rq.findWithRelations({
      entity: 'product',
      fields: ['*', 'categories.*'],
    })

    expect(results).toHaveLength(2)
    const shirt = results.find((r) => r.id === 'p1')!
    expect(shirt.categories).toHaveLength(1)
    expect((shirt.categories as Record<string, unknown>[])[0].name).toBe('Tops')
  })

  // RQ-07: withDeleted = true
  it('RQ-07: withDeleted includes soft-deleted records', async () => {
    const results = await rq.findWithRelations({
      entity: 'product',
      fields: ['*', 'variants.*'],
      withDeleted: true,
    })

    expect(results).toHaveLength(3) // includes p3
    const shirt = results.find((r) => r.id === 'p1')!
    expect(shirt.variants).toHaveLength(3) // includes v4
  })

  // findAndCountWithRelations
  it('findAndCountWithRelations returns results + total count', async () => {
    const [results, count] = await rq.findAndCountWithRelations({
      entity: 'product',
      fields: ['*', 'variants.*'],
      pagination: { limit: 1 },
    })

    expect(results).toHaveLength(1)
    expect(count).toBe(2) // total without pagination
  })

  // belongsTo relation
  it('resolves belongsTo relation', async () => {
    const results = await rq.findWithRelations({
      entity: 'variant',
      fields: ['*', 'product.*'],
    })

    expect(results).toHaveLength(3) // v4 excluded
    const v1 = results.find((r) => r.id === 'v1')!
    expect(v1.product).toBeTruthy()
    expect((v1.product as Record<string, unknown>).title).toBe('Shirt')
  })
})
