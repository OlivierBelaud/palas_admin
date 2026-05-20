type Segment = 'unknown' | 'known_no_purchase' | 'returning_customer'

interface SessionRow {
  id: string
  distinct_id: string
  started_at: Date | string
  segment_at_session_start: Segment
  contact_id: string | null
  carts_viewed_in_session?: number | null
  carts_created_in_session: number | null
  carts_updated_in_session: number | null
  cart_converted: boolean | null
  order_id: string | null
  became_customer_in_session?: boolean | null
  email_acquired_in_session: boolean | null
  email_acquired_via: 'newsletter' | 'checkout_started' | null
  is_paid_session: boolean | null
}

interface OrderRow {
  id: string
  shopify_order_id: string | null
  total_price: number | string | null
  placed_at: Date | string | null
  include_in_ecommerce_analytics: boolean | null
}

interface AudienceBucket {
  key: Segment
  label: string
  sessions: number
  share: number
  cart_viewed_sessions: number
  cart_view_rate: number
  cart_initiated_sessions: number
  cart_initiation_rate: number
  cart_updated_sessions: number
  cart_update_rate: number
  converted_sessions: number
  conversion_rate: number
  became_known: number
  became_customer: number
  orders: number
  revenue: number
  aov: number
}

interface DayBucket {
  date: string
  sessions: number
  unknown: number
  known_no_purchase: number
  returning_customer: number
  became_known: number
  became_customer: number
  converted_sessions: number
  orders: number
  revenue: number
  conversion_rate: number
}

const AUDIENCES: Array<{ key: Segment; label: string }> = [
  { key: 'unknown', label: 'Inconnus' },
  { key: 'known_no_purchase', label: 'Connus non-clients' },
  { key: 'returning_customer', label: 'Clients existants' },
]

export default defineQuery({
  name: 'visitor-lifecycle-dashboard',
  description: 'Visitor lifecycle dashboard aggregates: audience transitions, cart funnel, conversions, and revenue.',
  input: z.object({
    from: z.string(),
    to: z.string(),
  }),
  handler: async (input, { query, log }) => {
    const from = new Date(input.from)
    const to = new Date(input.to)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new MantaError(
        'INVALID_DATA',
        `visitor-lifecycle-dashboard: invalid range from=${input.from} to=${input.to}`,
      )
    }

    const [sessions, orders] = await Promise.all([
      pullAll<SessionRow>(
        (pagination) =>
          query.graph({
            entity: 'visitorSession',
            fields: [
              'id',
              'distinct_id',
              'started_at',
              'segment_at_session_start',
              'contact_id',
              'carts_viewed_in_session',
              'carts_created_in_session',
              'carts_updated_in_session',
              'cart_converted',
              'order_id',
              'became_customer_in_session',
              'email_acquired_in_session',
              'email_acquired_via',
              'is_paid_session',
            ],
            filters: { started_at: { $gte: from.toISOString(), $lt: to.toISOString() } },
            pagination,
          }) as unknown as Promise<SessionRow[]>,
      ).catch((err) => {
        log.warn(`[visitor-lifecycle-dashboard] sessions: ${(err as Error).message}`)
        return [] as SessionRow[]
      }),
      pullAll<OrderRow>(
        (pagination) =>
          query.graph({
            entity: 'order',
            fields: ['id', 'shopify_order_id', 'total_price', 'placed_at', 'include_in_ecommerce_analytics'],
            filters: {
              include_in_ecommerce_analytics: true,
              placed_at: { $gte: from.toISOString(), $lt: to.toISOString() },
            },
            pagination,
          }) as unknown as Promise<OrderRow[]>,
      ).catch((err) => {
        log.warn(`[visitor-lifecycle-dashboard] orders: ${(err as Error).message}`)
        return [] as OrderRow[]
      }),
    ])

    const ecommerceOrders = orders.filter((order) => order.include_in_ecommerce_analytics === true)
    const orderByShopifyId = new Map<string, OrderRow>()
    for (const order of ecommerceOrders) {
      if (order.shopify_order_id) orderByShopifyId.set(order.shopify_order_id, order)
    }

    const totalSessions = sessions.length
    const audience = buildAudienceBuckets(sessions, orderByShopifyId, totalSessions)
    const daily = buildDailyBuckets(sessions, ecommerceOrders, from, to)
    const totalOrders = ecommerceOrders.length
    const revenue = roundMoney(ecommerceOrders.reduce((sum, order) => sum + money(order.total_price), 0))
    const convertedSessions = sessions.filter((session) => session.cart_converted === true).length
    const becameKnown = sessions.filter((session) => session.email_acquired_in_session === true).length
    const becameCustomer = sessions.filter((session) => session.became_customer_in_session === true).length
    const cartViewedSessions = sessions.filter((session) => count(session.carts_viewed_in_session) > 0).length
    const cartInitiatedSessions = sessions.filter((session) => count(session.carts_created_in_session) > 0).length
    const cartUpdatedSessions = sessions.filter((session) => count(session.carts_updated_in_session) > 0).length

    const dataQuality = {
      sessions_without_contact_but_known_segment: sessions.filter(
        (session) => session.contact_id == null && session.segment_at_session_start !== 'unknown',
      ).length,
      converted_sessions_without_order_id: sessions.filter(
        (session) => session.cart_converted === true && !session.order_id,
      ).length,
      converted_sessions_without_matching_order: sessions.filter(
        (session) => session.cart_converted === true && session.order_id && !orderByShopifyId.has(session.order_id),
      ).length,
      became_customer_sessions_without_contact: sessions.filter(
        (session) => session.became_customer_in_session === true && !session.contact_id,
      ).length,
      known_transitions: becameKnown,
    }

    return {
      meta: {
        range: { from: from.toISOString(), to: to.toISOString() },
        generated_at: new Date().toISOString(),
      },
      kpis: {
        sessions: totalSessions,
        orders: totalOrders,
        revenue,
        aov: totalOrders > 0 ? roundMoney(revenue / totalOrders) : 0,
        converted_sessions: convertedSessions,
        conversion_rate: rate(convertedSessions, totalSessions),
        became_known: becameKnown,
        became_known_rate: rate(becameKnown, totalSessions),
        became_customer: becameCustomer,
        became_customer_rate: rate(becameCustomer, totalSessions),
        cart_viewed_sessions: cartViewedSessions,
        cart_view_rate: rate(cartViewedSessions, totalSessions),
        cart_initiated_sessions: cartInitiatedSessions,
        cart_initiation_rate: rate(cartInitiatedSessions, totalSessions),
        cart_updated_sessions: cartUpdatedSessions,
        cart_update_rate: rate(cartUpdatedSessions, totalSessions),
      },
      audience,
      daily,
      flow: buildFlow(audience),
      data_quality: dataQuality,
    }
  },
})

async function pullAll<T>(
  loadPage: (pagination: { take: number; skip: number; limit: number; offset: number }) => Promise<T[]>,
): Promise<T[]> {
  const PAGE = 5000
  const HARD_CAP = 150_000
  const rows: T[] = []
  for (let offset = 0; offset < HARD_CAP; offset += PAGE) {
    const page = await loadPage({ take: PAGE, skip: offset, limit: PAGE, offset })
    if (!Array.isArray(page) || page.length === 0) break
    rows.push(...page)
    if (page.length < PAGE) break
  }
  return rows
}

function buildAudienceBuckets(
  sessions: SessionRow[],
  orderByShopifyId: Map<string, OrderRow>,
  totalSessions: number,
): AudienceBucket[] {
  return AUDIENCES.map(({ key, label }) => {
    const rows = sessions.filter((session) => session.segment_at_session_start === key)
    const orders = rows.filter((session) => session.order_id && orderByShopifyId.has(session.order_id)).length
    const revenue = roundMoney(
      rows.reduce((sum, session) => {
        const order = session.order_id ? orderByShopifyId.get(session.order_id) : undefined
        return sum + money(order?.total_price ?? null)
      }, 0),
    )
    const cartViewed = rows.filter((session) => count(session.carts_viewed_in_session) > 0).length
    const cartInitiated = rows.filter((session) => count(session.carts_created_in_session) > 0).length
    const cartUpdated = rows.filter((session) => count(session.carts_updated_in_session) > 0).length
    const converted = rows.filter((session) => session.cart_converted === true).length
    const becameKnown = rows.filter((session) => session.email_acquired_in_session === true).length
    const becameCustomer = rows.filter((session) => session.became_customer_in_session === true).length

    return {
      key,
      label,
      sessions: rows.length,
      share: rate(rows.length, totalSessions),
      cart_viewed_sessions: cartViewed,
      cart_view_rate: rate(cartViewed, rows.length),
      cart_initiated_sessions: cartInitiated,
      cart_initiation_rate: rate(cartInitiated, rows.length),
      cart_updated_sessions: cartUpdated,
      cart_update_rate: rate(cartUpdated, rows.length),
      converted_sessions: converted,
      conversion_rate: rate(converted, rows.length),
      became_known: becameKnown,
      became_customer: becameCustomer,
      orders,
      revenue,
      aov: orders > 0 ? roundMoney(revenue / orders) : 0,
    }
  })
}

function buildDailyBuckets(sessions: SessionRow[], orders: OrderRow[], from: Date, to: Date): DayBucket[] {
  const buckets = new Map<string, DayBucket>()
  for (const day of buildDays(from, to)) {
    buckets.set(day, {
      date: day,
      sessions: 0,
      unknown: 0,
      known_no_purchase: 0,
      returning_customer: 0,
      became_known: 0,
      became_customer: 0,
      converted_sessions: 0,
      orders: 0,
      revenue: 0,
      conversion_rate: 0,
    })
  }

  for (const session of sessions) {
    const day = dayKey(session.started_at)
    const bucket = buckets.get(day)
    if (!bucket) continue
    bucket.sessions += 1
    bucket[session.segment_at_session_start] += 1
    if (session.email_acquired_in_session) bucket.became_known += 1
    if (session.became_customer_in_session) bucket.became_customer += 1
    if (session.cart_converted) bucket.converted_sessions += 1
  }

  for (const order of orders) {
    if (!order.placed_at) continue
    const day = dayKey(order.placed_at)
    const bucket = buckets.get(day)
    if (!bucket) continue
    bucket.orders += 1
    bucket.revenue = roundMoney(bucket.revenue + money(order.total_price))
  }

  for (const bucket of buckets.values()) {
    bucket.conversion_rate = rate(bucket.converted_sessions, bucket.sessions)
  }
  return Array.from(buckets.values())
}

function buildFlow(audience: AudienceBucket[]) {
  const unknown = audience.find((row) => row.key === 'unknown')
  const known = audience.find((row) => row.key === 'known_no_purchase')
  const returning = audience.find((row) => row.key === 'returning_customer')
  return [
    { from: 'Inconnus', to: 'Deviennent connus', value: unknown?.became_known ?? 0 },
    { from: 'Inconnus', to: 'Deviennent clients', value: unknown?.became_customer ?? 0 },
    { from: 'Connus non-clients', to: 'Deviennent clients', value: known?.became_customer ?? 0 },
    { from: 'Clients existants', to: 'Réachètent', value: returning?.converted_sessions ?? 0 },
  ]
}

function buildDays(from: Date, to: Date): string[] {
  const days: string[] = []
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  const end = to.getTime()
  for (let t = start; t <= end; t += 86_400_000) {
    days.push(dayKey(new Date(t)))
  }
  return days
}

function dayKey(input: Date | string): string {
  const d = input instanceof Date ? input : new Date(input)
  return d.toISOString().slice(0, 10)
}

function count(value: number | null | undefined): number {
  return Number(value ?? 0)
}

function money(value: number | string | null | undefined): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function rate(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 10_000) / 100 : 0
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}
