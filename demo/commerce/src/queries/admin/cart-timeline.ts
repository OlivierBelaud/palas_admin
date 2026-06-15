import { readRows } from '../../utils/drizzle-read'
// Named query: unified timeline — PostHog cart events + Klaviyo events

import { posthogPrivateKey, runPosthogHogQL } from '../../utils/posthog-query'

export default defineQuery({
  name: 'cart-timeline',
  description: 'Unified timeline of PostHog navigation + Klaviyo events for a cart',
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, { db, schema, log }) => {
    const carts = await readRows(
      { db, schema },
      {
        entity: 'cart',
        filters: { id: input.id },
        fields: ['email', 'distinct_id'],
        pagination: { limit: 1 },
      },
    )
    const cart = carts[0] as unknown as Record<string, unknown>
    const email = cart?.email as string | undefined
    const distinctId = cart?.distinct_id as string | undefined
    log.info(`[cart-timeline] cart=${input.id} email=${email ?? '(none)'} distinct_id=${distinctId ?? '(none)'}`)
    if (!email && !distinctId) return []

    const key = posthogPrivateKey()
    if (!key) {
      log.warn('[cart-timeline] POSTHOG_API_KEY not set')
      return []
    }

    const safeEmail = email ? email.replace(/'/g, "''") : ''
    const safeDistinctId = distinctId ? distinctId.replace(/'/g, "''") : ''

    try {
      const columns = ['action', 'occurred_at', 'source', 'detail', 'amount']
      const results = await runPosthogHogQL(
        `
              WITH timeline AS (
                SELECT
                  e.event AS action,
                  e.timestamp AS occurred_at,
                  'PostHog' AS source,
                  JSONExtractString(e.properties, '$current_url') AS detail,
                  -- Some pixel events nest the cart under \`properties.cart\`, others
                  -- put total_price at the top level. Falls back to NULL so the UI
                  -- renders "—" instead of a misleading 0 when absent.
                  CASE
                    WHEN JSONHas(e.properties, 'total_price') THEN JSONExtractFloat(e.properties, 'total_price')
                    WHEN JSONHas(e.properties, 'cart', 'total_price') THEN JSONExtractFloat(e.properties, 'cart', 'total_price')
                    ELSE NULL
                  END AS amount
                FROM events e
                WHERE ${safeDistinctId ? `e.distinct_id = '${safeDistinctId}'` : `person.properties.email = '${safeEmail}'`}
                  AND (e.event LIKE 'cart:%' OR e.event LIKE 'checkout:%')
                UNION ALL
                SELECT
                  km.name AS action,
                  parseDateTimeBestEffort(ke.datetime) AS occurred_at,
                  'Klaviyo' AS source,
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
        { privateKey: key },
      )
      log.info(`[cart-timeline] PostHog returned ${results?.length ?? 0} rows, columns=${columns.join(',')}`)
      if (!results) return []
      return results.map((row) => {
        const obj: Record<string, unknown> = {}
        columns.forEach((col, i) => {
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
