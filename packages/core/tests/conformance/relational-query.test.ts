// IRelationalQueryPort conformance — thin wrapper over the shared suite.
//
// The actual test bodies live in
// `packages/core/src/testing/relational-query-suite.ts`. This file wires the
// suite to the InMemory adapter so that the same assertions are exercised
// against every implementation of the port (InMemory here, DrizzlePg in
// `packages/adapter-database-pg/tests/relational-query.conformance.test.ts`).

import { InMemoryRelationalQuery } from '../../src/adapters/relational-query-memory'
import { runRelationalQueryConformance, type SeedData } from '../../src/testing/relational-query-suite'

runRelationalQueryConformance({
  name: 'InMemoryRelationalQuery',
  create: async () => {
    const rq = new InMemoryRelationalQuery()
    return {
      rq,
      seed: async (data: SeedData) => {
        rq.setData('product', data.products.rows)
        rq.setData('variant', data.variants.rows)
        rq.setData('category', data.categories.rows)
        rq.setData('product_category', data.product_categories.rows)

        rq.setRelations('product', {
          variants: { type: 'hasMany', target: 'variant', foreignKey: 'product_id' },
          categories: { type: 'manyToMany', target: 'category', pivotEntity: 'product_category' },
        })
        rq.setRelations('variant', {
          product: { type: 'belongsTo', target: 'product', foreignKey: 'product_id' },
        })
      },
      teardown: async () => {
        rq._reset()
      },
    }
  },
})
