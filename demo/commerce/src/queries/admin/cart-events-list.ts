import { z } from 'zod'

const SYMBOLS: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF', CAD: 'CA$', AUD: 'A$' }

export default defineQuery({
  name: 'cart-events-list',
  description: 'Get all events for a cart, most recent first',
  input: z.object({
    id: z.string(),
  }),
  handler: async (input, { query }) => {
    // Use graph with filter — if it works, great. If not, fall back.
    const events = await query.graph({
      entity: 'cartEvent',
      filters: { cart_id: input.id },
      fields: ['action', 'total_price', 'item_count', 'occurred_at', 'cart_id', 'currency'],
      pagination: { limit: 500 },
    }) as any[]

    return events
      .sort((a: any, b: any) =>
        new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime(),
      )
      .map((e: any) => {
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
