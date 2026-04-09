import { z } from 'zod'

const SYMBOLS: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF', CAD: 'CA$', AUD: 'A$' }

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
      pagination: { limit: 100 },
      orderBy: [{ field: 'updated_at', direction: 'DESC' }],
    }) as any[]

    return carts.map((c: any) => {
      const currency = c.currency ?? 'EUR'
      const client = c.email
        ?? (c.distinct_id ? `${c.distinct_id.slice(0, 8)}…` : 'Anonyme')
      const symbol = SYMBOLS[currency] ?? currency
      return {
        ...c,
        client,
        montant: c.total_price != null ? `${c.total_price} ${symbol}` : '-',
      }
    })
  },
})
