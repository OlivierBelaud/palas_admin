import { z } from 'zod'

export default defineQuery({
  name: 'cart-list',
  description: 'List carts with computed client display and formatted amounts',
  input: z.object({}).optional(),
  handler: async (_input, { query }) => {
    const carts = await query.graph({
      entity: 'cart',
      fields: [
        'email', 'first_name', 'last_name', 'distinct_id',
        'total_price', 'item_count', 'currency',
        'last_action', 'highest_stage', 'status', 'last_action_at',
      ],
      pagination: { limit: 200 },
    }) as any[]

    // Most recently active first
    carts.sort((a: any, b: any) =>
      new Date(b.last_action_at).getTime() - new Date(a.last_action_at).getTime(),
    )

    return carts.map((c: any) => {
      const currency = c.currency ?? 'EUR'
      const client = c.email
        ?? (c.distinct_id ? `${c.distinct_id.slice(0, 8)}…` : 'Anonyme')

      const symbols: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF', CAD: 'CA$', AUD: 'A$' }
      const symbol = symbols[currency] ?? currency
      return {
        ...c,
        client,
        montant: c.total_price != null ? `${c.total_price} ${symbol}` : '-',
      }
    })
  },
})
