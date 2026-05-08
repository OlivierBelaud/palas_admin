// Named query: list carts linked to a contact via the cart-contact pivot.
// Loads the contact with its carts relation (alias resolved by the link
// generator) and returns the carts sorted by last_action_at desc.

export default defineQuery({
  name: 'contact-carts',
  description: 'List carts linked to a contact (sorted by last_action_at desc)',
  input: z.object({
    id: z.string(),
    limit: z.number().int().min(1).max(200).default(50),
    offset: z.number().int().min(0).default(0),
  }),
  handler: async (input, { query }) => {
    const contacts = await query.graph({
      entity: 'contact',
      fields: ['id', 'carts.*'],
      filters: { id: input.id },
      pagination: { limit: 1 },
    })

    const contact = contacts[0] as unknown as Record<string, unknown> | undefined
    if (!contact) return { data: [], count: 0 }

    const allCarts = ((contact.carts ?? []) as Record<string, unknown>[]).slice()
    allCarts.sort((a, b) => {
      const ta = a.last_action_at ? new Date(a.last_action_at as string).getTime() : 0
      const tb = b.last_action_at ? new Date(b.last_action_at as string).getTime() : 0
      return tb - ta
    })

    const off = input.offset ?? 0
    const lim = input.limit ?? 50
    const paged = allCarts.slice(off, off + lim)

    return { data: paged, count: allCarts.length }
  },
})
