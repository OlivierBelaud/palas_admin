export default defineQuery({
  name: 'group-customers',
  description: 'List customers in a customer group',
  input: z.object({
    group_id: z.string(),
    limit: z.number().int().min(1).max(100).default(20),
    offset: z.number().int().min(0).default(0),
  }),
  handler: async (input, { query }) => {
    // Single query: load customer group with its customers via M:N relation
    const groups = await query.graph({
      entity: 'customerGroup',
      fields: ['*', 'customers.*'],
      filters: { id: input.group_id },
      pagination: { limit: 1 },
    })

    const group = groups[0] as unknown as Record<string, unknown> | undefined
    if (!group) return { data: [], count: 0 }

    const allCustomers = (group.customers ?? []) as Record<string, unknown>[]
    const off = input.offset ?? 0
    const lim = input.limit ?? 20
    const paged = allCustomers.slice(off, off + lim)

    return { data: paged, count: allCustomers.length }
  },
})
