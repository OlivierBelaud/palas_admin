export type ShopifyImage = {
  url: string
  altText: string | null
  width: number | null
  height: number | null
}

export type ShopifyCollectionChoice = {
  id: string
  handle: string
  title: string
  image: ShopifyImage | null
  products: {
    nodes: Array<{
      id: string
      handle: string
      title: string
      featuredImage: ShopifyImage | null
    }>
  }
}

export type HomepageTile = {
  id: string
  shopify_collection_id: string
  label_fr: string | null
  label_en: string | null
  image_source: 'collection' | 'product'
  shopify_product_id: string | null
  image_url: string | null
  position: number
}

export type CatalogMenuItem = {
  id: string
  parent_id: string | null
  shopify_collection_id: string | null
  label_fr: string
  label_en: string | null
  url: string | null
  position: number
}

export type CatalogContentData = {
  collections: ShopifyCollectionChoice[]
  homepage: HomepageTile[]
  menu: CatalogMenuItem[]
}
