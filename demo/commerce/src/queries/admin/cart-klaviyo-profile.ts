import { readRows } from '../../utils/drizzle-read'
// Named query: fetch Klaviyo profile from PostHog Data Warehouse

import { posthogPrivateKey, runPosthogHogQL } from '../../utils/posthog-query'

export default defineQuery({
  name: 'cart-klaviyo-profile',
  description: 'Klaviyo profile for a cart customer',
  input: z.object({ id: z.string() }),
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
    const email = carts[0]?.email
    if (!email) return {}

    const key = posthogPrivateKey()
    if (!key) {
      log.warn('[cart-klaviyo-profile] POSTHOG_API_KEY not set')
      return {}
    }

    try {
      const columns = [
        'id',
        'email',
        'first_name',
        'last_name',
        'city',
        'country',
        'langue',
        'subscribed_since',
        'last_event_date',
      ]
      const results = await runPosthogHogQL(
        `
              SELECT
                kp.id,
                kp.email, kp.first_name, kp.last_name,
                JSONExtractString(kp.location, 'city') AS city,
                JSONExtractString(kp.location, 'country') AS country,
                JSONExtractString(kp.properties, 'Langue') AS langue,
                kp.created AS subscribed_since,
                kp.last_event_date
              FROM klaviyo_profiles kp
              WHERE kp.email = '${email.replace(/'/g, "''")}'
              LIMIT 1
            `,
        { privateKey: key },
      )
      if (!results?.[0]) return {}
      const row: Record<string, unknown> = {}
      columns.forEach((col, i) => {
        row[col] = results[0][i]
      })

      // Klaviyo profile URL — resolved server-side.
      const klaviyoId = row.id as string | undefined
      if (klaviyoId) {
        row.klaviyo_profile_url = `https://www.klaviyo.com/profile/${klaviyoId}`
      }

      return row
    } catch (err) {
      log.warn(`[cart-klaviyo-profile] ${(err as Error).message}`)
      return {}
    }
  },
})
