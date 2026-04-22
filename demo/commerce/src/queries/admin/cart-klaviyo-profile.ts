// Named query: fetch Klaviyo profile from PostHog Data Warehouse

export default defineQuery({
  name: 'cart-klaviyo-profile',
  description: 'Klaviyo profile for a cart customer',
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
      log.warn('[cart-klaviyo-profile] POSTHOG_API_KEY not set')
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
          },
        }),
      })
      if (!res.ok) {
        log.warn(`[cart-klaviyo-profile] PostHog ${res.status}`)
        return {}
      }
      const data = (await res.json()) as { results?: unknown[][]; columns?: string[] }
      if (!data.results?.[0] || !data.columns) return {}
      const row: Record<string, unknown> = {}
      data.columns.forEach((col, i) => {
        row[col] = data.results![0][i]
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
