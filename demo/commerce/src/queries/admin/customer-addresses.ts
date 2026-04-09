
export default defineQuery({
  name: 'customer-addresses',
  description: 'List shipping addresses linked to a customer',
  input: z.object({
    customer_id: z.string(),
    type: z.enum(['shipping', 'billing']).default('shipping'),
    limit: z.number().int().min(1).max(100).default(20),
    offset: z.number().int().min(0).default(0),
  }),
  handler: async (input, { query }) => {
    const allLinks = await query.graph({
      entity: 'customer_address' as any,
      pagination: { limit: 500 },
    })

    const customerLinks = (allLinks as any[])
      .filter((l) => l.customer_id === input.customer_id && l.type === input.type)

    if (customerLinks.length === 0) return { data: [], count: 0 }

    const addressIds = customerLinks.map((l) => l.address_id).filter(Boolean)

    const allAddresses = await query.graph({
      entity: 'address',
      pagination: { limit: 200 },
    })

    const linked = (allAddresses as any[])
      .filter((a) => addressIds.includes(a.id))
      .map((a) => {
        const link = customerLinks.find((l) => l.address_id === a.id)
        return { ...a, type: link?.type, is_default: link?.is_default }
      })

    const off = input.offset ?? 0
    const lim = input.limit ?? 20
    const paged = linked.slice(off, off + lim)

    return { data: paged, count: linked.length }
  },
})
