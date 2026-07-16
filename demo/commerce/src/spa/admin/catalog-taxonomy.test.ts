import { describe, expect, it } from 'vitest'
import { buildCategoryTree, type CatalogCategory, categoryBreadcrumb, descendantIds } from './catalog-taxonomy'

const categories: CatalogCategory[] = [
  {
    id: 'root',
    slug: 'jewellery',
    title_fr: 'Bijoux',
    title_en: 'Jewellery',
    parent_id: null,
    position: 0,
    status: 'active',
    direct_product_count: 0,
    descendant_product_count: 2,
  },
  {
    id: 'necklaces',
    slug: 'necklaces',
    title_fr: 'Colliers',
    title_en: 'Necklaces',
    parent_id: 'root',
    position: 1,
    status: 'active',
    direct_product_count: 1,
    descendant_product_count: 2,
  },
  {
    id: 'medals',
    slug: 'necklaces-medallion-chain',
    title_fr: 'Médaillons sur chaîne',
    title_en: 'Medallions on chains',
    parent_id: 'necklaces',
    position: 0,
    status: 'active',
    direct_product_count: 1,
    descendant_product_count: 1,
  },
]

describe('catalog taxonomy helpers', () => {
  it('builds a sorted hierarchy', () => {
    const tree = buildCategoryTree(categories)
    expect(tree).toHaveLength(1)
    expect(tree[0]?.children[0]?.children[0]?.id).toBe('medals')
  })

  it('derives the canonical breadcrumb from the hierarchy', () => {
    expect(categoryBreadcrumb('medals', categories)).toBe('Bijoux › Colliers › Médaillons sur chaîne')
    expect(categoryBreadcrumb(null, categories)).toBe('Non classé')
  })

  it('returns a category and all its descendants', () => {
    expect([...descendantIds('necklaces', categories)]).toEqual(['necklaces', 'medals'])
  })
})
