// Named query: contact linked to an order, with a few summary fields the
// detail page surfaces (email, name, lifetime order count). Returns null
// when the order has no linked contact yet — the UI hides the "Voir la
// fiche client" button in that case.

export default defineQuery({
  name: 'order-contact-info',
  description: 'Contact linked to an order via the order-contact pivot',
  input: z.object({
    id: z.string(),
  }),
  handler: async (input, { query }) => {
    const orders = await query.graph({
      entity: 'order',
      fields: ['id', 'contact.*'],
      filters: { id: input.id },
      pagination: { limit: 1 },
    })

    const order = orders[0] as unknown as Record<string, unknown> | undefined
    if (!order) return null

    const contact = order.contact as Record<string, unknown> | null | undefined
    if (!contact || !contact.id) return null

    return {
      contact_id: contact.id,
      email: contact.email ?? null,
      first_name: contact.first_name ?? null,
      last_name: contact.last_name ?? null,
      orders_count: contact.orders_count ?? 0,
      contact_url: `/clients/${contact.id}`,
    }
  },
})
