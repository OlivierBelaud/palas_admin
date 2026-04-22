// Named query: abandonment monitoring — abandoned carts + recovered carts.
//
// Scope: every cart that went through the abandonment funnel, regardless of
// final outcome. Concretely:
//   - status != completed AND email IS NOT NULL  (ongoing abandonments)
//   - status == completed AND an abandonment email was sent BEFORE completion
//     (recoveries — proves the email worked)
//
// Carts that completed without any abandonment email are NORMAL conversions,
// not part of the abandonment pipeline — excluded from this view.
//
// Enrichments per cart:
//   - number_of_orders  — lifetime order count from shopify_customers DW
//   - last_abandon_email_at — most recent abandonment email received
//     (Shopify's Shopify_Checkout_Abandonned OR a Klaviyo abandonment email)
//   - recovery_category — 'recovered' | 'pending_recovery' | 'not_picked_up'
//
// Three data sources merged server-side:
//   1. Our carts table (PG)
//   2. PostHog DW shopify_customers (for lifetime order count)
//   3. PostHog DW klaviyo_events (for last abandonment email)

type CartRow = {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  total_price: number
  item_count: number
  highest_stage: string
  status: string
  last_action: string
  last_action_at: Date
  shopify_order_id: string | null
}

export default defineQuery({
  name: 'abandoned-carts',
  description: 'Identified carts that never reached completed, enriched with order count and last recovery email',
  input: z.object({
    limit: z.number().int().positive().max(500).default(100),
    offset: z.number().int().min(0).default(0),
    days: z.number().int().positive().max(90).default(30),
  }),
  handler: async (input, { query, log }) => {
    // ── 1. Fetch ALL identified carts from our DB ─────────────────────
    // We filter recovered vs normal-conversion in-memory after enrichment
    // with email timestamps. Fetch 2x `limit` to leave headroom for the
    // normal-conversion filter downstream.
    const fetchLimit = Math.min((input.limit ?? 100) * 2, 500)
    const carts = (await query.graph({
      entity: 'cart',
      filters: { email: { $notnull: true } },
      fields: [
        'id',
        'email',
        'first_name',
        'last_name',
        'total_price',
        'item_count',
        'highest_stage',
        'status',
        'last_action',
        'last_action_at',
        'shopify_order_id',
      ],
      sort: { last_action_at: 'desc' },
      pagination: { limit: fetchLimit, offset: input.offset },
    })) as unknown as CartRow[]

    if (carts.length === 0) return []

    // Filter to the window (days) — cheaper than pushing into graph query
    // because $notnull on email/$ne on status already narrowed it.
    const days = input.days ?? 30
    const cutoff = Date.now() - days * 86400 * 1000
    const windowed = carts.filter((c) => new Date(c.last_action_at).getTime() >= cutoff)

    const emails = Array.from(new Set(windowed.map((c) => c.email.toLowerCase())))
    if (emails.length === 0) return []

    // ── 2. Fetch order counts + last abandon email (two HogQL queries in parallel) ─
    const host = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
    const key = process.env.POSTHOG_API_KEY
    const emailsList = emails.map((e) => `'${e.replace(/'/g, "''")}'`).join(',')

    const orderCountByEmail = new Map<string, number>()
    const lastAbandonEmailByEmail = new Map<string, string>()

    if (key) {
      const hogql = async (q: string) => {
        try {
          const res = await fetch(`${host}/api/projects/@current/query/`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: { kind: 'HogQLQuery', query: q },
              refresh: 'force_blocking',
            }),
          })
          if (!res.ok) {
            log.warn(`[abandoned-carts] HogQL ${res.status}`)
            return [] as unknown[][]
          }
          const data = (await res.json()) as { results?: unknown[][] }
          return data.results ?? []
        } catch (err) {
          log.warn(`[abandoned-carts] HogQL ${(err as Error).message}`)
          return [] as unknown[][]
        }
      }

      const [orderRows, emailRows] = await Promise.all([
        // Order count per customer (Shopify DW)
        hogql(`
          SELECT lower(JSONExtractString(sc.default_email_address, 'emailAddress')) AS email,
                 sc.number_of_orders
          FROM shopify_customers sc
          WHERE lower(JSONExtractString(sc.default_email_address, 'emailAddress')) IN (${emailsList})
          LIMIT 10000
        `),
        // Last abandonment email per customer (Klaviyo DW)
        // Catches both Shopify's own abandoned-checkout trigger and Klaviyo's abandonment flow emails.
        hogql(`
          SELECT lower(kp.email) AS email, max(ke.datetime) AS last_at
          FROM klaviyo_events ke
          JOIN klaviyo_profiles kp ON kp.id = JSONExtractString(ke.relationships, 'profile', 'data', 'id')
          JOIN klaviyo_metrics km ON km.id = JSONExtractString(ke.relationships, 'metric', 'data', 'id')
          WHERE lower(kp.email) IN (${emailsList})
            AND (
              km.name = 'Shopify_Checkout_Abandonned'
              OR (
                km.name = 'Received Email'
                AND (
                  positionCaseInsensitive(JSONExtractString(ke.event_properties, 'Subject'), 'oublié quelque chose') > 0
                  OR positionCaseInsensitive(JSONExtractString(ke.event_properties, 'Subject'), 'pensez encore') > 0
                  OR positionCaseInsensitive(JSONExtractString(ke.event_properties, 'Subject'), 'attend plus que vous') > 0
                )
              )
            )
          GROUP BY lower(kp.email)
          LIMIT 10000
        `),
      ])

      for (const row of orderRows) {
        const email = row[0] as string | null
        const count = Number(row[1] ?? 0)
        if (email) orderCountByEmail.set(email, count)
      }
      for (const row of emailRows) {
        const email = row[0] as string | null
        const ts = row[1] as string | null
        if (email && ts) lastAbandonEmailByEmail.set(email, ts)
      }
    } else {
      log.warn('[abandoned-carts] POSTHOG_API_KEY not set — enrichment skipped')
    }

    // ── 3. Merge, classify, filter to the abandonment funnel ──────────
    const enriched = windowed.map((c) => {
      const emailKey = c.email.toLowerCase()
      const lastEmailAt = lastAbandonEmailByEmail.get(emailKey) ?? null
      const isCompleted = c.status === 'completed'
      const lastActionMs = new Date(c.last_action_at).getTime()
      const lastEmailMs = lastEmailAt ? new Date(lastEmailAt).getTime() : 0

      // Recovery category:
      //  - `recovered`         = completed AND an abandon email was sent
      //    before the completion event (email → conversion)
      //  - `pending_recovery`  = not completed AND email was sent — live
      //    retargeting target still hot
      //  - `not_picked_up`     = not completed AND no email — gap in the
      //    recovery flow, direct action candidate
      //  - `normal_conversion` = completed, never got an abandon email —
      //    excluded from this view (not part of abandonment funnel)
      let category: 'recovered' | 'pending_recovery' | 'not_picked_up' | 'normal_conversion'
      if (isCompleted) {
        category = lastEmailAt && lastEmailMs < lastActionMs ? 'recovered' : 'normal_conversion'
      } else {
        category = lastEmailAt ? 'pending_recovery' : 'not_picked_up'
      }

      // "Was already a customer at the time of THIS cart":
      // - If this cart is completed, it just contributed one order — so the
      //   person needed ≥2 orders total to have been a returning customer
      //   before the cart was placed.
      // - If this cart is not completed, it doesn't count toward their order
      //   history — ≥1 past order is enough to mark them as existing.
      const ordersCount = orderCountByEmail.get(emailKey) ?? 0
      const isExistingCustomer = isCompleted ? ordersCount >= 2 : ordersCount >= 1

      return {
        id: c.id,
        email: c.email,
        first_name: c.first_name,
        last_name: c.last_name,
        total_price: c.total_price,
        item_count: c.item_count,
        highest_stage: c.highest_stage,
        status: c.status,
        last_action: c.last_action,
        last_action_at: c.last_action_at,
        number_of_orders: ordersCount,
        last_abandon_email_at: lastEmailAt,
        recovery_category: category,
        is_existing_customer: isExistingCustomer,
      }
    })

    return enriched.filter((r) => r.recovery_category !== 'normal_conversion').slice(0, input.limit ?? 100)
  },
})
