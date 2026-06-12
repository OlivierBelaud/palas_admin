import { db, json, nowMs, rate, requireAdmin, roundMoney, timingHeader, toNumber, unauthorized } from './runtime.mjs'

const AUDIENCES = [
  { key: 'unknown', label: 'Suspects' },
  { key: 'known_no_purchase', label: 'Prospects' },
  { key: 'returning_customer', label: 'Clients' },
]

export default {
  async fetch(req) {
    const started = nowMs()
    const auth = requireAdmin(req)
    if (!auth) return unauthorized()
    const authDone = nowMs()

    const url = new URL(req.url)
    const from = new Date(url.searchParams.get('from') ?? '')
    const to = new Date(url.searchParams.get('to') ?? '')
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return json({ type: 'INVALID_DATA', message: 'Invalid range' }, { status: 400 })
    }

    const expectedDays = buildDays(from, to)
    const [factBundle, orders] = await Promise.all([loadFactBundle(from, to, expectedDays), loadOrders(from, to)])
    const cacheDone = nowMs()
    const canUseFacts =
      factBundle &&
      expectedDays.every((day) => factBundle.coveredDays.has(day)) &&
      factBundle.facts.length > 0 &&
      factBundle.facts.length >= factBundle.expectedFacts
    const sessions = canUseFacts ? [] : await loadSessions(from, to)
    const loadDone = nowMs()

    const orderByShopifyId = new Map()
    for (const order of orders) {
      if (order.shopify_order_id) orderByShopifyId.set(order.shopify_order_id, order)
    }

    const actors = canUseFacts
      ? buildActorAggregatesFromFacts(factBundle.facts)
      : buildActorAggregatesFromSessions(sessions)
    const totalSessions = canUseFacts
      ? factBundle.facts.reduce((sum, fact) => sum + toNumber(fact.sessions), 0)
      : sessions.length
    const totalVisitors = actors.length
    const audience = buildAudienceBuckets(actors, orderByShopifyId, totalVisitors)
    const daily = canUseFacts
      ? buildDailyBucketsFromFacts(factBundle.facts, orders, from, to)
      : buildDailyBucketsFromSessions(sessions, orders, from, to)
    const totalOrders = orders.length
    const revenue = roundMoney(orders.reduce((sum, order) => sum + toNumber(order.total_price), 0))
    const convertedVisitors = actors.filter((actor) => actor.converted).length
    const convertedSessions = canUseFacts
      ? actors.reduce((sum, actor) => sum + actor.converted_sessions, 0)
      : sessions.filter((session) => session.cart_converted === true).length
    const becameKnown = actors.filter((actor) => actor.became_known).length
    const becameCustomer = actors.filter((actor) => actor.became_customer).length
    const cartViewedVisitors = actors.filter((actor) => actor.cart_viewed).length
    const cartInitiatedVisitors = actors.filter((actor) => actor.cart_initiated).length
    const cartUpdatedVisitors = actors.filter((actor) => actor.cart_updated).length
    const dataQuality = canUseFacts
      ? buildDataQualityFromFacts(factBundle.facts, orderByShopifyId, becameKnown)
      : buildDataQualityFromSessions(sessions, orderByShopifyId, becameKnown)

    const data = {
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
        visitor_conversion_rate: pct(convertedVisitors, totalVisitors),
        converted_sessions: convertedSessions,
        conversion_rate: pct(convertedSessions, totalSessions),
        became_known: becameKnown,
        became_known_rate: pct(becameKnown, totalVisitors),
        became_customer: becameCustomer,
        became_customer_rate: pct(becameCustomer, totalVisitors),
        cart_viewed_visitors: cartViewedVisitors,
        cart_view_rate: pct(cartViewedVisitors, totalVisitors),
        cart_initiated_visitors: cartInitiatedVisitors,
        cart_initiation_rate: pct(cartInitiatedVisitors, totalVisitors),
        cart_updated_visitors: cartUpdatedVisitors,
        cart_update_rate: pct(cartUpdatedVisitors, totalVisitors),
      },
      audience,
      daily,
      flow: buildFlow(audience),
      data_quality: dataQuality,
    }
    const done = nowMs()

    return json(
      { data },
      {
        headers: {
          'server-timing': timingHeader({
            auth: authDone - started,
            cache: cacheDone - authDone,
            load: loadDone - cacheDone,
            serialize: done - loadDone,
            total: done - started,
          }),
        },
      },
    )
  },
}

async function loadFactBundle(from, to, expectedDays) {
  const fromDay = dayKey(from)
  const toDay = dayKey(to)
  const [facts, snapshots] = await Promise.all([
    db().unsafe(
      `SELECT day, actor_key, first_started_at, segment_at_day_start, sessions, cart_viewed,
              cart_initiated, cart_updated, converted, converted_sessions, became_known,
              became_customer, known_without_contact, converted_without_order_id,
              became_customer_without_contact, order_ids
         FROM visitor_lifecycle_actor_daily_facts
        WHERE deleted_at IS NULL
          AND day >= $1
          AND day <= $2
        ORDER BY first_started_at ASC`,
      [fromDay, toDay],
    ),
    db().unsafe(
      `SELECT day, sessions_count, facts_count
         FROM visitor_lifecycle_day_snapshots
        WHERE deleted_at IS NULL
          AND day >= $1
          AND day <= $2
          AND status = 'ready'`,
      [fromDay, toDay],
    ),
  ]).catch(() => [[], []])
  if (snapshots.length === 0) return null
  return {
    facts,
    coveredDays: new Set(snapshots.map((row) => row.day)),
    expectedFacts: snapshots.reduce((sum, row) => sum + toNumber(row.facts_count), 0),
    expectedSessions: snapshots.reduce((sum, row) => sum + toNumber(row.sessions_count), 0),
    expectedDays,
  }
}

function loadOrders(from, to) {
  return db().unsafe(
    `SELECT id, shopify_order_id, total_price, placed_at, include_in_ecommerce_analytics
       FROM orders
      WHERE deleted_at IS NULL
        AND include_in_ecommerce_analytics = true
        AND placed_at >= $1
        AND placed_at < $2`,
    [from.toISOString(), to.toISOString()],
  )
}

function loadSessions(from, to) {
  return db().unsafe(
    `SELECT id, distinct_id, started_at, segment_at_session_start, contact_id,
            carts_viewed_in_session, carts_created_in_session, carts_updated_in_session,
            cart_converted, order_id, became_customer_in_session, email_acquired_in_session,
            email_acquired_via, is_paid_session
       FROM visitor_sessions
      WHERE deleted_at IS NULL
        AND started_at >= $1
        AND started_at < $2
      ORDER BY started_at ASC
      LIMIT 150000`,
    [from.toISOString(), to.toISOString()],
  )
}

function buildActorAggregatesFromFacts(facts) {
  const actors = new Map()
  for (const fact of [...facts].sort((a, b) => toMs(a.first_started_at) - toMs(b.first_started_at))) {
    let actor = actors.get(fact.actor_key)
    if (!actor) {
      actor = baseActor(fact.actor_key, fact.first_started_at, fact.segment_at_day_start)
      actors.set(fact.actor_key, actor)
    }
    actor.sessions += toNumber(fact.sessions)
    actor.cart_viewed ||= fact.cart_viewed === true
    actor.cart_initiated ||= fact.cart_initiated === true
    actor.cart_updated ||= fact.cart_updated === true
    actor.converted ||= fact.converted === true
    actor.converted_sessions += toNumber(fact.converted_sessions)
    actor.became_known ||= fact.became_known === true
    actor.became_customer ||= fact.became_customer === true
    actor.known_without_contact ||= fact.known_without_contact === true
    actor.converted_without_order_id ||= fact.converted_without_order_id === true
    actor.became_customer_without_contact ||= fact.became_customer_without_contact === true
    for (const orderId of normalizeOrderIds(fact.order_ids)) actor.order_ids.add(orderId)
  }
  return [...actors.values()]
}

function buildActorAggregatesFromSessions(sessions) {
  const actors = new Map()
  for (const session of [...sessions].sort((a, b) => toMs(a.started_at) - toMs(b.started_at))) {
    const key = session.distinct_id
    let actor = actors.get(key)
    if (!actor) {
      actor = baseActor(key, session.started_at, session.segment_at_session_start)
      actors.set(key, actor)
    }
    actor.sessions += 1
    actor.cart_viewed ||= toNumber(session.carts_viewed_in_session) > 0
    actor.cart_initiated ||= toNumber(session.carts_created_in_session) > 0
    actor.cart_updated ||= toNumber(session.carts_updated_in_session) > 0
    actor.converted ||= session.cart_converted === true
    if (session.cart_converted === true) actor.converted_sessions += 1
    actor.became_known ||= session.email_acquired_in_session === true
    actor.became_customer ||= session.became_customer_in_session === true
    actor.known_without_contact ||= session.contact_id == null && session.segment_at_session_start !== 'unknown'
    actor.converted_without_order_id ||= session.cart_converted === true && !session.order_id
    actor.became_customer_without_contact ||= session.became_customer_in_session === true && !session.contact_id
    if (session.order_id) actor.order_ids.add(session.order_id)
  }
  return [...actors.values()]
}

function baseActor(key, firstStartedAt, segment) {
  return {
    key,
    first_started_at: toMs(firstStartedAt),
    segment,
    sessions: 0,
    cart_viewed: false,
    cart_initiated: false,
    cart_updated: false,
    converted: false,
    converted_sessions: 0,
    became_known: false,
    became_customer: false,
    known_without_contact: false,
    converted_without_order_id: false,
    became_customer_without_contact: false,
    order_ids: new Set(),
  }
}

function buildAudienceBuckets(actors, orderByShopifyId, totalVisitors) {
  return AUDIENCES.map(({ key, label }) => {
    const rows = actors.filter((actor) => actor.segment === key)
    const orderIds = new Set()
    for (const actor of rows) {
      for (const orderId of actor.order_ids) {
        if (orderByShopifyId.has(orderId)) orderIds.add(orderId)
      }
    }
    const orders = orderIds.size
    const revenue = roundMoney(
      [...orderIds].reduce((sum, orderId) => sum + toNumber(orderByShopifyId.get(orderId)?.total_price), 0),
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
      share: pct(rows.length, totalVisitors),
      sessions_per_visitor: rows.length > 0 ? Math.round((sessions / rows.length) * 100) / 100 : 0,
      cart_viewed_visitors: cartViewed,
      cart_view_rate: pct(cartViewed, rows.length),
      cart_initiated_visitors: cartInitiated,
      cart_initiation_rate: pct(cartInitiated, rows.length),
      cart_updated_visitors: cartUpdated,
      cart_update_rate: pct(cartUpdated, rows.length),
      converted_visitors: converted,
      conversion_rate: pct(converted, rows.length),
      became_known: becameKnown,
      became_customer: becameCustomer,
      orders,
      revenue,
      aov: orders > 0 ? roundMoney(revenue / orders) : 0,
    }
  })
}

function buildDailyBucketsFromFacts(facts, orders, from, to) {
  const ctx = emptyDailyContext(from, to)
  for (const fact of facts) {
    const bucket = ctx.buckets.get(fact.day)
    if (!bucket) continue
    bucket.sessions += toNumber(fact.sessions)
    bucket.converted_sessions += toNumber(fact.converted_sessions)
    ctx.actorSets.get(fact.day)?.[fact.segment_at_day_start]?.add(fact.actor_key)
    if (fact.became_known) ctx.becameKnown.get(fact.day)?.add(fact.actor_key)
    if (fact.became_customer) ctx.becameCustomer.get(fact.day)?.add(fact.actor_key)
    if (fact.converted) ctx.converted.get(fact.day)?.add(fact.actor_key)
  }
  return finalizeDaily(ctx, orders)
}

function buildDailyBucketsFromSessions(sessions, orders, from, to) {
  const ctx = emptyDailyContext(from, to)
  for (const session of sessions) {
    const day = dayKey(session.started_at)
    const bucket = ctx.buckets.get(day)
    if (!bucket) continue
    const actor = session.distinct_id
    bucket.sessions += 1
    ctx.actorSets.get(day)?.[session.segment_at_session_start]?.add(actor)
    if (session.email_acquired_in_session) ctx.becameKnown.get(day)?.add(actor)
    if (session.became_customer_in_session) ctx.becameCustomer.get(day)?.add(actor)
    if (session.cart_converted) ctx.converted.get(day)?.add(actor)
    if (session.cart_converted) bucket.converted_sessions += 1
  }
  return finalizeDaily(ctx, orders)
}

function emptyDailyContext(from, to) {
  const buckets = new Map()
  const actorSets = new Map()
  const converted = new Map()
  const becameKnown = new Map()
  const becameCustomer = new Map()
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
    converted.set(day, new Set())
    becameKnown.set(day, new Set())
    becameCustomer.set(day, new Set())
  }
  return { buckets, actorSets, converted, becameKnown, becameCustomer }
}

function finalizeDaily(ctx, orders) {
  for (const order of orders) {
    if (!order.placed_at) continue
    const bucket = ctx.buckets.get(dayKey(order.placed_at))
    if (!bucket) continue
    bucket.orders += 1
    bucket.revenue = roundMoney(bucket.revenue + toNumber(order.total_price))
  }
  for (const bucket of ctx.buckets.values()) {
    const actors = ctx.actorSets.get(bucket.date)
    bucket.unknown = actors?.unknown.size ?? 0
    bucket.known_no_purchase = actors?.known_no_purchase.size ?? 0
    bucket.returning_customer = actors?.returning_customer.size ?? 0
    bucket.visitors = bucket.unknown + bucket.known_no_purchase + bucket.returning_customer
    bucket.became_known = ctx.becameKnown.get(bucket.date)?.size ?? 0
    bucket.became_customer = ctx.becameCustomer.get(bucket.date)?.size ?? 0
    bucket.converted_visitors = ctx.converted.get(bucket.date)?.size ?? 0
    bucket.conversion_rate = pct(bucket.converted_visitors, bucket.visitors)
  }
  return [...ctx.buckets.values()]
}

function buildDataQualityFromFacts(facts, orderByShopifyId, becameKnown) {
  return {
    sessions_without_contact_but_known_segment: facts.filter((fact) => fact.known_without_contact === true).length,
    converted_sessions_without_order_id: facts.filter((fact) => fact.converted_without_order_id === true).length,
    converted_sessions_without_matching_order: facts.filter((fact) =>
      normalizeOrderIds(fact.order_ids).some((orderId) => !orderByShopifyId.has(orderId)),
    ).length,
    became_customer_sessions_without_contact: facts.filter((fact) => fact.became_customer_without_contact === true)
      .length,
    known_transitions: becameKnown,
  }
}

function buildDataQualityFromSessions(sessions, orderByShopifyId, becameKnown) {
  return {
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
}

function buildFlow(audience) {
  const unknown = audience.find((row) => row.key === 'unknown')
  const known = audience.find((row) => row.key === 'known_no_purchase')
  const returning = audience.find((row) => row.key === 'returning_customer')
  return [
    { from: 'Suspects', to: 'Deviennent prospects', value: unknown?.became_known ?? 0 },
    { from: 'Suspects', to: 'Deviennent clients', value: unknown?.became_customer ?? 0 },
    { from: 'Prospects', to: 'Deviennent clients', value: known?.became_customer ?? 0 },
    { from: 'Clients', to: 'Réachètent', value: returning?.converted_visitors ?? 0 },
  ]
}

function normalizeOrderIds(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.filter(Boolean)
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter(Boolean) : []
  } catch {
    return []
  }
}

function buildDays(from, to) {
  const days = []
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  for (let t = start; t <= to.getTime(); t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10))
  return days
}

function dayKey(input) {
  return new Date(input).toISOString().slice(0, 10)
}

function toMs(input) {
  return new Date(input).getTime()
}

function pct(part, total) {
  return rate(part, total) * 100
}
