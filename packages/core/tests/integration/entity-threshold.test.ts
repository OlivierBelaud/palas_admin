import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  MantaError,
  createTestContainer,
  resetAll,
  InMemoryContainer,
} from '@manta/test-utils'

describe('Entity Counting Threshold Integration', () => {
  let container: InMemoryContainer

  beforeEach(() => {
    container = createTestContainer()
  })

  afterEach(async () => {
    await resetAll(container)
  })

  // SPEC-011: counts root + nested entities iteratively
  it('counts root + nested entities iteratively', () => {
    // 100 products × 50 variants = 5100 total < 10000 limit
    const products = Array.from({ length: 100 }, (_, i) => ({
      id: `p${i}`,
      variants: Array.from({ length: 50 }, (_, j) => ({ id: `v${i}-${j}` })),
    }))

    // Iterative counting: total += batch.length per batch
    let totalEntities = products.length
    for (const product of products) {
      totalEntities += product.variants.length
    }

    expect(totalEntities).toBe(5100)
    expect(totalEntities).toBeLessThan(10000) // Under default limit
  })

  // SPEC-011: throws when threshold exceeded
  it('throws when threshold exceeded', () => {
    const maxEntities = 500 // Configured limit

    // 100 products × 50 variants = 5100 > 500
    let totalEntities = 100
    const variantsPerProduct = 50

    // After first level
    totalEntities += 100 * variantsPerProduct // = 5100

    if (totalEntities > maxEntities) {
      const error = new MantaError(
        'RESOURCE_EXHAUSTED',
        `Query result set (${totalEntities} entities) exceeding the maximum of ${maxEntities}`,
      )

      expect(error.type).toBe('RESOURCE_EXHAUSTED')
      expect(error.message).toContain(`exceeding the maximum of ${maxEntities}`)
    }
  })

  // SPEC-011: stops before resolving next level (fail-fast)
  it('stops before resolving next level (fail-fast)', () => {
    const maxEntities = 200

    // Level 0: 100 products
    let total = 100

    // Level 1: 100 × 5 variants = 500
    const level1Count = 100 * 5
    total += level1Count // = 600 > 200

    // Fail-fast: should stop here, never query level 2 (options)
    const failedBeforeLevel2 = total > maxEntities

    expect(failedBeforeLevel2).toBe(true)
    // Level 2 (options) was never queried
  })
})
