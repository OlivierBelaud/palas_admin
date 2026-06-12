#!/usr/bin/env node

// Read-only audit: compare raw PostHog sessions with local CRM materialized
// visitor_sessions for a date range. This script never writes to PostHog or DB.
//
// Usage:
//   node scripts/audit-posthog-session-gaps.mjs --prod --from 2026-05-14 --to 2026-06-13
//   node scripts/audit-posthog-session-gaps.mjs --prod --days 30 --json

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)

function hasFlag(name) {
  return args.includes(name)
}

function readFlag(name, fallback = null) {
  const idx = args.indexOf(name)
  if (idx === -1) return fallback
  const value = args[idx + 1]
  return value && !value.startsWith('--') ? value : fallback
}

function readNumberFlag(name, fallback) {
  const value = readFlag(name)
  const n = value == null ? NaN : Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function stripQuotes(value) {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function loadEnv(rel, { override }) {
  const full = resolve(here, '..', rel)
  try {
    const raw = readFileSync(full, 'utf8')
    for (const line of raw.split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (!match) continue
      if (override || !process.env[match[1]]) process.env[match[1]] = stripQuotes(match[2])
    }
    return true
  } catch {
    return false
  }
}

function cleanHost(host) {
  return stripQuotes(host || 'https://eu.i.posthog.com').replace(/\/+$/, '')
}

function queryHost(host) {
  // Ingestion hosts (eu.i.posthog.com) do not always expose the same API
  // surface as the app host. Try the configured host first, then this fallback.
  return host.replace('://eu.i.posthog.com', '://eu.posthog.com').replace('://us.i.posthog.com', '://us.posthog.com')
}

function isoDate(date) {
  return date.toISOString().slice(0, 10)
}

function parseDateBound(raw, label) {
  const parsed = new Date(`${raw}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid --${label}: ${raw}`)
  return parsed
}

function addDays(date, days) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function dateRange(fromDate, toDate) {
  const days = []
  for (let d = new Date(fromDate); d < toDate; d = addDays(d, 1)) days.push(isoDate(d))
  return days
}

async function fetchJson(url, options) {
  const res = await fetch(url, options)
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // keep raw text for the error below
  }
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 500)}`)
  }
  return json
}

async function resolveProjectId(host, privateKey, publicToken) {
  if (process.env.POSTHOG_PROJECT_ID?.trim()) return process.env.POSTHOG_PROJECT_ID.trim()
  if (!publicToken) return '@current'

  const candidates = Array.from(new Set([host, queryHost(host)]))
  for (const candidate of candidates) {
    try {
      const body = await fetchJson(`${candidate}/api/projects/`, {
        headers: { Authorization: `Bearer ${privateKey}` },
      })
      const match = (body?.results ?? []).find((project) => project.api_token === publicToken)
      if (match?.id != null) return String(match.id)
    } catch {
      // try next candidate
    }
  }
  return '@current'
}

async function runHogQL({ host, privateKey, publicToken, query }) {
  const projectId = await resolveProjectId(host, privateKey, publicToken)
  const candidates = Array.from(new Set([host, queryHost(host)]))
  let lastError = null
  for (const candidate of candidates) {
    try {
      const body = await fetchJson(`${candidate}/api/projects/${encodeURIComponent(projectId)}/query/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${privateKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: { kind: 'HogQLQuery', query },
          refresh: 'blocking',
        }),
      })
      return body?.results ?? []
    } catch (err) {
      lastError = err
    }
  }
  throw lastError ?? new Error('PostHog query failed')
}

function table(rows, columns) {
  const widths = columns.map((col) =>
    Math.max(col.label.length, ...rows.map((row) => String(col.value(row) ?? '').length)),
  )
  const header = columns.map((col, i) => col.label.padEnd(widths[i])).join('  ')
  const sep = widths.map((w) => '-'.repeat(w)).join('  ')
  const body = rows.map((row) => columns.map((col, i) => String(col.value(row) ?? '').padEnd(widths[i])).join('  '))
  return [header, sep, ...body].join('\n')
}

function num(value) {
  if (value == null) return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function pct(part, total) {
  if (!total) return 'n/a'
  return `${Math.round((part / total) * 1000) / 10}%`
}

const useProd = hasFlag('--prod')
const jsonOut = hasFlag('--json')
const days = readNumberFlag('--days', 30)

loadEnv('.env', { override: false })
const localPosthogPersonalKey = process.env.POSTHOG_PERSONAL_API_KEY
const localPosthogKey = process.env.POSTHOG_API_KEY
const localPosthogToken = process.env.POSTHOG_TOKEN
const localPosthogHost = process.env.POSTHOG_HOST
if (useProd) {
  loadEnv('.env.production', { override: true })
  // Production env may not carry PostHog keys. Keep local analytics credentials
  // while overriding DATABASE_URL toward production.
  if (localPosthogPersonalKey) process.env.POSTHOG_PERSONAL_API_KEY = localPosthogPersonalKey
  if (localPosthogKey) process.env.POSTHOG_API_KEY = localPosthogKey
  if (localPosthogToken) process.env.POSTHOG_TOKEN = localPosthogToken
  if (localPosthogHost) process.env.POSTHOG_HOST = localPosthogHost
}
loadEnv('.env.local', { override: false })

const to = readFlag('--to')
  ? parseDateBound(readFlag('--to'), 'to')
  : parseDateBound(isoDate(addDays(new Date(), 1)), 'to')
const from = readFlag('--from') ? parseDateBound(readFlag('--from'), 'from') : addDays(to, -days)

if (!(from < to)) throw new Error('--from must be before --to')

const databaseUrl = process.env.DATABASE_URL
const posthogKey = process.env.POSTHOG_PERSONAL_API_KEY ?? process.env.POSTHOG_API_KEY
const posthogToken = process.env.POSTHOG_TOKEN ?? null
const posthogHost = cleanHost(process.env.POSTHOG_HOST)

if (!databaseUrl) throw new Error('DATABASE_URL missing')
if (!posthogKey) throw new Error('POSTHOG_PERSONAL_API_KEY or POSTHOG_API_KEY missing')

const sql = postgres(databaseUrl, {
  ssl: useProd || /neon\.tech/.test(databaseUrl) ? 'require' : undefined,
  max: 3,
  prepare: false,
})

const fromIso = from.toISOString()
const toIso = to.toISOString()
const allDays = dateRange(from, to)

function rowsToDailyMap(rows, names) {
  const map = new Map()
  for (const row of rows) {
    const day = String(row[0])
    const entry = { day }
    names.forEach((name, i) => {
      entry[name] = num(row[i + 1])
    })
    map.set(day, entry)
  }
  return map
}

try {
  const [posthogRows, posthogAllRows, visitorRows, cartRows, localTables] = await Promise.all([
    runHogQL({
      host: posthogHost,
      privateKey: posthogKey,
      publicToken: posthogToken,
      query: `
        SELECT
          toString(toDate(timestamp)) AS day,
          count() AS events,
          count(DISTINCT distinct_id) AS distinct_ids,
          count(DISTINCT properties.$session_id) AS sessions,
          countIf(event = '$pageview') AS pageviews,
          countIf(event LIKE 'cart:%') AS cart_events,
          countIf(event LIKE 'checkout:%') AS checkout_events
        FROM events
        WHERE timestamp >= toDateTime('${fromIso}')
          AND timestamp < toDateTime('${toIso}')
          AND distinct_id IS NOT NULL
          AND properties.$session_id IS NOT NULL
        GROUP BY day
        ORDER BY day ASC
      `,
    }),
    runHogQL({
      host: posthogHost,
      privateKey: posthogKey,
      publicToken: posthogToken,
      query: `
        SELECT
          toString(toDate(timestamp)) AS day,
          count() AS all_events,
          count(DISTINCT distinct_id) AS all_distinct_ids,
          countIf(event = '$pageview') AS all_pageviews,
          countIf(properties.$session_id IS NOT NULL) AS events_with_session_id
        FROM events
        WHERE timestamp >= toDateTime('${fromIso}')
          AND timestamp < toDateTime('${toIso}')
        GROUP BY day
        ORDER BY day ASC
      `,
    }),
    sql`
      SELECT started_at::date::text AS day,
             count(*)::int AS sessions,
             count(DISTINCT distinct_id)::int AS distinct_ids,
             count(*) FILTER (WHERE segment_at_session_start = 'unknown')::int AS unknown,
             count(*) FILTER (WHERE segment_at_session_start = 'known_no_purchase')::int AS known_no_purchase,
             count(*) FILTER (WHERE segment_at_session_start = 'returning_customer')::int AS returning_customer
        FROM visitor_sessions
       WHERE started_at >= ${fromIso}::timestamp
         AND started_at < ${toIso}::timestamp
       GROUP BY 1
       ORDER BY 1 ASC
    `,
    sql`
      SELECT last_action_at::date::text AS day,
             count(*)::int AS carts,
             count(DISTINCT distinct_id)::int AS cart_distinct_ids,
             count(*) FILTER (WHERE last_action LIKE 'checkout:%')::int AS checkout_carts
        FROM carts
       WHERE last_action_at >= ${fromIso}::timestamp
         AND last_action_at < ${toIso}::timestamp
       GROUP BY 1
       ORDER BY 1 ASC
    `,
    sql`
      SELECT table_name
        FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('posthog_event_log', 'event_logs', 'visitor_sessions', 'carts')
       ORDER BY table_name
    `,
  ])

  const posthog = rowsToDailyMap(posthogRows, [
    'ph_events',
    'ph_distinct_ids',
    'ph_sessions',
    'ph_pageviews',
    'ph_cart_events',
    'ph_checkout_events',
  ])
  const posthogAll = rowsToDailyMap(posthogAllRows, [
    'ph_all_events',
    'ph_all_distinct_ids',
    'ph_all_pageviews',
    'ph_events_with_session_id',
  ])
  const visitors = new Map(visitorRows.map((row) => [row.day, row]))
  const carts = new Map(cartRows.map((row) => [row.day, row]))
  const tableNames = new Set(localTables.map((row) => row.table_name))

  let posthogLog = new Map()
  if (tableNames.has('posthog_event_log')) {
    const rows = await sql`
      SELECT event_timestamp::date::text AS day,
             count(*)::int AS local_posthog_events,
             count(DISTINCT distinct_id)::int AS local_posthog_distinct_ids
        FROM posthog_event_log
       WHERE event_timestamp >= ${fromIso}::timestamp
         AND event_timestamp < ${toIso}::timestamp
       GROUP BY 1
       ORDER BY 1 ASC
    `
    posthogLog = new Map(rows.map((row) => [row.day, row]))
  }

  let eventHub = new Map()
  if (tableNames.has('event_logs')) {
    const rows = await sql`
      SELECT received_at::date::text AS day,
             count(*)::int AS event_hub_events
        FROM event_logs
       WHERE received_at >= ${fromIso}::timestamp
         AND received_at < ${toIso}::timestamp
       GROUP BY 1
       ORDER BY 1 ASC
    `
    eventHub = new Map(rows.map((row) => [row.day, row]))
  }

  const merged = allDays.map((day) => {
    const ph = posthog.get(day) ?? {}
    const all = posthogAll.get(day) ?? {}
    const vs = visitors.get(day) ?? {}
    const cart = carts.get(day) ?? {}
    const pel = posthogLog.get(day) ?? {}
    const hub = eventHub.get(day) ?? {}
    const phSessions = num(ph.ph_sessions)
    const localSessions = num(vs.sessions)
    const localPosthogEvents = num(pel.local_posthog_events)
    const eventHubEvents = num(hub.event_hub_events)
    const status =
      phSessions > 0 && localSessions === 0
        ? 'DB_GAP'
        : phSessions === 0 && localSessions === 0
          ? 'NO_PH'
          : localSessions > phSessions * 1.2
            ? 'LOCAL_GT_PH'
            : localSessions < phSessions * 0.5
              ? 'UNDER_50'
              : 'OK'

    return {
      day,
      status,
      ph_events: num(ph.ph_events),
      ph_all_events: num(all.ph_all_events),
      ph_all_distinct_ids: num(all.ph_all_distinct_ids),
      ph_all_pageviews: num(all.ph_all_pageviews),
      ph_events_with_session_id: num(all.ph_events_with_session_id),
      ph_sessions: phSessions,
      ph_distinct_ids: num(ph.ph_distinct_ids),
      ph_pageviews: num(ph.ph_pageviews),
      ph_cart_events: num(ph.ph_cart_events),
      ph_checkout_events: num(ph.ph_checkout_events),
      visitor_sessions: localSessions,
      visitor_distinct_ids: num(vs.distinct_ids),
      unknown: num(vs.unknown),
      known_no_purchase: num(vs.known_no_purchase),
      returning_customer: num(vs.returning_customer),
      carts: num(cart.carts),
      cart_distinct_ids: num(cart.cart_distinct_ids),
      checkout_carts: num(cart.checkout_carts),
      local_posthog_events: localPosthogEvents,
      event_hub_events: eventHubEvents,
      coverage: phSessions ? localSessions / phSessions : null,
    }
  })

  const suspect = merged.filter((row) => ['DB_GAP', 'NO_PH', 'UNDER_50'].includes(row.status))
  const dbGaps = merged.filter((row) => row.status === 'DB_GAP')
  const noPosthog = merged.filter((row) => row.status === 'NO_PH')
  const under = merged.filter((row) => row.status === 'UNDER_50')

  const totals = merged.reduce(
    (acc, row) => {
      acc.ph_sessions += row.ph_sessions
      acc.visitor_sessions += row.visitor_sessions
      acc.ph_events += row.ph_events
      acc.ph_all_events += row.ph_all_events
      acc.local_posthog_events += row.local_posthog_events
      acc.event_hub_events += row.event_hub_events
      return acc
    },
    {
      ph_sessions: 0,
      visitor_sessions: 0,
      ph_events: 0,
      ph_all_events: 0,
      local_posthog_events: 0,
      event_hub_events: 0,
    },
  )

  const result = {
    range: { from: fromIso, to: toIso },
    target: useProd ? 'prod' : 'local',
    posthog_host: posthogHost,
    tables_present: Array.from(tableNames),
    totals,
    suspect_days: suspect,
    rows: merged,
  }

  if (jsonOut) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(`[audit-posthog-session-gaps] target=${result.target} range=${fromIso} -> ${toIso}`)
    console.log(`[audit-posthog-session-gaps] PostHog host=${posthogHost}`)
    console.log(`[audit-posthog-session-gaps] tables=${result.tables_present.join(', ') || 'none'}`)
    console.log('')
    console.log(
      `Totals: PostHog sessions=${totals.ph_sessions}, CRM visitor_sessions=${totals.visitor_sessions}, coverage=${pct(totals.visitor_sessions, totals.ph_sessions)}, PostHog events=${totals.ph_events}`,
    )
    console.log(`PostHog all events=${totals.ph_all_events}`)
    if (totals.local_posthog_events || totals.event_hub_events) {
      console.log(`Local logs: posthog_event_log=${totals.local_posthog_events}, event_logs=${totals.event_hub_events}`)
    }
    console.log('')
    console.log(
      table(merged, [
        { label: 'day', value: (r) => r.day },
        { label: 'status', value: (r) => r.status },
        { label: 'ph_sess', value: (r) => r.ph_sessions },
        { label: 'crm_sess', value: (r) => r.visitor_sessions },
        { label: 'cov', value: (r) => pct(r.visitor_sessions, r.ph_sessions) },
        { label: 'ph_events', value: (r) => r.ph_events },
        { label: 'all_ev', value: (r) => r.ph_all_events },
        { label: 'pageviews', value: (r) => r.ph_pageviews },
        { label: 'cart_ev', value: (r) => r.ph_cart_events },
        { label: 'checkout_ev', value: (r) => r.ph_checkout_events },
        { label: 'carts', value: (r) => r.carts },
        { label: 'pel', value: (r) => r.local_posthog_events },
        { label: 'hub', value: (r) => r.event_hub_events },
      ]),
    )
    console.log('')
    console.log(`Suspect days: ${suspect.length}`)
    if (dbGaps.length) console.log(`- DB_GAP: ${dbGaps.map((row) => row.day).join(', ')}`)
    if (under.length) console.log(`- UNDER_50: ${under.map((row) => row.day).join(', ')}`)
    if (noPosthog.length) console.log(`- NO_PH: ${noPosthog.map((row) => row.day).join(', ')}`)
    console.log('')
    if (dbGaps.length) {
      console.log(
        'Hypothesis: PostHog received session-bearing events on DB_GAP days, but CRM visitor_sessions did not materialize them. Investigate cron/subscriber execution and run a visitor_sessions backfill for those days.',
      )
    } else if (noPosthog.length) {
      console.log(
        'Hypothesis: NO_PH days have no session-bearing PostHog events in the queried project/range. Check storefront/proxy delivery or project/token selection.',
      )
    } else if (under.length) {
      console.log(
        'Hypothesis: CRM materialization is partially behind PostHog. Re-run syncVisitorSessions/backfill over the under-covered range and inspect job errors.',
      )
    } else {
      console.log('Hypothesis: no material session gap detected for this range.')
    }
  }
} finally {
  await sql.end({ timeout: 5 })
}
