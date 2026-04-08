import { z } from 'zod'

export default defineQuery({
  name: 'cart-detail',
  description: 'Get a cart with its full event timeline',
  input: z.object({
    id: z.string(),
  }),
  handler: async (input, { query }) => {
    const carts = await query.graph({
      entity: 'cart',
      pagination: { limit: 5000 },
    }) as any[]
    const cart = carts.find((c: any) => c.id === input.id)
    if (!cart) return { events: [] }

    // Fetch all events and filter by cart_id in JS
    const allEvents = await query.graph({
      entity: 'cartEvent',
      pagination: { limit: 5000 },
    }) as any[]

    const events = allEvents
      .filter((e: any) => e.cart_id === input.id)
      .sort((a: any, b: any) =>
        new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
      )

    return { ...cart, events }
  },
})
