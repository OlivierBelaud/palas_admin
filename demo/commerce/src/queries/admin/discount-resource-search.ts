import { ShopifyAdminClient } from '../../modules/shopify-admin/client'

type DiscountResourceKind = 'collections' | 'products'

interface ProductNode {
  id: string
  title: string
  handle?: string | null
  status?: string | null
}

interface CollectionNode {
  id: string
  title: string
  handle?: string | null
  productsCount?: { count: number; precision?: string | null } | null
}

interface Connection<T> {
  nodes: T[]
  pageInfo: {
    hasNextPage: boolean
    endCursor: string | null
  }
}

export default defineQuery({
  name: 'discount-resource-search',
  description: 'Search paginated Shopify products or collections for Palas discount selectors.',
  input: z.object({
    resource: z.enum(['collections', 'products']),
    search: z.string().trim().default(''),
    after: z.string().nullable().optional(),
    limit: z.number().int().positive().max(50).default(25),
  }),
  handler: async (input) => {
    const client = new ShopifyAdminClient()
    const searchInput: SearchInput = {
      resource: input.resource,
      search: input.search ?? '',
      after: input.after ?? null,
      limit: input.limit ?? 25,
    }
    if (searchInput.resource === 'collections') return searchCollections(client, searchInput)
    return searchProducts(client, searchInput)
  },
})

async function searchCollections(client: ShopifyAdminClient, input: SearchInput) {
  const data = await client.query<{ collections: Connection<CollectionNode> }>(
    `
      query PalasDiscountCollectionSearch($limit: Int!, $after: String, $query: String) {
        collections(first: $limit, after: $after, sortKey: TITLE, query: $query) {
          nodes {
            id
            title
            handle
            productsCount { count precision }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `,
    { limit: input.limit, after: input.after ?? null, query: buildSearchQuery(input.search) },
  )

  return {
    items: data.collections.nodes.map((node) => ({
      id: node.id,
      label: node.title,
      handle: node.handle ?? null,
      meta: `${formatNumber(node.productsCount?.count ?? 0)} produits`,
    })),
    page_info: data.collections.pageInfo,
  }
}

async function searchProducts(client: ShopifyAdminClient, input: SearchInput) {
  const data = await client.query<{ products: Connection<ProductNode> }>(
    `
      query PalasDiscountProductSearch($limit: Int!, $after: String, $query: String) {
        products(first: $limit, after: $after, sortKey: TITLE, query: $query) {
          nodes {
            id
            title
            handle
            status
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `,
    { limit: input.limit, after: input.after ?? null, query: buildSearchQuery(input.search) },
  )

  return {
    items: data.products.nodes.map((node) => ({
      id: node.id,
      label: node.title,
      handle: node.handle ?? null,
      meta: node.status ?? null,
    })),
    page_info: data.products.pageInfo,
  }
}

interface SearchInput {
  resource: DiscountResourceKind
  search: string
  after?: string | null
  limit: number
}

function buildSearchQuery(search: string, extra?: string): string | null {
  const terms = [search.trim(), extra].filter(Boolean)
  return terms.length > 0 ? terms.join(' ') : null
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('fr-FR').format(value)
}
