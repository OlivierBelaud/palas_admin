import { z } from 'zod'

export default defineQuery({
  name: 'cart-header',
  description: 'Cart header: client identity + cart summary for page title',
  input: z.object({
    id: z.string(),
  }),
  handler: async (input, { query }) => {
    const carts = await query.graph({
      entity: 'cart',
      fields: ['email', 'distinct_id', 'items', 'total_price', 'item_count', 'currency', 'status'],
      pagination: { limit: 5000 },
    }) as any[]

    const cart = carts.find((c: any) => c.id === input.id)
    if (!cart) return { title: 'Panier inconnu', description: '' }

    const symbol = (cart.currency ?? 'EUR') === 'EUR' ? '€' : cart.currency
    const title = cart.email ?? cart.distinct_id ?? 'Anonyme'

    const items = (cart.items ?? []) as any[]
    const itemsSummary = items.length > 0
      ? items.map((i: any) => `${i.title} × ${i.quantity}`).join(' · ')
      : 'Panier vide'

    const description = `${cart.item_count ?? 0} article${(cart.item_count ?? 0) > 1 ? 's' : ''} · ${cart.total_price ?? 0} ${symbol} · ${itemsSummary}`

    return { title, description }
  },
})
