// Named query: fetch Shopify customer stats from PostHog Data Warehouse
// Resolves cart email first, then queries shopify_customers via HogQL.

export default defineQuery({
  name: 'cart-shopify-customer',
  description: 'Shopify customer lifetime stats for a cart',
  input: z.object({ id: z.string() }),
  handler: async (input, { query, log }) => {
    const carts = await query.graph({
      entity: 'cart',
      filters: { id: input.id },
      fields: ['email'],
      pagination: { limit: 1 },
    })
    const email = carts[0]?.email
    if (!email) return {}

    const host = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
    const key = process.env.POSTHOG_API_KEY
    if (!key) {
      log.warn('[cart-shopify-customer] POSTHOG_API_KEY not set')
      return {}
    }

    try {
      const res = await fetch(`${host}/api/projects/@current/query/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: {
            kind: 'HogQLQuery',
            query: `
              SELECT
                sc.first_name, sc.last_name, sc.number_of_orders,
                JSONExtractString(sc.amount_spent, 'amount') AS lifetime_revenue,
                sc.lifetime_duration,
                sc.created_at AS customer_since,
                JSONExtractString(sc.default_email_address, 'marketingState') AS marketing_state
              FROM shopify_customers sc
              WHERE JSONExtractString(sc.default_email_address, 'emailAddress') = '${email.replace(/'/g, "''")}'
              LIMIT 1
            `,
          },
        }),
      })
      if (!res.ok) {
        log.warn(`[cart-shopify-customer] PostHog ${res.status}`)
        return {}
      }
      const data = (await res.json()) as { results?: unknown[][]; columns?: string[] }
      if (!data.results?.[0] || !data.columns) return {}
      const row: Record<string, unknown> = {}
      data.columns.forEach((col, i) => {
        row[col] = data.results![0][i]
      })
      return row
    } catch (err) {
      log.warn(`[cart-shopify-customer] ${(err as Error).message}`)
      return {}
    }
  },
})
