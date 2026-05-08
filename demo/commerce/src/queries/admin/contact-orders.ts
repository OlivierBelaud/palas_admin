// Named query: list orders linked to a contact via the order-contact pivot.
// Loads the contact with its orders relation (alias resolved by the link
// generator) and returns the orders sorted by placed_at desc.

export default defineQuery({
  name: 'contact-orders',
  description: 'List orders linked to a contact (sorted by placed_at desc)',
  input: z.object({
    id: z.string(),
    limit: z.number().int().min(1).max(200).default(50),
    offset: z.number().int().min(0).default(0),
  }),
  handler: async (input, { query }) => {
    const contacts = await query.graph({
      entity: 'contact',
      fields: ['id', 'orders.*'],
      filters: { id: input.id },
      pagination: { limit: 1 },
    })

    const contact = contacts[0] as unknown as Record<string, unknown> | undefined
    if (!contact) return { data: [], count: 0 }

    const allOrders = ((contact.orders ?? []) as Record<string, unknown>[]).slice()
    allOrders.sort((a, b) => {
      const ta = a.placed_at ? new Date(a.placed_at as string).getTime() : 0
      const tb = b.placed_at ? new Date(b.placed_at as string).getTime() : 0
      return tb - ta
    })

    const off = input.offset ?? 0
    const lim = input.limit ?? 50
    const paged = allOrders.slice(off, off + lim)

    return { data: paged, count: allOrders.length }
  },
})
