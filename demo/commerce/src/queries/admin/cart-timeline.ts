// Named query: unified timeline — PostHog cart events + Klaviyo events

export default defineQuery({
  name: 'cart-timeline',
  description: 'Unified timeline of PostHog navigation + Klaviyo events for a cart',
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, { query, log }) => {
    const carts = await query.graph({
      entity: 'cart',
      filters: { id: input.id },
      fields: ['email', 'distinct_id'],
      pagination: { limit: 1 },
    })
    const cart = carts[0] as unknown as Record<string, unknown>
    const email = cart?.email as string | undefined
    const distinctId = cart?.distinct_id as string | undefined
    log.info(`[cart-timeline] cart=${input.id} email=${email ?? '(none)'} distinct_id=${distinctId ?? '(none)'}`)
    if (!email && !distinctId) return []

    const host = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
    const key = process.env.POSTHOG_API_KEY
    if (!key) {
      log.warn('[cart-timeline] POSTHOG_API_KEY not set')
      return []
    }

    const safeEmail = email ? email.replace(/'/g, "''") : ''
    const safeDistinctId = distinctId ? distinctId.replace(/'/g, "''") : ''

    try {
      const res = await fetch(`${host}/api/projects/@current/query/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: {
            kind: 'HogQLQuery',
            query: `
              WITH timeline AS (
                SELECT
                  e.event AS action,
                  toString(e.timestamp) AS occurred_at,
                  'navigation' AS source,
                  JSONExtractString(e.properties, '$current_url') AS detail,
                  JSONExtractFloat(e.properties, 'total_price') AS amount
                FROM events e
                WHERE ${safeDistinctId ? `e.distinct_id = '${safeDistinctId}'` : `person.properties.email = '${safeEmail}'`}
                  AND (e.event LIKE 'cart:%' OR e.event LIKE 'checkout:%')
                UNION ALL
                SELECT
                  km.name AS action,
                  ke.datetime AS occurred_at,
                  'klaviyo' AS source,
                  coalesce(
                    JSONExtractString(ke.event_properties, 'Subject'),
                    JSONExtractString(ke.event_properties, 'Campaign Name'),
                    JSONExtractString(ke.event_properties, 'Product Name'),
                    JSONExtractString(ke.event_properties, 'Variant Name'),
                    ''
                  ) AS detail,
                  JSONExtractFloat(ke.event_properties, '$value') AS amount
                FROM klaviyo_events ke
                JOIN klaviyo_profiles kp ON kp.id = JSONExtractString(ke.relationships, 'profile', 'data', 'id')
                JOIN klaviyo_metrics km ON km.id = JSONExtractString(ke.relationships, 'metric', 'data', 'id')
                WHERE kp.email = '${safeEmail}'
              )
              SELECT action, occurred_at, source, detail, amount
              FROM timeline
              ORDER BY occurred_at DESC
              LIMIT 100
            `,
          },
        }),
      })
      if (!res.ok) {
        const errText = await res.text()
        log.error(`[cart-timeline] PostHog ${res.status}: ${errText.substring(0, 300)}`)
        return []
      }
      const data = (await res.json()) as { results?: unknown[][]; columns?: string[] }
      log.info(`[cart-timeline] PostHog returned ${data.results?.length ?? 0} rows, columns=${data.columns?.join(',')}`)
      if (!data.results || !data.columns) return []
      return data.results.map((row) => {
        const obj: Record<string, unknown> = {}
        data.columns!.forEach((col, i) => {
          obj[col] = row[i]
        })
        return obj
      })
    } catch (err) {
      log.warn(`[cart-timeline] ${(err as Error).message}`)
      return []
    }
  },
})
