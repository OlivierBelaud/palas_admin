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
// Enrichments:
//   1. Local `contacts` table — lifetime order count per customer
//      (orders_count + last_order_at), synced from Shopify by the V1 CRM.
//   2. klaviyo_events HogQL — last abandonment email per customer (+ its
//      checkout_token when extractable from checkout_url). The eventual
//      timestamp comes from Klaviyo, which is not mirrored locally.
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
  abandon_notified_at: Date | string | null
  abandon_notified_source: 'manta' | 'klaviyo' | null
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
  handler: async (input, { query, log: _log }) => {
    const days = input.days ?? 30
    const nowMs = Date.now()
    const cutoffMs = nowMs - days * 86400 * 1000

    // ── 1. Fetch identified carts (email present) within the window ─────
    // Server-side pagination: fetch exactly `limit` rows at `offset` plus a
    // count for the paginator. Over-fetch 5× to absorb `normal_conversion`
    // filtering downstream — completed orders share the same recent window
    // and routinely drop ~half the batch, leaving the page under-filled.
    const limit = input.limit ?? 100
    const fetchLimit = Math.min(Math.ceil(limit * 5), 500)
    const [carts, totalCount] = (await query.graphAndCount({
      entity: 'cart',
      filters: {
        email: { $notnull: true },
        last_action_at: { $gte: new Date(cutoffMs) },
      },
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
        'abandon_notified_at',
        'abandon_notified_source',
      ],
      sort: { last_action_at: 'desc' },
      pagination: { limit: fetchLimit, offset: input.offset },
    })) as unknown as [CartRow[], number]

    if (carts.length === 0) return { items: [], count: 0 }

    const windowed = carts
    const emails = Array.from(new Set(windowed.map((c) => c.email.toLowerCase())))
    if (emails.length === 0) return { items: [], count: totalCount }

    const orderCountByEmail = new Map<string, number>()
    // Per (email, checkout_token) → email timestamp. We store the MAX per
    // bucket so the attribution path can still fall back on a time-window
    // match when the checkout_token is null (email from Received Email flow).
    const emailEventsByEmail = new Map<string, EnrichedRow[]>()

    // ── 2a. Local `contacts` lookup — lifetime order count.
    //        Replaces the previous `shopify_customers` HogQL: contacts are
    //        kept in sync with Shopify by the V1 CRM (cart-tracking subscriber
    //        + the 5-min PostHog cron) so this is strictly fresher data with
    //        no synchronous DW round-trip. last_order_at is fetched alongside
    //        for future read paths but currently unused in the response.
    const contactRows = (await query.graph({
      entity: 'contact',
      filters: { email: { $in: emails } },
      fields: ['email', 'orders_count', 'last_order_at'],
      pagination: { limit: 10000 },
    })) as unknown as Array<{ email: string; orders_count: number | null; last_order_at: Date | string | null }>

    for (const row of contactRows) {
      const email = row.email?.toLowerCase()
      if (!email) continue
      orderCountByEmail.set(email, Number(row.orders_count ?? 0))
    }

    // ── 2b. Local `klaviyo_events` lookup — last abandonment email per customer.
    //        Mirrored from PostHog DW by the sync-klaviyo-events cron (hourly).
    //        No more synchronous HogQL roundtrip on the hot path.
    const klaviyoEventRows = (await query.graph({
      entity: 'klaviyoEvent',
      filters: { email: { $in: emails } },
      fields: ['email', 'occurred_at', 'checkout_token'],
      sort: { occurred_at: 'desc' },
      pagination: { limit: 20000 },
    })) as unknown as Array<{ email: string; occurred_at: Date | string; checkout_token: string | null }>

    for (const row of klaviyoEventRows) {
      const email = row.email?.toLowerCase()
      if (!email || !row.occurred_at) continue
      const sentAt = row.occurred_at instanceof Date ? row.occurred_at.toISOString() : String(row.occurred_at)
      const list = emailEventsByEmail.get(email) ?? []
      list.push({ email, last_at: sentAt, checkout_token: row.checkout_token ?? null })
      emailEventsByEmail.set(email, list)
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
        abandon_notified_at: c.abandon_notified_at
          ? c.abandon_notified_at instanceof Date
            ? c.abandon_notified_at.toISOString()
            : String(c.abandon_notified_at)
          : null,
        abandon_notified_source: c.abandon_notified_source ?? null,
      }
    })

    // Exclude pure organic conversions — they don't belong to the abandonment funnel.
    // Count includes them (acceptable approximation: ~5% overhead in the paginator's
    // last-page indicator). Slice to `limit` so the page never exceeds its size.
    const items = enriched.filter((r) => r.recovery_category !== 'normal_conversion').slice(0, limit)
    return { items, count: totalCount }
  },
})
