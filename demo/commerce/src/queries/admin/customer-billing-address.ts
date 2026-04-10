export default defineQuery({
  name: 'customer-billing-address',
  description: 'Get the single billing address for a customer (falls back to default shipping)',
  input: z.object({
    customer_id: z.string(),
  }),
  handler: async (input, { query }) => {
    // Single query: load customer with all addresses via 1:N relation (pivot has type + is_default)
    const customers = await query.graph({
      entity: 'customer',
      fields: ['*', 'addresses.*'],
      filters: { id: input.customer_id },
      pagination: { limit: 1 },
    })

    const customer = customers[0] as Record<string, unknown> | undefined
    if (!customer) return null

    const addresses = (customer.addresses ?? []) as Record<string, unknown>[]
    if (addresses.length === 0) return null

    // Try billing first, fallback to default shipping
    let target = addresses.find((a) => a.type === 'billing')
    if (!target) {
      target = addresses.find((a) => a.type === 'shipping' && a.is_default)
    }
    if (!target) return null

    return {
      ...target,
      is_fallback: target.type === 'shipping',
    }
  },
})
