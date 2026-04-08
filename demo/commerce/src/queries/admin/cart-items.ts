import { z } from 'zod'

export default defineQuery({
  name: 'cart-items',
  description: 'Get cart summary with formatted items for sidebar display',
  input: z.object({
    id: z.string(),
  }),
  handler: async (input, { query }) => {
    const carts = await query.graph({
      entity: 'cart',
      fields: ['items', 'total_price', 'item_count', 'currency', 'discounts_amount'],
      pagination: { limit: 5000 },
    }) as any[]

    const cart = carts.find((c: any) => c.id === input.id)
    if (!cart) return { articles: '-', total: '-', remises: '-' }

    const items = (cart.items ?? []) as any[]
    const currency = cart.currency ?? 'EUR'

    // Format each item as "Product × qty — price €"
    const articles = items.length > 0
      ? items.map((item: any) => `${item.title} × ${item.quantity} — ${item.price} ${currency}`).join('\n')
      : 'Panier vide'

    return {
      articles,
      total: `${cart.total_price ?? 0} ${currency}`,
      nombre_articles: cart.item_count ?? 0,
      remises: cart.discounts_amount ? `−${cart.discounts_amount} ${currency}` : '-',
    }
  },
})
