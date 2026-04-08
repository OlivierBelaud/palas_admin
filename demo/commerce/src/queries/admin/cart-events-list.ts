import { z } from 'zod'

export default defineQuery({
  name: 'cart-events-list',
  description: 'Get all events for a cart, ordered by time',
  input: z.object({
    id: z.string(),
  }),
  handler: async (input, { query }) => {
    const allEvents = await query.graph({
      entity: 'cartEvent',
      fields: ['action', 'total_price', 'item_count', 'email', 'occurred_at', 'cart_id', 'distinct_id', 'order_id'],
      pagination: { limit: 5000 },
    }) as any[]

    return allEvents
      .filter((e: any) => e.cart_id === input.id)
      .sort((a: any, b: any) =>
        new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
      )
  },
})
