import { describe, expect, it } from 'vitest'
import { buildCatalogShopifySpecs, catalogShopifyConstants } from './catalog-shopify-sync.mjs'

describe('catalog Shopify collection specs', () => {
  it('targets the FrontEnd publication, never the Online Store channel', () => {
    expect(catalogShopifyConstants.DEFAULT_STOREFRONT_PUBLICATION_ID).toBe('gid://shopify/Publication/253433971035')
  })

  it('isolates handles and rolls descendants into their parent collection', () => {
    const specs = buildCatalogShopifySpecs({
      categories: [
        {
          id: 'jewelry',
          slug: 'bijoux',
          title_fr: 'Bijoux',
          title_en: 'Jewellery',
          parent_id: null,
          position: 0,
          representative_product_id: null,
        },
        {
          id: 'necklaces',
          slug: 'colliers',
          title_fr: 'Colliers',
          title_en: 'Necklaces',
          parent_id: 'jewelry',
          position: 0,
          representative_product_id: null,
        },
      ],
      products: [
        {
          shopify_product_id: '1',
          title: 'Collier A',
          image_url: 'https://example.com/a.jpg',
          canonical_category_id: 'necklaces',
          category_position: 0,
        },
        {
          shopify_product_id: '2',
          title: 'Nouveau',
          image_url: null,
          canonical_category_id: null,
          category_position: 0,
        },
      ],
    })

    expect(specs.find((spec) => spec.syncKey === 'category:jewelry')).toMatchObject({
      handle: 'palas-cat-bijoux',
      title: '[PALAS CAT] Bijoux',
      labelFr: 'Bijoux',
      labelEn: 'Jewellery',
      parentHandle: null,
      position: 0,
      canonicalPath: ['palas-cat-bijoux'],
      translationStatus: 'complete',
      productIds: ['1'],
    })
    expect(specs.find((spec) => spec.syncKey === 'category:necklaces')).toMatchObject({
      title: '[PALAS CAT] Bijoux › Colliers',
      labelFr: 'Colliers',
      labelEn: 'Necklaces',
      parentHandle: 'palas-cat-bijoux',
      canonicalPath: ['palas-cat-bijoux', 'palas-cat-colliers'],
      productIds: ['1'],
    })
    expect(specs.find((spec) => spec.syncKey === catalogShopifyConstants.UNCLASSIFIED_KEY)).toMatchObject({
      handle: 'palas-cat-unclassified',
      productIds: ['2'],
    })
    expect(specs.every((spec) => spec.handle.startsWith('palas-cat-'))).toBe(true)
  })
})
