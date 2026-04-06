// Unit tests for query builder utilities
import { describe, expect, it } from 'vitest'
import { applyRelationPagination, buildDrizzleWith, hasRelationFields, separateFilters } from '../src/query-builder'

describe('buildDrizzleWith', () => {
  it('returns empty object for root-only fields', () => {
    expect(buildDrizzleWith(['*'])).toEqual({})
    expect(buildDrizzleWith(['id', 'title'])).toEqual({})
  })

  it('loads all fields of a relation with .*', () => {
    expect(buildDrizzleWith(['*', 'variants.*'])).toEqual({
      variants: true,
    })
  })

  it('loads multiple relations', () => {
    expect(buildDrizzleWith(['*', 'variants.*', 'category.*'])).toEqual({
      variants: true,
      category: true,
    })
  })

  it('loads nested relations', () => {
    expect(buildDrizzleWith(['*', 'variants.options.*'])).toEqual({
      variants: { with: { options: true } },
    })
  })

  it('loads specific fields on a relation', () => {
    expect(buildDrizzleWith(['id', 'variants.sku'])).toEqual({
      variants: { columns: { sku: true } },
    })
  })

  it('loads multiple specific fields on a relation', () => {
    expect(buildDrizzleWith(['id', 'variants.sku', 'variants.price'])).toEqual({
      variants: { columns: { sku: true, price: true } },
    })
  })

  it('does not downgrade from true to column-specific', () => {
    // If we already load all fields, specific field requests are ignored
    expect(buildDrizzleWith(['*', 'variants.*', 'variants.sku'])).toEqual({
      variants: true,
    })
  })

  it('handles nested specific fields', () => {
    expect(buildDrizzleWith(['*', 'variants.options.name'])).toEqual({
      variants: { with: { options: { columns: { name: true } } } },
    })
  })
})

describe('separateFilters', () => {
  it('separates root and relation filters', () => {
    const result = separateFilters({
      status: 'active',
      'customer.name': 'Acme',
    })

    expect(result.rootFilters).toEqual({ status: 'active' })
    expect(result.relationFilters).toEqual({ customer: { name: 'Acme' } })
    expect(result.hasRelationFilters).toBe(true)
  })

  it('returns hasRelationFilters=false when no dotted paths', () => {
    const result = separateFilters({ status: 'active', title: 'Test' })

    expect(result.rootFilters).toEqual({ status: 'active', title: 'Test' })
    expect(result.relationFilters).toEqual({})
    expect(result.hasRelationFilters).toBe(false)
  })

  it('handles deeply nested dotted paths', () => {
    const result = separateFilters({
      'customer.company.name': 'Acme',
    })

    expect(result.relationFilters).toEqual({
      customer: { 'company.name': 'Acme' },
    })
  })

  it('groups multiple filters on same relation', () => {
    const result = separateFilters({
      'customer.name': 'John',
      'customer.email': 'john@test.com',
    })

    expect(result.relationFilters).toEqual({
      customer: { name: 'John', email: 'john@test.com' },
    })
  })
})

describe('applyRelationPagination', () => {
  it('adds pagination to existing relation', () => {
    const result = applyRelationPagination({ variants: true }, { variants: { limit: 10, offset: 5 } })

    expect(result.variants).toEqual({ limit: 10, offset: 5 })
  })

  it('preserves existing config and adds pagination', () => {
    const result = applyRelationPagination({ variants: { columns: { sku: true } } }, { variants: { limit: 10 } })

    expect(result.variants).toEqual({ columns: { sku: true }, limit: 10, offset: undefined })
  })

  it('adds pagination for relation not in with clause', () => {
    const result = applyRelationPagination({}, { variants: { limit: 5 } })

    expect(result.variants).toEqual({ limit: 5, offset: undefined })
  })
})

describe('hasRelationFields', () => {
  it('returns false for undefined fields', () => {
    expect(hasRelationFields(undefined)).toBe(false)
  })

  it('returns false for empty fields', () => {
    expect(hasRelationFields([])).toBe(false)
  })

  it('returns false for root-only fields', () => {
    expect(hasRelationFields(['*', 'id', 'title'])).toBe(false)
  })

  it('returns true for dotted fields', () => {
    expect(hasRelationFields(['*', 'variants.sku'])).toBe(true)
  })
})
