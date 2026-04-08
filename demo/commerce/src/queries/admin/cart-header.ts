import { z } from 'zod'

export default defineQuery({
  name: 'cart-header',
  description: 'Cart header data + sidebar summary',
  input: z.object({
    id: z.string(),
  }),
  handler: async (input, { query }) => {
    const carts = await query.graph({
      entity: 'cart',
      fields: ['email', 'distinct_id', 'items', 'total_price', 'item_count', 'currency', 'discounts_amount'],
      pagination: { limit: 5000 },
    }) as any[]

    const cart = carts.find((c: any) => c.id === input.id)
    if (!cart) return { email: 'Panier inconnu', distinct_id: '', summary: '', articles: '-', total: '-', remises: '-' }

    const symbol = (cart.currency ?? 'EUR') === 'EUR' ? '€' : cart.currency
    const items = (cart.items ?? []) as any[]

    const itemsSummary = items.length > 0
      ? items.map((i: any) => `${i.title} × ${i.quantity}`).join(' · ')
      : 'Panier vide'

    const summary = `${cart.item_count ?? 0} article${(cart.item_count ?? 0) > 1 ? 's' : ''} · ${cart.total_price ?? 0} ${symbol} · ${itemsSummary}`

    const articles = items.length > 0
      ? items.map((i: any) => `${i.title} × ${i.quantity} — ${i.price} ${symbol}`).join('\n')
      : 'Panier vide'

    return {
      email: cart.email,
      distinct_id: cart.distinct_id,
      summary,
      articles,
      total: `${cart.total_price ?? 0} ${symbol}`,
      remises: cart.discounts_amount ? `−${cart.discounts_amount} ${symbol}` : '-',
    }
  },
})
