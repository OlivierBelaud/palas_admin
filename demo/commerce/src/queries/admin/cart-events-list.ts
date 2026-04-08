import { z } from 'zod'

export default defineQuery({
  name: 'cart-events-list',
  description: 'Get all events for a cart, most recent first',
  input: z.object({
    id: z.string(),
  }),
  handler: async (input, { query }) => {
    const allEvents = await query.graph({
      entity: 'cartEvent',
      fields: ['action', 'total_price', 'item_count', 'occurred_at', 'cart_id', 'currency'],
      pagination: { limit: 5000 },
    }) as any[]

    return allEvents
      .filter((e: any) => e.cart_id === input.id)
      .sort((a: any, b: any) =>
        new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime(),
      )
      .map((e: any) => {
        // Clean action name: remove _submitted/_info suffixes
        const cleanAction = (e.action as string)
          .replace(/_info_submitted$/, '')
          .replace(/_submitted$/, '')
          .replace(/_info$/, '')

        const symbols: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF', CAD: 'CA$', AUD: 'A$' }
        const symbol = symbols[e.currency ?? 'EUR'] ?? e.currency
        return {
          ...e,
          action: cleanAction,
          montant: e.total_price != null ? `${e.total_price} ${symbol}` : '-',
        }
      })
  },
})
