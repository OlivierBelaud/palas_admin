import { ShopifyAdminClient } from '../../modules/shopify-admin/client'

interface OptionNode {
  id: string
  title: string
  handle?: string
  status?: string
}

export default defineQuery({
  name: 'discount-form-options',
  description: 'Shopify products and collections available for Palas discount forms.',
  input: z.object({
    limit: z.number().int().positive().max(100).default(80),
  }),
  handler: async (input) => {
    const client = new ShopifyAdminClient()
    const data = await client.query<{
      products: { nodes: OptionNode[] }
      collections: { nodes: OptionNode[] }
    }>(
      `
        query PalasDiscountFormOptions($limit: Int!) {
          products(first: $limit, sortKey: TITLE) {
            nodes { id title handle status }
          }
          collections(first: $limit, sortKey: TITLE) {
            nodes { id title handle }
          }
        }
      `,
      { limit: input.limit },
    )

    return {
      products: data.products.nodes.map((node) => ({
        id: node.id,
        label: node.status ? `${node.title} · ${node.status}` : node.title,
        handle: node.handle ?? null,
      })),
      collections: data.collections.nodes.map((node) => ({
        id: node.id,
        label: node.title,
        handle: node.handle ?? null,
      })),
    }
  },
})
