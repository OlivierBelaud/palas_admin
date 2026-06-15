import { readRows } from '../../utils/drizzle-read'
// Named query: fetch Shopify orders from PostHog Data Warehouse

import { posthogPrivateKey, runPosthogHogQL } from '../../utils/posthog-query'

export default defineQuery({
  name: 'cart-shopify-orders',
  description: 'Shopify order history for a cart customer',
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, { db, schema, log }) => {
    const carts = await readRows(
      { db, schema },
      {
        entity: 'cart',
        filters: { id: input.id },
        fields: ['email'],
        pagination: { limit: 1 },
      },
    )
    const email = (carts[0] as unknown as Record<string, unknown>)?.email as string | undefined
    log.info(`[cart-shopify-orders] cart=${input.id} email=${email ?? '(none)'}`)
    if (!email) return []

    const key = posthogPrivateKey()
    if (!key) {
      log.warn('[cart-shopify-orders] POSTHOG_API_KEY not set')
      return []
    }

    try {
      const columns = ['order_name', 'status', 'total', 'currency', 'created_at']
      const results = await runPosthogHogQL(
        `
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
        { privateKey: key },
      )
      if (!results) return []
      return results.map((row) => {
        const obj: Record<string, unknown> = {}
        columns.forEach((col, i) => {
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
