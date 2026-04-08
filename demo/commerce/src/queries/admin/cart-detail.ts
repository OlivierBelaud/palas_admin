import { z } from 'zod'

export default defineQuery({
  name: 'cart-detail',
  description: 'Get a cart with its full event timeline',
  input: z.object({
    id: z.string(),
  }),
  handler: async (input, { query }) => {
    // Get the cart head
    const carts = await query.graph({
      entity: 'cart',
      pagination: { limit: 1 },
    }) as any[]
    const cart = carts.find((c: any) => c.id === input.id)
    if (!cart) return null

    // Get all events for this cart, ordered by time
    const events = await query.graph({
      entity: 'cartEvent',
      filters: { cart_id: input.id },
      pagination: { limit: 1000 },
    }) as any[]

    events.sort((a: any, b: any) =>
      new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
    )

    return { ...cart, events }
  },
})
