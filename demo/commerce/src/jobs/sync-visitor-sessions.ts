// Cron: every 5 minutes — keep visitor_sessions current from PostHog.
//
// This job materializes session snapshots only. Raw event history remains in
// PostHog and can be replayed through syncVisitorSessions/backfill scripts.

import { type HogQLEventRow, rowToPosthogEvent } from '../modules/cart-tracking/posthog-sync'
import { extractSessionId } from '../modules/visitor-session/attribution'
import {
  type ExistingSession,
  type IdentityAtStart,
  planSessionUpsert,
  type SessionSegment,
} from '../modules/visitor-session/upsert-session'
import type { RuntimeSql } from '../utils/manta-runtime'
import { repairOrderSessionAttribution } from '../utils/order-session-attribution-repair'
import { posthogPrivateKey, runPosthogHogQL } from '../utils/posthog-query'

interface SyncVisitorSessionsResult {
  fetched: number
  attempted: number
  skipped: number
  errors: number
  since: string | null
  max_at: string | null
  attribution_repaired: number
  remaining_unattributed_recent: number
  duration_ms: number
}

const EMPTY: SyncVisitorSessionsResult = {
  fetched: 0,
  attempted: 0,
  skipped: 0,
  errors: 0,
  since: null,
  max_at: null,
  attribution_repaired: 0,
  remaining_unattributed_recent: 0,
  duration_ms: 0,
}

type RuntimeDatabase = {
  raw<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
}

type ContactRow = {
  id: string
  email?: string | null
}

type OrderRow = {
  status?: string | null
  placed_at?: Date | string | null
}

const EVENTS_PER_PAGE = 500
const MAX_PAGES_PER_RUN = 8
const MAX_RUN_MS = 45_000
// Keep a small overlap behind the current high-water mark. A full-day overlap
// can starve this job on high-volume days: HogQL keeps returning the same first
// page, and the session snapshot never reaches the rest of the day.
const CURSOR_OVERLAP_MINUTES = 15
const BOOTSTRAP_LOOKBACK_MINUTES = 24 * 60

function hogqlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function segmentForContact(contact: ContactRow | undefined, orders: OrderRow[], occurredAt: string): SessionSegment {
  if (!contact) return 'unknown'
  const occurredAtMs = new Date(occurredAt).getTime()
  const hasPriorOrder = orders.some((order) => {
    if (order.status !== 'paid' && order.status !== 'fulfilled') return false
    const placedAt = order.placed_at ? new Date(order.placed_at).getTime() : null
    return placedAt != null && Number.isFinite(placedAt) && placedAt < occurredAtMs
  })
  if (hasPriorOrder) return 'returning_customer'
  return 'known_no_purchase'
}

type ContactInfo = {
  contact_id: string
  email: string | null
}

async function getExistingSession(
  db: RuntimeDatabase,
  distinctId: string,
  sessionId: string,
): Promise<ExistingSession | undefined> {
  const rows = await db.raw<ExistingSession>(
    `SELECT id, started_at, last_event_at, pageviews_count,
            email_at_session_start, email_at_session_end, contact_id,
            segment_at_session_start, first_url, utm_source, utm_medium,
            utm_campaign, referring_domain, is_paid_session,
            carts_created_in_session, carts_viewed_in_session,
            carts_updated_in_session, cart_converted, order_id,
            became_customer_in_session, became_customer_at,
            email_acquired_in_session, email_acquired_via,
            email_acquired_at, seen_event_uuids
       FROM visitor_sessions
      WHERE distinct_id = $1 AND session_id = $2
      LIMIT 1`,
    [distinctId, sessionId],
  )
  return rows[0]
}

async function getContactByDistinctId(db: RuntimeDatabase, distinctId: string): Promise<ContactInfo | undefined> {
  const rows = await db.raw<ContactInfo>(
    `SELECT id AS contact_id, email
       FROM contacts
      WHERE distinct_id = $1
      LIMIT 1`,
    [distinctId],
  )
  return rows[0]
}

async function getContactByEmail(db: RuntimeDatabase, email: string): Promise<ContactInfo | undefined> {
  const rows = await db.raw<ContactInfo>(
    `SELECT id AS contact_id, email
       FROM contacts
      WHERE lower(email) = $1
      LIMIT 1`,
    [email.trim().toLowerCase()],
  )
  return rows[0]
}

async function getOrdersByEmail(db: RuntimeDatabase, email: string): Promise<OrderRow[]> {
  return db.raw<OrderRow>(
    `SELECT status, placed_at
       FROM orders
      WHERE deleted_at IS NULL
        AND lower(email) = $1`,
    [email.trim().toLowerCase()],
  )
}

async function upsertSession(db: RuntimeDatabase, row: ReturnType<typeof planSessionUpsert>['row']): Promise<void> {
  await db.raw(
    `INSERT INTO visitor_sessions
       (id, distinct_id, session_id, started_at, last_event_at, pageviews_count,
        email_at_session_start, email_at_session_end, contact_id,
        segment_at_session_start, first_url, utm_source, utm_medium, utm_campaign,
        referring_domain, is_paid_session, carts_viewed_in_session, carts_created_in_session,
        carts_updated_in_session, cart_converted, order_id,
        became_customer_in_session, became_customer_at,
        email_acquired_in_session, email_acquired_via, email_acquired_at, seen_event_uuids,
        created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5,
             $6, $7, $8,
             $9, $10, $11, $12, $13,
             $14, $15, $16, $17,
             $18, $19, $20,
             $21, $22,
             $23, $24, $25, $26::jsonb,
             NOW(), NOW())
     ON CONFLICT (distinct_id, session_id) DO UPDATE SET
       last_event_at = EXCLUDED.last_event_at,
       email_at_session_end = EXCLUDED.email_at_session_end,
       contact_id = COALESCE(visitor_sessions.contact_id, EXCLUDED.contact_id),
       pageviews_count = EXCLUDED.pageviews_count,
       carts_viewed_in_session = EXCLUDED.carts_viewed_in_session,
       carts_created_in_session = EXCLUDED.carts_created_in_session,
       carts_updated_in_session = EXCLUDED.carts_updated_in_session,
       email_acquired_in_session = EXCLUDED.email_acquired_in_session,
       email_acquired_via = EXCLUDED.email_acquired_via,
       email_acquired_at = EXCLUDED.email_acquired_at,
       seen_event_uuids = EXCLUDED.seen_event_uuids,
       updated_at = NOW()`,
    [
      row.distinct_id,
      row.session_id,
      row.started_at,
      row.last_event_at,
      row.pageviews_count,
      row.email_at_session_start,
      row.email_at_session_end,
      row.contact_id,
      row.segment_at_session_start,
      row.first_url,
      row.utm_source,
      row.utm_medium,
      row.utm_campaign,
      row.referring_domain,
      row.is_paid_session,
      row.carts_viewed_in_session,
      row.carts_created_in_session,
      row.carts_updated_in_session,
      row.cart_converted,
      row.order_id,
      row.became_customer_in_session,
      row.became_customer_at,
      row.email_acquired_in_session,
      row.email_acquired_via,
      row.email_acquired_at,
      row.seen_event_uuids != null ? JSON.stringify(row.seen_event_uuids) : null,
    ],
  )
}

export default defineJob('sync-visitor-sessions', '*/5 * * * *', async ({ db, log }) => {
  if (process.env.NODE_ENV !== 'production') {
    log.info(`[sync-visitor-sessions] skipped (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}, prod-only)`)
    return EMPTY
  }

  const runtimeDb = db as RuntimeDatabase | undefined
  const key = posthogPrivateKey()

  if (!runtimeDb?.raw || !key) {
    log.error('[sync-visitor-sessions] DB or POSTHOG_API_KEY missing')
    return { ...EMPTY, errors: 1 }
  }

  const startedAt = Date.now()
  const latestRows = await runtimeDb.raw<{ max_ts: Date | string | null }>(
    `SELECT MAX(last_event_at) AS max_ts FROM visitor_sessions`,
  )
  const latest = latestRows[0]?.max_ts ? new Date(latestRows[0].max_ts) : null
  const since = latest
    ? new Date(latest.getTime() - CURSOR_OVERLAP_MINUTES * 60 * 1000)
    : new Date(Date.now() - BOOTSTRAP_LOOKBACK_MINUTES * 60 * 1000)
  const sinceIso = since.toISOString()

  const sessionCache = new Map<string, ExistingSession | undefined>()
  const contactByDistinct = new Map<string, ContactRow | undefined>()
  const contactByEmail = new Map<string, ContactRow | undefined>()
  const ordersByEmail = new Map<string, OrderRow[]>()

  let fetched = 0
  let attempted = 0
  let skipped = 0
  let errors = 0

  let cursorTimestamp = sinceIso
  let cursorUuid = ''

  for (let page = 0; page < MAX_PAGES_PER_RUN; page += 1) {
    if (Date.now() - startedAt > MAX_RUN_MS) break
    const cursorClause =
      page === 0
        ? `timestamp > toDateTime('${hogqlString(sinceIso)}')`
        : `(timestamp > toDateTime('${hogqlString(cursorTimestamp)}')
            OR (timestamp = toDateTime('${hogqlString(cursorTimestamp)}')
                AND uuid > '${hogqlString(cursorUuid)}'))`
    const rows = (await runPosthogHogQL(
      `SELECT uuid, event, distinct_id, timestamp, properties
         FROM events
        WHERE ${cursorClause}
          AND distinct_id IS NOT NULL
          AND properties.$session_id IS NOT NULL
        ORDER BY timestamp ASC, uuid ASC
        LIMIT ${EVENTS_PER_PAGE}`,
      { privateKey: key },
    )) as unknown as HogQLEventRow[]

    fetched += rows.length
    if (rows.length === 0) break

    for (const row of rows) {
      if (Date.now() - startedAt > MAX_RUN_MS) break
      const evt = rowToPosthogEvent(row)
      const sessionId = extractSessionId(evt)
      if (!sessionId || !evt.distinct_id) {
        skipped += 1
        continue
      }

      const props = evt.properties ?? {}
      const $set = (props.$set as Record<string, unknown> | undefined) ?? {}
      const checkout = props.checkout as { email?: unknown } | undefined
      const emailOnEvent =
        (typeof $set.email === 'string' && $set.email.length > 0 ? $set.email : null) ??
        (checkout && typeof checkout.email === 'string' && checkout.email.length > 0 ? checkout.email : null)

      const cacheKey = `${evt.distinct_id}|${sessionId}`
      if (!sessionCache.has(cacheKey)) {
        sessionCache.set(cacheKey, await getExistingSession(runtimeDb, evt.distinct_id, sessionId))
      }
      const existing = sessionCache.get(cacheKey)

      if (!contactByDistinct.has(evt.distinct_id)) {
        const contact = await getContactByDistinctId(runtimeDb, evt.distinct_id)
        contactByDistinct.set(evt.distinct_id, contact ? { id: contact.contact_id, email: contact.email } : undefined)
      }
      let contact = contactByDistinct.get(evt.distinct_id)
      if (!contact && emailOnEvent) {
        const email = emailOnEvent.trim().toLowerCase()
        if (!contactByEmail.has(email)) {
          const contactByMail = await getContactByEmail(runtimeDb, email)
          contactByEmail.set(
            email,
            contactByMail ? { id: contactByMail.contact_id, email: contactByMail.email } : undefined,
          )
        }
        contact = contactByEmail.get(email)
      }
      const orderEmail = (contact?.email ?? emailOnEvent ?? '').trim().toLowerCase()
      if (orderEmail && !ordersByEmail.has(orderEmail)) {
        ordersByEmail.set(orderEmail, await getOrdersByEmail(runtimeDb, orderEmail))
      }
      const orders = orderEmail ? (ordersByEmail.get(orderEmail) ?? []) : []

      const identityAtStart: IdentityAtStart = existing
        ? {
            contact_id: existing.contact_id ?? contact?.id ?? null,
            email: existing.email_at_session_start,
            segment: existing.segment_at_session_start,
          }
        : {
            contact_id: contact?.id ?? null,
            email: null,
            segment: segmentForContact(contact, orders, evt.timestamp),
          }

      try {
        attempted += 1
        const intent = planSessionUpsert({
          event: {
            distinct_id: evt.distinct_id,
            session_id: sessionId,
            event_uuid: evt.uuid ?? null,
            event_name: evt.event,
            occurred_at: evt.timestamp,
            email_on_event: emailOnEvent,
            current_url: (props.$current_url as string | undefined) ?? null,
            utm_source: (props.utm_source as string | undefined) ?? null,
            utm_medium: (props.utm_medium as string | undefined) ?? null,
            utm_campaign: (props.utm_campaign as string | undefined) ?? null,
            referring_domain: (props.$referring_domain as string | undefined) ?? null,
          },
          existingSession: existing,
          identityAtStart,
        })

        await upsertSession(runtimeDb, intent.row)

        sessionCache.set(cacheKey, {
          id: existing?.id ?? '__memory__',
          ...intent.row,
        })
      } catch (err) {
        errors += 1
        if (errors < 10) {
          log.warn(
            `[sync-visitor-sessions] upsert failed for ${evt.event} (${evt.uuid ?? 'no-uuid'}): ${(err as Error).message}`,
          )
        }
      }
    }

    const lastEvent = rowToPosthogEvent(rows[rows.length - 1])
    cursorTimestamp = lastEvent.timestamp
    cursorUuid = lastEvent.uuid ?? ''

    if (rows.length < EVENTS_PER_PAGE) break
  }

  const finalRows = await runtimeDb.raw<{ max_ts: Date | string | null }>(
    `SELECT MAX(last_event_at) AS max_ts FROM visitor_sessions`,
  )
  const maxAt = finalRows[0]?.max_ts ? new Date(finalRows[0].max_ts).toISOString() : null
  let attributionRepaired = 0
  let remainingUnattributedRecent = 0
  try {
    const repairSql = { unsafe: runtimeDb.raw.bind(runtimeDb) } as unknown as RuntimeSql
    const repairEnd = new Date(Date.now() + 60 * 60 * 1000)
    const repairStart = new Date(Date.now() - 48 * 60 * 60 * 1000)
    const repair = await repairOrderSessionAttribution(repairSql, {
      startIso: repairStart.toISOString(),
      endIso: repairEnd.toISOString(),
    })
    attributionRepaired = repair.repaired_orders
    remainingUnattributedRecent = repair.remaining_unattributed_orders
  } catch (err) {
    errors += 1
    log.warn(`[sync-visitor-sessions] attribution invariant repair failed: ${(err as Error).message}`)
  }

  const result: SyncVisitorSessionsResult = {
    fetched,
    attempted,
    skipped,
    errors,
    since: sinceIso,
    max_at: maxAt,
    attribution_repaired: attributionRepaired,
    remaining_unattributed_recent: remainingUnattributedRecent,
    duration_ms: Date.now() - startedAt,
  }

  log.info(
    `[sync-visitor-sessions] fetched=${result.fetched} attempted=${result.attempted} skipped=${result.skipped} errors=${result.errors} since=${result.since ?? 'none'} maxAt=${result.max_at ?? 'none'} attribution_repaired=${result.attribution_repaired} remaining_unattributed_recent=${result.remaining_unattributed_recent} duration_ms=${result.duration_ms}`,
  )
  return result
})
