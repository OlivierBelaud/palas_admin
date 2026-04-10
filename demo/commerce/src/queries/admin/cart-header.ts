export default defineQuery({
  name: 'cart-header',
  description: 'Cart header: title (email or PostHog ID) + PostHog link',
  input: z.object({
    id: z.string(),
  }),
  handler: async (input, { query }) => {
    const carts = await query.graph({
      entity: 'cart',
      filters: { id: input.id },
      fields: ['email', 'distinct_id'],
      pagination: { limit: 1 },
    })

    const cart = carts[0]
    if (!cart) return { title: 'Panier inconnu', posthog_url: '', posthog_label: '' }

    const title = cart.email ?? cart.distinct_id ?? 'Anonyme'
    const posthogUrl = cart.distinct_id
      ? `https://eu.posthog.com/project/153280/person/${encodeURIComponent(cart.distinct_id)}`
      : ''

    return { title, posthog_url: posthogUrl, posthog_label: 'Voir dans PostHog ↗' }
  },
})
