import { ShopifyAdminClient } from '../../modules/shopify-admin/client'

interface MoneyNode {
  amount: string
  currencyCode: string
}

interface ProductVariantNode {
  id: string
  title: string
  price: string
  contextualPricing: {
    price: MoneyNode
  } | null
}

interface ProductNode {
  id: string
  title: string
  handle: string
  productType: string | null
  status: string
  collections: {
    nodes: Array<{ id: string; handle: string }>
  }
  variants: {
    nodes: ProductVariantNode[]
  }
}

interface ProductConnection {
  nodes: ProductNode[]
  pageInfo: {
    hasNextPage: boolean
    endCursor: string | null
  }
}

export default defineQuery({
  name: 'marketing-product-search',
  description: 'Search active Shopify catalog products with contextual variant prices for the marketing simulator.',
  input: z.object({
    search: z.string().trim().default(''),
    country: z.string().trim().length(2).default('FR'),
    market_key: z.string().trim().default(''),
    after: z.string().nullable().optional(),
    limit: z.number().int().positive().max(50).default(20),
  }),
  handler: async (input) => {
    const client = new ShopifyAdminClient()
    const limit = input.limit ?? 20
    const search = input.search ?? ''
    const marketKey = input.market_key ?? ''
    const country = (input.country ?? 'FR').toUpperCase()
    const data = await client.query<{ products: ProductConnection }>(PRODUCT_SEARCH_QUERY, {
      limit,
      after: input.after ?? null,
      query: buildProductQuery(search),
      country,
    })

    return {
      items: data.products.nodes.flatMap((product) => normalizeProduct(product, marketKey, country)),
      page_info: data.products.pageInfo,
    }
  },
})

function normalizeProduct(product: ProductNode, marketKey: string, country: string) {
  const collections = product.collections.nodes.map((collection) => collection.handle || collection.id)
  return product.variants.nodes.map((variant) => {
    const price = Number(variant.contextualPricing?.price.amount ?? variant.price)
    const title = variant.title === 'Default Title' ? product.title : `${product.title} · ${variant.title}`
    return {
      id: variant.id,
      title,
      price: Number.isFinite(price) ? price : 0,
      currency_code: variant.contextualPricing?.price.currencyCode ?? 'EUR',
      category: inferProductCategory(product.title, product.productType, collections),
      collectionIds: collections,
      market_key: marketKey,
      context_country: country.toUpperCase(),
      source: 'shopify' as const,
      handle: product.handle,
      product_status: product.status,
    }
  })
}

function inferProductCategory(title: string, productType: string | null, collectionIds: string[]) {
  const haystack = [title, productType ?? '', ...collectionIds].join(' ').toLowerCase()
  if (haystack.includes('charm')) return 'charm'
  if (haystack.includes('tote') || haystack.includes('accessor')) return 'accessory'
  return 'jewelry'
}

function buildProductQuery(search: string): string {
  const terms = ['status:active', 'published_status:published']
  const clean = search.replace(/["'\\]/g, ' ').trim()
  if (clean) terms.push(clean)
  return terms.join(' ')
}

const PRODUCT_SEARCH_QUERY = `
  query PalasMarketingProductSearch($limit: Int!, $after: String, $query: String!, $country: CountryCode!) {
    products(first: $limit, after: $after, sortKey: TITLE, query: $query) {
      nodes {
        id
        title
        handle
        productType
        status
        collections(first: 10) {
          nodes { id handle }
        }
        variants(first: 20) {
          nodes {
            id
            title
            price
            contextualPricing(context: { country: $country }) {
              price { amount currencyCode }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`
