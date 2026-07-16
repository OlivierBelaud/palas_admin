import { describe, expect, it } from 'vitest'
import {
  buildCategoryTree,
  type CatalogCategory,
  type CatalogProduct,
  categoryBreadcrumb,
  categoryProductCandidates,
  categoryRepresentativeProduct,
  descendantIds,
  moveItem,
} from './catalog-taxonomy'

const categories: CatalogCategory[] = [
  {
    id: 'root',
    slug: 'jewellery',
    title_fr: 'Bijoux',
    title_en: 'Jewellery',
    representative_product_id: null,
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
    representative_product_id: null,
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
    representative_product_id: null,
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

  it('uses the selected representative, then falls back to the first ordered product', () => {
    const products = [
      { shopify_product_id: 'second', title: 'Second', canonical_category_id: 'medals', category_position: 1 },
      { shopify_product_id: 'first', title: 'First', canonical_category_id: 'medals', category_position: 0 },
    ].map((product) => ({
      ...product,
      handle: product.shopify_product_id,
      product_type: null,
      image_url: null,
      visual_group: null,
      visual_subtype: null,
    })) satisfies CatalogProduct[]
    const category = categories[2]
    expect(
      categoryRepresentativeProduct({ ...category, representative_product_id: 'second' }, categories, products)
        ?.shopify_product_id,
    ).toBe('second')
    expect(
      categoryRepresentativeProduct({ ...category, representative_product_id: null }, categories, products)
        ?.shopify_product_id,
    ).toBe('first')
  })

  it('offers descendant products to parent categories', () => {
    const products = [
      { shopify_product_id: 'medal', title: 'Medal', canonical_category_id: 'medals', category_position: 0 },
    ].map((product) => ({
      ...product,
      handle: product.shopify_product_id,
      product_type: null,
      image_url: 'https://example.com/image.jpg',
      visual_group: null,
      visual_subtype: null,
    })) satisfies CatalogProduct[]
    expect(
      categoryProductCandidates(categories[0], categories, products).map((product) => product.shopify_product_id),
    ).toEqual(['medal'])
  })

  it('moves an item before or after the hovered target', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(moveItem(items, 'a', 'c', 'before', (item) => item.id).map((item) => item.id)).toEqual(['b', 'a', 'c'])
    expect(moveItem(items, 'a', 'c', 'after', (item) => item.id).map((item) => item.id)).toEqual(['b', 'c', 'a'])
  })
})
