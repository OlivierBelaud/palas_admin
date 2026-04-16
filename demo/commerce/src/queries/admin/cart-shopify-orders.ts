// Named query: fetch Shopify orders from PostHog Data Warehouse

export default defineQuery({
  name: 'cart-shopify-orders',
  description: 'Shopify order history for a cart customer',
  input: z.object({ id: z.string() }),
  handler: async (input, { query, log }) => {
    const carts = await query.graph({
      entity: 'cart',
      filters: { id: input.id },
      fields: ['email'],
      pagination: { limit: 1 },
    })
    const email = (carts[0] as unknown as Record<string, unknown>)?.email as string | undefined
    log.info(`[cart-shopify-orders] cart=${input.id} email=${email ?? '(none)'}`)
    if (!email) return []

    const host = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
    const key = process.env.POSTHOG_API_KEY
    if (!key) {
      log.warn('[cart-shopify-orders] POSTHOG_API_KEY not set')
      return []
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
                so.name AS order_name,
                so.display_financial_status AS status,
                JSONExtractString(so.total_price_set, 'shopMoney', 'amount') AS total,
                JSONExtractString(so.total_price_set, 'shopMoney', 'currencyCode') AS currency,
                so.created_at
              FROM shopify_orders so
              WHERE so.email = '${email.replace(/'/g, "''")}'
              ORDER BY so.created_at DESC
              LIMIT 20
            `,
          },
        }),
      })
      if (!res.ok) {
        log.warn(`[cart-shopify-orders] PostHog ${res.status}`)
        return []
      }
      const data = (await res.json()) as { results?: unknown[][]; columns?: string[] }
      if (!data.results || !data.columns) return []
      return data.results.map((row) => {
        const obj: Record<string, unknown> = {}
        data.columns!.forEach((col, i) => {
          obj[col] = row[i]
        })
        return obj
      })
    } catch (err) {
      log.warn(`[cart-shopify-orders] ${(err as Error).message}`)
      return []
    }
  },
})
