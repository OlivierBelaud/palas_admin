import { z } from 'zod'

export default defineQuery({
  name: 'cart-items',
  description: 'Get the items in a cart as table rows',
  input: z.object({
    id: z.string(),
  }),
  handler: async (input, { query }) => {
    const carts = await query.graph({
      entity: 'cart',
      fields: ['items', 'discounts_amount', 'currency'],
      pagination: { limit: 5000 },
    }) as any[]

    const cart = carts.find((c: any) => c.id === input.id)
    if (!cart) return []

    const items = (cart.items ?? []) as any[]
    return items.map((item: any) => ({
      title: item.title ?? '-',
      quantity: item.quantity ?? 0,
      price: item.price ?? 0,
      original_price: item.original_price ?? item.price ?? 0,
      line_price: item.line_price ?? (item.quantity * item.price) ?? 0,
      total_discount: item.total_discount ?? 0,
      sku: item.sku ?? '-',
      product_id: item.product_id ?? '-',
    }))
  },
})
