export default defineQuery({
  name: 'group-detail',
  description: 'Get customer group details with linked customer IDs',
  input: z.object({
    id: z.string(),
  }),
  handler: async (input, { query }) => {
    // Single query: load customer group with its customers via M:N relation
    const groups = await query.graph({
      entity: 'customerGroup',
      fields: ['*', 'customers.*'],
      filters: { id: input.id },
      pagination: { limit: 1 },
    })

    const group = groups[0] as unknown as Record<string, unknown> | undefined
    if (!group) return null

    const customers = (group.customers ?? []) as Record<string, unknown>[]
    return { ...group, customer_ids: customers.map((c) => c.id) }
  },
})
