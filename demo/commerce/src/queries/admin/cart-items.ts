import { currencySymbol } from '../../utils/currency'

export default defineQuery({
  name: 'cart-items',
  description: 'Get cart summary for sidebar display',
  input: z.object({
    id: z.string(),
  }),
  handler: async (input, { query }) => {
    type CartItem = { title?: string; quantity?: number; price?: number }
    const carts = await query.graph({
      entity: 'cart',
      filters: { id: input.id },
      fields: ['items', 'total_price', 'item_count', 'currency', 'discounts_amount', 'cart_token'],
      pagination: { limit: 1 },
    })

    const cart = carts[0]
    if (!cart) return { cart_token: '-', articles: '-', total: '-', remises: '-' }

    const symbol = currencySymbol(cart.currency ?? 'EUR')
    const items = (cart.items ?? []) as CartItem[]

    const articles =
      items.length > 0
        ? items.map((i) => `${i.title} × ${i.quantity} — ${i.price} ${symbol}`).join('\n')
        : 'Panier vide'

    return {
      cart_token: cart.cart_token ?? '-',
      articles,
      total: `${cart.total_price ?? 0} ${symbol}`,
      nombre_articles: cart.item_count ?? 0,
      remises: cart.discounts_amount ? `−${cart.discounts_amount} ${symbol}` : '-',
    }
  },
})
