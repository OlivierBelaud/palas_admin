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
    // Single query: load customer with addresses via 1:N relation (pivot has type + is_default)
    const customers = await query.graph({
      entity: 'customer',
      fields: ['*', 'addresses.*'],
      filters: { id: input.customer_id },
      pagination: { limit: 1 },
    })

    const customer = customers[0] as Record<string, unknown> | undefined
    if (!customer) return { data: [], count: 0 }

    // Filter by type (pivot column merged into each address by the framework)
    const allAddresses = ((customer.addresses ?? []) as Record<string, unknown>[]).filter((a) => a.type === input.type)

    const off = input.offset ?? 0
    const lim = input.limit ?? 20
    const paged = allAddresses.slice(off, off + lim)

    return { data: paged, count: allAddresses.length }
  },
})
