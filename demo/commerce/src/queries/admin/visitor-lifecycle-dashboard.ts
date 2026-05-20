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
  visitors: number
  sessions: number
  share: number
  sessions_per_visitor: number
  cart_viewed_visitors: number
  cart_view_rate: number
  cart_initiated_visitors: number
  cart_initiation_rate: number
  cart_updated_visitors: number
  cart_update_rate: number
  converted_visitors: number
  conversion_rate: number
  became_known: number
  became_customer: number
  orders: number
  revenue: number
  aov: number
}

interface DayBucket {
  date: string
  visitors: number
  sessions: number
  unknown: number
  known_no_purchase: number
  returning_customer: number
  became_known: number
  became_customer: number
  converted_visitors: number
  converted_sessions: number
  orders: number
  revenue: number
  conversion_rate: number
}

interface ActorAggregate {
  key: string
  first_started_at: number
  segment: Segment
  sessions: number
  cart_viewed: boolean
  cart_initiated: boolean
  cart_updated: boolean
  converted: boolean
  became_known: boolean
  became_customer: boolean
  order_ids: Set<string>
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
    const actors = buildActorAggregates(sessions)
    const totalVisitors = actors.length
    const audience = buildAudienceBuckets(actors, orderByShopifyId, totalVisitors)
    const daily = buildDailyBuckets(sessions, ecommerceOrders, from, to)
    const totalOrders = ecommerceOrders.length
    const revenue = roundMoney(ecommerceOrders.reduce((sum, order) => sum + money(order.total_price), 0))
    const convertedVisitors = actors.filter((actor) => actor.converted).length
    const convertedSessions = sessions.filter((session) => session.cart_converted === true).length
    const becameKnown = actors.filter((actor) => actor.became_known).length
    const becameCustomer = actors.filter((actor) => actor.became_customer).length
    const cartViewedVisitors = actors.filter((actor) => actor.cart_viewed).length
    const cartInitiatedVisitors = actors.filter((actor) => actor.cart_initiated).length
    const cartUpdatedVisitors = actors.filter((actor) => actor.cart_updated).length

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
        unique_visitors: totalVisitors,
        sessions: totalSessions,
        sessions_per_visitor: totalVisitors > 0 ? Math.round((totalSessions / totalVisitors) * 100) / 100 : 0,
        orders: totalOrders,
        revenue,
        aov: totalOrders > 0 ? roundMoney(revenue / totalOrders) : 0,
        converted_visitors: convertedVisitors,
        visitor_conversion_rate: rate(convertedVisitors, totalVisitors),
        converted_sessions: convertedSessions,
        conversion_rate: rate(convertedSessions, totalSessions),
        became_known: becameKnown,
        became_known_rate: rate(becameKnown, totalVisitors),
        became_customer: becameCustomer,
        became_customer_rate: rate(becameCustomer, totalVisitors),
        cart_viewed_visitors: cartViewedVisitors,
        cart_view_rate: rate(cartViewedVisitors, totalVisitors),
        cart_initiated_visitors: cartInitiatedVisitors,
        cart_initiation_rate: rate(cartInitiatedVisitors, totalVisitors),
        cart_updated_visitors: cartUpdatedVisitors,
        cart_update_rate: rate(cartUpdatedVisitors, totalVisitors),
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

function buildActorAggregates(sessions: SessionRow[]): ActorAggregate[] {
  const actors = new Map<string, ActorAggregate>()
  const sorted = [...sessions].sort((a, b) => toMs(a.started_at) - toMs(b.started_at))

  for (const session of sorted) {
    const key = actorKey(session)
    let actor = actors.get(key)
    if (!actor) {
      actor = {
        key,
        first_started_at: toMs(session.started_at),
        segment: session.segment_at_session_start,
        sessions: 0,
        cart_viewed: false,
        cart_initiated: false,
        cart_updated: false,
        converted: false,
        became_known: false,
        became_customer: false,
        order_ids: new Set<string>(),
      }
      actors.set(key, actor)
    }

    actor.sessions += 1
    actor.cart_viewed ||= count(session.carts_viewed_in_session) > 0
    actor.cart_initiated ||= count(session.carts_created_in_session) > 0
    actor.cart_updated ||= count(session.carts_updated_in_session) > 0
    actor.converted ||= session.cart_converted === true
    actor.became_known ||= session.email_acquired_in_session === true
    actor.became_customer ||= session.became_customer_in_session === true
    if (session.order_id) actor.order_ids.add(session.order_id)
  }

  return [...actors.values()]
}

function buildAudienceBuckets(
  actors: ActorAggregate[],
  orderByShopifyId: Map<string, OrderRow>,
  totalVisitors: number,
): AudienceBucket[] {
  return AUDIENCES.map(({ key, label }) => {
    const rows = actors.filter((actor) => actor.segment === key)
    const orderIds = new Set<string>()
    for (const actor of rows) {
      for (const orderId of actor.order_ids) {
        if (orderByShopifyId.has(orderId)) orderIds.add(orderId)
      }
    }
    const orders = orderIds.size
    const revenue = roundMoney(
      [...orderIds].reduce((sum, orderId) => {
        const order = orderByShopifyId.get(orderId)
        return sum + money(order?.total_price ?? null)
      }, 0),
    )
    const sessions = rows.reduce((sum, actor) => sum + actor.sessions, 0)
    const cartViewed = rows.filter((actor) => actor.cart_viewed).length
    const cartInitiated = rows.filter((actor) => actor.cart_initiated).length
    const cartUpdated = rows.filter((actor) => actor.cart_updated).length
    const converted = rows.filter((actor) => actor.converted).length
    const becameKnown = rows.filter((actor) => actor.became_known).length
    const becameCustomer = rows.filter((actor) => actor.became_customer).length

    return {
      key,
      label,
      visitors: rows.length,
      sessions,
      share: rate(rows.length, totalVisitors),
      sessions_per_visitor: rows.length > 0 ? Math.round((sessions / rows.length) * 100) / 100 : 0,
      cart_viewed_visitors: cartViewed,
      cart_view_rate: rate(cartViewed, rows.length),
      cart_initiated_visitors: cartInitiated,
      cart_initiation_rate: rate(cartInitiated, rows.length),
      cart_updated_visitors: cartUpdated,
      cart_update_rate: rate(cartUpdated, rows.length),
      converted_visitors: converted,
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
  const actorSets = new Map<string, Record<Segment, Set<string>>>()
  const convertedActorSets = new Map<string, Set<string>>()
  const becameKnownActorSets = new Map<string, Set<string>>()
  const becameCustomerActorSets = new Map<string, Set<string>>()
  for (const day of buildDays(from, to)) {
    buckets.set(day, {
      date: day,
      visitors: 0,
      sessions: 0,
      unknown: 0,
      known_no_purchase: 0,
      returning_customer: 0,
      became_known: 0,
      became_customer: 0,
      converted_visitors: 0,
      converted_sessions: 0,
      orders: 0,
      revenue: 0,
      conversion_rate: 0,
    })
    actorSets.set(day, { unknown: new Set(), known_no_purchase: new Set(), returning_customer: new Set() })
    convertedActorSets.set(day, new Set())
    becameKnownActorSets.set(day, new Set())
    becameCustomerActorSets.set(day, new Set())
  }

  for (const session of sessions) {
    const day = dayKey(session.started_at)
    const bucket = buckets.get(day)
    if (!bucket) continue
    const actor = actorKey(session)
    bucket.sessions += 1
    actorSets.get(day)?.[session.segment_at_session_start].add(actor)
    if (session.email_acquired_in_session) becameKnownActorSets.get(day)?.add(actor)
    if (session.became_customer_in_session) becameCustomerActorSets.get(day)?.add(actor)
    if (session.cart_converted) convertedActorSets.get(day)?.add(actor)
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
    const actors = actorSets.get(bucket.date)
    bucket.unknown = actors?.unknown.size ?? 0
    bucket.known_no_purchase = actors?.known_no_purchase.size ?? 0
    bucket.returning_customer = actors?.returning_customer.size ?? 0
    bucket.visitors = bucket.unknown + bucket.known_no_purchase + bucket.returning_customer
    bucket.became_known = becameKnownActorSets.get(bucket.date)?.size ?? 0
    bucket.became_customer = becameCustomerActorSets.get(bucket.date)?.size ?? 0
    bucket.converted_visitors = convertedActorSets.get(bucket.date)?.size ?? 0
    bucket.conversion_rate = rate(bucket.converted_visitors, bucket.visitors)
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
    { from: 'Clients existants', to: 'Réachètent', value: returning?.converted_visitors ?? 0 },
  ]
}

function actorKey(session: SessionRow): string {
  return session.contact_id ? `contact:${session.contact_id}` : `distinct:${session.distinct_id}`
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

function toMs(input: Date | string): number {
  return input instanceof Date ? input.getTime() : new Date(input).getTime()
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
