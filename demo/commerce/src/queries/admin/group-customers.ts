
export default defineQuery({
  name: 'group-customers',
  description: 'List customers in a customer group',
  input: z.object({
    group_id: z.string(),
    limit: z.number().int().min(1).max(100).default(20),
    offset: z.number().int().min(0).default(0),
  }),
  handler: async (input, { query }) => {
    const allLinks = await query.graph({
      entity: 'customer_customer_group' as any,
      pagination: { limit: 500 },
    })

    const customerIds = (allLinks as any[])
      .filter((l) => l.customer_group_id === input.group_id)
      .map((l) => l.customer_id)
      .filter(Boolean)

    if (customerIds.length === 0) return { data: [], count: 0 }

    const allCustomers = await query.graph({
      entity: 'customer',
      pagination: { limit: 200 },
    })

    const linked = (allCustomers as any[]).filter((c) => customerIds.includes(c.id))
    const off = input.offset ?? 0
    const lim = input.limit ?? 20
    const paged = linked.slice(off, off + lim)

    return { data: paged, count: linked.length }
  },
})
