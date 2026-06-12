import { db, json, nowMs, requireAdmin, timingHeader, unauthorized } from './runtime.mjs'

const MS_PER_DAY = 86_400_000

export default {
  async fetch(req) {
    const started = nowMs()
    const auth = requireAdmin(req)
    if (!auth) return unauthorized()
    const authDone = nowMs()

    const url = new URL(req.url)
    const name = url.pathname.split('/').pop()
    const { from, to } = normalizeRange(url.searchParams)
    const days = buildDays(from, to)
    const rows = await loadRows(name, from, to, days)
    const done = nowMs()

    return json(
      {
        data: {
          rows,
          meta: {
            range: { from: from.toISOString(), to: to.toISOString() },
            granularity: 'day',
            xFormat: 'date',
          },
        },
      },
      {
        headers: {
          'server-timing': timingHeader({
            auth: authDone - started,
            query: done - authDone,
            total: done - started,
          }),
        },
      },
    )
  },
}

async function loadRows(name, from, to, days) {
  if (name === 'visitor-stats-carts-created-funnel') return await cartsCreated(from, to, days)
  if (name === 'visitor-stats-carts-updated-funnel') return await cartsUpdated(from, to, days)
  if (name === 'visitor-stats-identity-acquisitions') return await identityAcquisitions(from, to, days)
  if (name === 'visitor-stats-paid-vs-organic') return await paidVsOrganic(from, to, days)
  if (name === 'visitor-stats-unique-visitors-by-segment') return await uniqueVisitorsBySegment(from, to, days)
  return []
}

async function cartsCreated(from, to, days) {
  const rows = await db().unsafe(
    `SELECT to_char(date_trunc('day', coalesce(cart_birth_at, created_at)), 'YYYY-MM-DD') AS day,
            COUNT(*)::text AS carts_created,
            COUNT(*) FILTER (WHERE highest_stage = 'completed')::text AS carts_created_converted
       FROM carts
      WHERE deleted_at IS NULL
        AND (
          (cart_birth_at >= $1 AND cart_birth_at < $2)
          OR (cart_birth_at IS NULL AND created_at >= $1 AND created_at < $2)
        )
      GROUP BY 1`,
    [from.toISOString(), to.toISOString()],
  )
  const byDay = new Map(rows.map((row) => [row.day, row]))
  return days.map((day) => {
    const row = byDay.get(day)
    return {
      date: day,
      carts_created: number(row?.carts_created),
      carts_created_converted: number(row?.carts_created_converted),
    }
  })
}

async function cartsUpdated(from, to, days) {
  const rows = await db().unsafe(
    `SELECT to_char(date_trunc('day', started_at), 'YYYY-MM-DD') AS day,
            COALESCE(SUM(carts_updated_in_session), 0)::text AS carts_updated,
            COUNT(*) FILTER (WHERE carts_updated_in_session > 0 AND cart_converted = true)::text
              AS carts_updated_converted
       FROM visitor_sessions
      WHERE deleted_at IS NULL
        AND started_at >= $1
        AND started_at < $2
      GROUP BY 1`,
    [from.toISOString(), to.toISOString()],
  )
  const byDay = new Map(rows.map((row) => [row.day, row]))
  return days.map((day) => {
    const row = byDay.get(day)
    return {
      date: day,
      carts_updated: number(row?.carts_updated),
      carts_updated_converted: number(row?.carts_updated_converted),
    }
  })
}

async function identityAcquisitions(from, to, days) {
  const rows = await db().unsafe(
    `SELECT to_char(date_trunc('day', started_at), 'YYYY-MM-DD') AS day,
            COUNT(*) FILTER (WHERE email_acquired_via = 'newsletter')::text AS newsletter,
            COUNT(*) FILTER (WHERE email_acquired_via = 'checkout_started')::text AS checkout_started
       FROM visitor_sessions
      WHERE deleted_at IS NULL
        AND started_at >= $1
        AND started_at < $2
        AND email_acquired_in_session = true
      GROUP BY 1`,
    [from.toISOString(), to.toISOString()],
  )
  const byDay = new Map(rows.map((row) => [row.day, row]))
  return days.map((day) => {
    const row = byDay.get(day)
    return {
      date: day,
      newsletter: number(row?.newsletter),
      checkout_started: number(row?.checkout_started),
    }
  })
}

async function paidVsOrganic(from, to, days) {
  const rows = await db().unsafe(
    `SELECT to_char(date_trunc('day', started_at), 'YYYY-MM-DD') AS day,
            COUNT(*) FILTER (WHERE is_paid_session = true)::text AS paid,
            COUNT(*) FILTER (WHERE coalesce(is_paid_session, false) = false)::text AS organic
       FROM visitor_sessions
      WHERE deleted_at IS NULL
        AND started_at >= $1
        AND started_at < $2
      GROUP BY 1`,
    [from.toISOString(), to.toISOString()],
  )
  const byDay = new Map(rows.map((row) => [row.day, row]))
  return days.map((day) => {
    const row = byDay.get(day)
    return {
      date: day,
      paid: number(row?.paid),
      organic: number(row?.organic),
    }
  })
}

async function uniqueVisitorsBySegment(from, to, days) {
  const rows = await db().unsafe(
    `SELECT day,
            COUNT(DISTINCT distinct_id) FILTER (WHERE segment_at_session_start = 'unknown')::text AS unknown,
            COUNT(DISTINCT distinct_id) FILTER (WHERE segment_at_session_start = 'known_no_purchase')::text
              AS known_no_purchase,
            COUNT(DISTINCT distinct_id) FILTER (WHERE segment_at_session_start = 'returning_customer')::text
              AS returning_customer
       FROM (
         SELECT to_char(date_trunc('day', started_at), 'YYYY-MM-DD') AS day,
                distinct_id,
                segment_at_session_start
           FROM visitor_sessions
          WHERE deleted_at IS NULL
            AND started_at >= $1
            AND started_at < $2
            AND distinct_id IS NOT NULL
       ) s
      GROUP BY day`,
    [from.toISOString(), to.toISOString()],
  )
  const byDay = new Map(rows.map((row) => [row.day, row]))
  return days.map((day) => {
    const row = byDay.get(day)
    return {
      date: day,
      unknown: number(row?.unknown),
      known_no_purchase: number(row?.known_no_purchase),
      returning_customer: number(row?.returning_customer),
    }
  })
}

function normalizeRange(params) {
  const to = params.get('to') ? new Date(params.get('to')) : new Date()
  const from = params.get('from') ? new Date(params.get('from')) : new Date(to.getTime() - 30 * MS_PER_DAY)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    const fallbackTo = new Date()
    return { from: new Date(fallbackTo.getTime() - 30 * MS_PER_DAY), to: fallbackTo }
  }
  return { from, to }
}

function buildDays(from, to) {
  const days = []
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  for (let t = start; t < to.getTime(); t += MS_PER_DAY) {
    days.push(new Date(t).toISOString().slice(0, 10))
  }
  return days
}

function number(value) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}
