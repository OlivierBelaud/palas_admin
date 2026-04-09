
export default defineQuery({
  name: 'customer-billing-address',
  description: 'Get the single billing address for a customer (falls back to default shipping)',
  input: z.object({
    customer_id: z.string(),
  }),
  handler: async (input, { query }) => {
    const allLinks = await query.graph({
      entity: 'customer_address' as any,
      pagination: { limit: 500 },
    })

    const customerLinks = (allLinks as any[])
      .filter((l) => l.customer_id === input.customer_id)

    if (customerLinks.length === 0) return null

    // Try billing first, fallback to default shipping
    let targetLink = customerLinks.find((l) => l.type === 'billing')
    if (!targetLink) {
      targetLink = customerLinks.find((l) => l.type === 'shipping' && l.is_default)
    }
    if (!targetLink) return null

    const allAddresses = await query.graph({
      entity: 'address',
      pagination: { limit: 200 },
    })

    const address = (allAddresses as any[]).find((a) => a.id === targetLink.address_id)
    if (!address) return null

    return {
      ...address,
      type: targetLink.type,
      is_default: targetLink.is_default,
      is_fallback: targetLink.type === 'shipping',
    }
  },
})
