import { z } from 'zod'

export default defineQuery({
  name: 'group-detail',
  description: 'Get customer group details with linked customer IDs',
  input: z.object({
    id: z.string(),
  }),
  handler: async (input, { query }) => {
    const groups = await query.graph({
      entity: 'customerGroup',
      pagination: { limit: 200 },
    })
    const group = (groups as any[]).find((g: any) => g.id === input.id)
    if (!group) return null

    const allLinks = await query.graph({
      entity: 'customer_customer_group' as any,
      pagination: { limit: 500 },
    })
    const customerIds = (allLinks as any[])
      .filter((l: any) => l.customer_group_id === input.id)
      .map((l: any) => l.customer_id)
      .filter(Boolean)

    return { ...group, customer_ids: customerIds }
  },
})
