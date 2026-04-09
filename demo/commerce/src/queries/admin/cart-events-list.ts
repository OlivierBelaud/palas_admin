import { z } from 'zod'

const SYMBOLS: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF', CAD: 'CA$', AUD: 'A$' }

export default defineQuery({
  name: 'cart-events-list',
  description: 'Get all events for a cart, most recent first',
  input: z.object({
    id: z.string(),
  }),
  handler: async (input, { query }) => {
    const events = await query.graph({
      entity: 'cartEvent',
      filters: { cart_id: input.id },
      fields: ['action', 'total_price', 'item_count', 'occurred_at', 'cart_id', 'currency'],
      sort: { occurred_at: 'desc' },
      pagination: { limit: 200 },
    }) as any[]

    return events.map((e: any) => {
      const cleanAction = (e.action as string)
        .replace(/_info_submitted$/, '')
        .replace(/_submitted$/, '')
        .replace(/_info$/, '')
      const symbol = SYMBOLS[e.currency ?? 'EUR'] ?? e.currency
      return {
        ...e,
        action: cleanAction,
        montant: e.total_price != null ? `${e.total_price} ${symbol}` : '-',
      }
    })
  },
})
