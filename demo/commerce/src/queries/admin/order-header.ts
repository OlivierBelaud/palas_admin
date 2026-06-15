import { readRows } from '../../utils/drizzle-read'
// Order detail header — shows the order number as title and a deep link to
// the order on the Shopify admin. Mirrors cart-header / contact-header so
// the same HeaderDef contract works on the page.

export default defineQuery({
  name: 'order-header',
  description: 'Order header: order number title + Shopify admin deep link',
  input: z.object({
    id: z.string(),
  }),
  handler: async (input, { db, schema }) => {
    const orders = await readRows(
      { db, schema },
      {
        entity: 'order',
        filters: { id: input.id },
        fields: ['order_number', 'shopify_order_id', 'email'],
        pagination: { limit: 1 },
      },
    )

    const order = orders[0] as unknown as Record<string, unknown> | undefined
    if (!order) return { title: 'Commande inconnue', email: '', shopify_url: '', shopify_label: '' }

    const orderNumber = (order.order_number as string | null) ?? null
    const shopifyId = (order.shopify_order_id as string | null) ?? null
    const title = orderNumber || (shopifyId ? `#${shopifyId}` : 'Commande')

    const shopifyUrl = shopifyId
      ? `https://admin.shopify.com/store/fancy-palas/orders/${encodeURIComponent(shopifyId)}`
      : ''

    return {
      title,
      email: (order.email as string | null) ?? '',
      shopify_url: shopifyUrl,
      shopify_label: shopifyUrl ? 'Voir sur Shopify ↗' : '',
    }
  },
})
