import { formatMoney } from '../../utils/currency'

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
    })

    return events.map((e) => {
      const cleanAction = e.action
        .replace(/_info_submitted$/, '')
        .replace(/_submitted$/, '')
        .replace(/_info$/, '')
      return {
        ...e,
        action: cleanAction,
        montant: formatMoney(e.total_price, e.currency ?? 'EUR'),
      }
    })
  },
})
