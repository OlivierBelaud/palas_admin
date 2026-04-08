import { z } from 'zod'

export default defineQuery({
  name: 'cart-header',
  description: 'Cart header: title (email or PostHog ID) + PostHog link',
  input: z.object({
    id: z.string(),
  }),
  handler: async (input, { query }) => {
    const carts = await query.graph({
      entity: 'cart',
      fields: ['email', 'distinct_id'],
      pagination: { limit: 5000 },
    }) as any[]

    const cart = carts.find((c: any) => c.id === input.id)
    if (!cart) return { title: 'Panier inconnu', posthog_url: '', posthog_label: '' }

    const title = cart.email ?? cart.distinct_id ?? 'Anonyme'
    const posthogUrl = cart.distinct_id
      ? `https://eu.posthog.com/persons?q=${encodeURIComponent(cart.distinct_id)}`
      : ''
    const posthogLabel = `Voir dans PostHog ↗`

    return { title, posthog_url: posthogUrl, posthog_label: posthogLabel }
  },
})
