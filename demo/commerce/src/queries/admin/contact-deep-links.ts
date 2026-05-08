// Named query: build the external deep-link URLs for a contact (Shopify,
// Klaviyo, PostHog). Each URL is null when the corresponding external ID
// is missing, so the UI can hide the corresponding action button.

export default defineQuery({
  name: 'contact-deep-links',
  description: 'External deep-link URLs (Shopify / Klaviyo / PostHog) for a contact',
  input: z.object({
    id: z.string(),
  }),
  handler: async (input, { query }) => {
    const contacts = await query.graph({
      entity: 'contact',
      fields: ['shopify_customer_id', 'klaviyo_profile_id', 'distinct_id'],
      filters: { id: input.id },
      pagination: { limit: 1 },
    })

    const contact = contacts[0] as unknown as Record<string, unknown> | undefined
    if (!contact) return { shopify_url: null, klaviyo_url: null, posthog_url: null }

    const shopifyId = (contact.shopify_customer_id as string | null) ?? null
    const klaviyoId = (contact.klaviyo_profile_id as string | null) ?? null
    const distinctId = (contact.distinct_id as string | null) ?? null

    return {
      shopify_url: shopifyId
        ? `https://admin.shopify.com/store/fancy-palas/customers/${encodeURIComponent(shopifyId)}`
        : null,
      klaviyo_url: klaviyoId ? `https://www.klaviyo.com/profile/${encodeURIComponent(klaviyoId)}` : null,
      posthog_url: distinctId
        ? `https://eu.i.posthog.com/project/153280/persons/${encodeURIComponent(distinctId)}`
        : null,
    }
  },
})
