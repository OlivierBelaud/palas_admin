import { z } from 'zod'

export default defineQuery({
  name: 'cart-list',
  description: 'List carts with computed client display name and PostHog link',
  input: z.object({}).optional(),
  handler: async (_input, { query }) => {
    const carts = await query.graph({
      entity: 'cart',
      fields: [
        'email', 'first_name', 'last_name', 'distinct_id',
        'total_price', 'item_count', 'currency',
        'last_action', 'highest_stage', 'status', 'last_action_at',
      ],
      pagination: { limit: 200 },
    }) as any[]

    return carts.map((c: any) => {
      // Client display: email if known, otherwise truncated PostHog ID
      const clientName = c.email
        ?? (c.distinct_id ? `${c.distinct_id.slice(0, 8)}…` : 'Anonyme')

      // PostHog person link (EU instance)
      const posthogUrl = c.distinct_id
        ? `https://eu.posthog.com/persons?q=${encodeURIComponent(c.distinct_id)}`
        : null

      return {
        ...c,
        client: clientName,
        posthog_url: posthogUrl,
      }
    })
  },
})
