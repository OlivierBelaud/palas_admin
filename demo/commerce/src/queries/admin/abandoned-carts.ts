// Named query: abandonment monitoring with per-cart email attribution.
//
// Rules live in docs/cart-abandonment-rules.md and the shared helper
// modules/cart-tracking/abandonment.ts. Key points:
//   - Activity state (browsing / dormant / dead / completed) is derived from
//     highest_stage + last_action_at. DB.status is not consulted.
//   - An abandonment email is attributed to a cart only if it falls inside
//     the cart's influence window (ATTRIBUTION_WINDOW_DAYS = 2). This stops
//     a December email from being credited to an April cart belonging to the
//     same returning customer.
//   - Five mutually exclusive categories: recovered / pending_recovery /
//     assisted_dead / not_picked_up / normal_conversion. The view excludes
//     normal_conversion (not part of the abandonment funnel).
//
// Enrichments come from two HogQL queries against the PostHog DW:
//   1. klaviyo_events — last abandonment email per customer (+ its
//      checkout_token when extractable from checkout_url)
//   2. shopify_customers — lifetime order count per customer
//
// The checkout_token match is the precise lever we fall back on when the
// time-based window has ambiguity (several carts per customer in 30d).

import {
  type AbandonmentCategory,
  computeActivityState,
  computeCategory,
  computeSubStage,
  isEmailAttributed,
} from '../../modules/cart-tracking/abandonment'

type CartRow = {
  id: string
  cart_token: string
  checkout_token: string | null
  email: string
  first_name: string | null
  last_name: string | null
  total_price: number
  item_count: number
  highest_stage: string
  last_action: string
  last_action_at: Date
  created_at: Date
  shopify_order_id: string | null
  abandon_notified_count: number | null
}

interface EnrichedRow {
  email: string
  last_at: string
  checkout_token: string | null
}

export default defineQuery({
  name: 'abandoned-carts',
  description: 'Carts in the abandonment funnel with per-cart email attribution and 5-way categorization',
  input: z.object({
    limit: z.number().int().positive().max(500).default(100),
    offset: z.number().int().min(0).default(0),
    days: z.number().int().positive().max(90).default(30),
  }),
  handler: async (input, { query, log }) => {
    // ── 1. Fetch identified carts (email present) within the window ─────
    // Over-fetch 2× to leave room for the normal_conversion filter downstream.
    const fetchLimit = Math.min((input.limit ?? 100) * 2, 500)
    const carts = (await query.graph({
      entity: 'cart',
      filters: { email: { $notnull: true } },
      fields: [
        'id',
        'cart_token',
        'checkout_token',
        'email',
        'first_name',
        'last_name',
        'total_price',
        'item_count',
        'highest_stage',
        'last_action',
        'last_action_at',
        'created_at',
        'shopify_order_id',
        'abandon_notified_count',
      ],
      sort: { last_action_at: 'desc' },
      pagination: { limit: fetchLimit, offset: input.offset },
    })) as unknown as CartRow[]

    if (carts.length === 0) return []

    const days = input.days ?? 30
    const nowMs = Date.now()
    const cutoffMs = nowMs - days * 86400 * 1000
    const windowed = carts.filter((c) => new Date(c.last_action_at).getTime() >= cutoffMs)

    const emails = Array.from(new Set(windowed.map((c) => c.email.toLowerCase())))
    if (emails.length === 0) return []

    // ── 2. HogQL enrichments in parallel ────────────────────────────────
    const host = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
    const key = process.env.POSTHOG_API_KEY
    const emailsList = emails.map((e) => `'${e.replace(/'/g, "''")}'`).join(',')

    const orderCountByEmail = new Map<string, number>()
    // Per (email, checkout_token) → email timestamp. We store the MAX per
    // bucket so the attribution path can still fall back on a time-window
    // match when the checkout_token is null (email from Received Email flow).
    const emailEventsByEmail = new Map<string, EnrichedRow[]>()

    if (key) {
      const hogql = async (q: string) => {
        try {
          const res = await fetch(`${host}/api/projects/@current/query/`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: { kind: 'HogQLQuery', query: q }, refresh: 'force_blocking' }),
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
        // Order count per customer
        hogql(`
          SELECT lower(JSONExtractString(sc.default_email_address, 'emailAddress')) AS email,
                 sc.number_of_orders
          FROM shopify_customers sc
          WHERE lower(JSONExtractString(sc.default_email_address, 'emailAddress')) IN (${emailsList})
          LIMIT 10000
        `),
        // All abandonment-related emails per customer, with checkout_token
        // extracted from checkout_url when present. Returns one row per event
        // so downstream can pick the best match per cart.
        hogql(`
          SELECT
            lower(kp.email) AS email,
            ke.datetime AS sent_at,
            extract(
              JSONExtractString(ke.event_properties, 'checkout_url'),
              'checkouts/ac/([^/?"]+)'
            ) AS checkout_token
          FROM klaviyo_events ke
          JOIN klaviyo_profiles kp ON kp.id = JSONExtractString(ke.relationships, 'profile', 'data', 'id')
          JOIN klaviyo_metrics km ON km.id = JSONExtractString(ke.relationships, 'metric', 'data', 'id')
          WHERE lower(kp.email) IN (${emailsList})
            AND ke.datetime >= now() - INTERVAL 90 DAY
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
          ORDER BY ke.datetime DESC
          LIMIT 20000
        `),
      ])

      for (const row of orderRows) {
        const email = row[0] as string | null
        const count = Number(row[1] ?? 0)
        if (email) orderCountByEmail.set(email, count)
      }
      for (const row of emailRows) {
        const email = row[0] as string | null
        const sentAt = row[1] as string | null
        const token = (row[2] as string | null) || null
        if (!email || !sentAt) continue
        const list = emailEventsByEmail.get(email) ?? []
        list.push({ email, last_at: sentAt, checkout_token: token })
        emailEventsByEmail.set(email, list)
      }
    } else {
      log.warn('[abandoned-carts] POSTHOG_API_KEY not set — enrichment skipped')
    }

    // ── 3. Per-cart attribution ─────────────────────────────────────────
    // Priority A: exact checkout_token match (when both cart and email have one)
    // Priority B: time-window attribution (±2d from last_action / completed_at)
    const findAttributedEmail = (cart: CartRow): { at: number; byToken: boolean } | null => {
      const events = emailEventsByEmail.get(cart.email.toLowerCase()) ?? []
      if (events.length === 0) return null

      // A. checkout_token exact match
      if (cart.checkout_token) {
        for (const ev of events) {
          if (ev.checkout_token && ev.checkout_token === cart.checkout_token) {
            return { at: new Date(ev.last_at).getTime(), byToken: true }
          }
        }
      }

      // B. time-window — find the latest email that passes isEmailAttributed
      const sorted = events
        .map((ev) => new Date(ev.last_at).getTime())
        .filter((t) => Number.isFinite(t))
        .sort((a, b) => b - a) // desc
      for (const at of sorted) {
        if (isEmailAttributed(cart, at, nowMs)) return { at, byToken: false }
      }
      return null
    }

    const enriched = windowed.map((c) => {
      const emailKey = c.email.toLowerCase()
      const match = findAttributedEmail(c)
      const attributedAtMs = match?.at ?? null

      const activity = computeActivityState(c, nowMs)
      const sub = computeSubStage(c.highest_stage)
      const category: AbandonmentCategory = computeCategory(c, attributedAtMs, nowMs)

      const ordersCount = orderCountByEmail.get(emailKey) ?? 0
      // If this cart completed it contributes +1 to the lifetime count — a
      // returning customer needs ≥2 total orders to have been "existing"
      // before this cart.
      const isExistingCustomer = c.highest_stage === 'completed' ? ordersCount >= 2 : ordersCount >= 1

      return {
        id: c.id,
        email: c.email,
        first_name: c.first_name,
        last_name: c.last_name,
        total_price: c.total_price,
        item_count: c.item_count,
        highest_stage: c.highest_stage,
        last_action: c.last_action,
        last_action_at: c.last_action_at,
        activity_state: activity,
        funnel_stage: sub,
        number_of_orders: ordersCount,
        last_abandon_email_at: attributedAtMs ? new Date(attributedAtMs).toISOString() : null,
        attribution_method: match ? (match.byToken ? 'checkout_token' : 'time_window') : null,
        recovery_category: category,
        is_existing_customer: isExistingCustomer,
        abandon_notified_count: c.abandon_notified_count ?? 0,
      }
    })

    // Exclude pure organic conversions — they don't belong to the abandonment funnel.
    return enriched.filter((r) => r.recovery_category !== 'normal_conversion').slice(0, input.limit ?? 100)
  },
})
