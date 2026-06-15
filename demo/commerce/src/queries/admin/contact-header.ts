import { readRows } from '../../utils/drizzle-read'
// Contact detail header — exposes the title (full name → email fallback),
// phone (subtitle), and a Shopify deep link when the customer ID is known.
// Mirrors the cart-header query shape so the same HeaderDef contract works.

export default defineQuery({
  name: 'contact-header',
  description: 'Contact header: title (name or email) + Shopify customer link',
  input: z.object({
    id: z.string(),
  }),
  handler: async (input, { db, schema }) => {
    const contacts = await readRows(
      { db, schema },
      {
        entity: 'contact',
        filters: { id: input.id },
        fields: ['email', 'first_name', 'last_name', 'phone', 'shopify_customer_id'],
        pagination: { limit: 1 },
      },
    )

    const contact = contacts[0] as unknown as Record<string, unknown> | undefined
    if (!contact) return { email: 'Contact inconnu', phone: '', shopify_url: '', shopify_label: '' }

    const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim()
    const title = fullName || (contact.email as string | undefined) || 'Anonyme'
    const shopifyId = contact.shopify_customer_id as string | undefined
    const shopifyUrl = shopifyId
      ? `https://admin.shopify.com/store/fancy-palas/customers/${encodeURIComponent(shopifyId)}`
      : ''

    return {
      // `email` is what the page header reads via titleField; we expose the
      // resolved display name there so the same key works whether or not a
      // first/last name is recorded.
      email: title,
      phone: contact.phone ?? '',
      shopify_url: shopifyUrl,
      shopify_label: shopifyUrl ? 'Voir sur Shopify ↗' : '',
    }
  },
})
