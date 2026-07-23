// Canonical PostHog -> visitor_sessions projection engine.
//
// Both the manual `syncVisitorSessions` command and the scheduled
// `sync-visitor-sessions` job must remain thin adapters around this module.
// Keeping pagination, overlap/resume, identity resolution and attribution
// repair here prevents the two execution paths from producing different data.

import { type HogQLEventRow, rowToPosthogEvent } from '../modules/cart-tracking/posthog-sync'
import { extractSessionId } from '../modules/visitor-session/attribution'
import {
  type ExistingSession,
  type IdentityAtStart,
  planSessionUpsert,
  type SessionSegment,
} from '../modules/visitor-session/upsert-session'
import type { RuntimeSql } from './manta-runtime'
import { repairOrderSessionAttribution } from './order-session-attribution-repair'
import { runPosthogHogQL } from './posthog-query'

export interface SyncVisitorSessionsResult {
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

export const EMPTY_VISITOR_SESSION_SYNC_RESULT: SyncVisitorSessionsResult = {
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

export interface RuntimeDatabase {
  raw<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
}

interface SyncLog {
  info(message: string): void
  warn(message: string): void
}

interface ContactRow {
  id: string
  email?: string | null
}

interface ContactInfo {
  contact_id: string
  email: string | null
}

interface OrderRow {
  status?: string | null
  placed_at?: Date | string | null
}

interface RunVisitorSessionSyncOptions {
  db: RuntimeDatabase
  privateKey: string
  signal?: AbortSignal
  log: SyncLog
  lookbackMinutes?: number
  eventsPerPage?: number
  maxPages?: number
  maxRunMs?: number
}

interface VisitorSessionSyncDependencies {
  query: (
    hogql: string,
    options: { privateKey: string; signal?: AbortSignal },
  ) => Promise<HogQLEventRow[]>
  repairAttribution: typeof repairOrderSessionAttribution
  nowMs: () => number
}

const EVENTS_PER_PAGE = 500
const MAX_PAGES_PER_RUN = 8
const MAX_RUN_MS = 45_000
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

export function createVisitorSessionSyncEngine(
  overrides: Partial<VisitorSessionSyncDependencies> = {},
): (options: RunVisitorSessionSyncOptions) => Promise<SyncVisitorSessionsResult> {
  const dependencies: VisitorSessionSyncDependencies = {
    query: (hogql, options) => runPosthogHogQL<HogQLEventRow[]>(hogql, options),
    repairAttribution: repairOrderSessionAttribution,
    nowMs: Date.now,
    ...overrides,
  }

  return async function execute(options: RunVisitorSessionSyncOptions): Promise<SyncVisitorSessionsResult> {
    const {
      db,
      privateKey,
      signal,
      log,
      lookbackMinutes,
      eventsPerPage = EVENTS_PER_PAGE,
      maxPages = MAX_PAGES_PER_RUN,
      maxRunMs = MAX_RUN_MS,
    } = options
    const startedAt = dependencies.nowMs()
    const overlapMinutes = lookbackMinutes ?? CURSOR_OVERLAP_MINUTES
    const bootstrapMinutes = lookbackMinutes ?? BOOTSTRAP_LOOKBACK_MINUTES
    const latestRows = await db.raw<{ max_ts: Date | string | null }>(
      `SELECT MAX(last_event_at) AS max_ts FROM visitor_sessions`,
    )
    const latest = latestRows[0]?.max_ts ? new Date(latestRows[0].max_ts) : null
    const since = latest
      ? new Date(latest.getTime() - overlapMinutes * 60 * 1000)
      : new Date(startedAt - bootstrapMinutes * 60 * 1000)
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

    for (let page = 0; page < maxPages; page += 1) {
      if (signal?.aborted || dependencies.nowMs() - startedAt > maxRunMs) break
      const cursorClause =
        page === 0
          ? `timestamp > toDateTime('${hogqlString(sinceIso)}')`
          : `(timestamp > toDateTime('${hogqlString(cursorTimestamp)}')
              OR (timestamp = toDateTime('${hogqlString(cursorTimestamp)}')
                  AND uuid > '${hogqlString(cursorUuid)}'))`
      const rows = await dependencies.query(
        `SELECT uuid, event, distinct_id, timestamp, properties
           FROM events
          WHERE ${cursorClause}
            AND distinct_id IS NOT NULL
            AND properties.$session_id IS NOT NULL
          ORDER BY timestamp ASC, uuid ASC
          LIMIT ${eventsPerPage}`,
        { privateKey, signal },
      )

      fetched += rows.length
      if (rows.length === 0) break

      for (const row of rows) {
        if (signal?.aborted || dependencies.nowMs() - startedAt > maxRunMs) break
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

        // Identity reads deliberately fail the whole run: continuing after a
        // database outage could freeze an incorrect anonymous identity.
        const cacheKey = `${evt.distinct_id}|${sessionId}`
        if (!sessionCache.has(cacheKey)) {
          sessionCache.set(cacheKey, await getExistingSession(db, evt.distinct_id, sessionId))
        }
        const existing = sessionCache.get(cacheKey)

        if (!contactByDistinct.has(evt.distinct_id)) {
          const contact = await getContactByDistinctId(db, evt.distinct_id)
          contactByDistinct.set(evt.distinct_id, contact ? { id: contact.contact_id, email: contact.email } : undefined)
        }
        let contact = contactByDistinct.get(evt.distinct_id)
        if (!contact && emailOnEvent) {
          const email = emailOnEvent.trim().toLowerCase()
          if (!contactByEmail.has(email)) {
            const contactByMail = await getContactByEmail(db, email)
            contactByEmail.set(
              email,
              contactByMail ? { id: contactByMail.contact_id, email: contactByMail.email } : undefined,
            )
          }
          contact = contactByEmail.get(email)
        }
        const orderEmail = (contact?.email ?? emailOnEvent ?? '').trim().toLowerCase()
        if (orderEmail && !ordersByEmail.has(orderEmail)) {
          ordersByEmail.set(orderEmail, await getOrdersByEmail(db, orderEmail))
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

          await upsertSession(db, intent.row)
          sessionCache.set(cacheKey, {
            id: existing?.id ?? '__memory__',
            ...intent.row,
          })
        } catch (error) {
          errors += 1
          if (errors < 10) {
            log.warn(
              `[visitor-session-sync] upsert failed for ${evt.event} (${evt.uuid ?? 'no-uuid'}): ${(error as Error).message}`,
            )
          }
        }
      }

      const lastEvent = rowToPosthogEvent(rows[rows.length - 1])
      cursorTimestamp = lastEvent.timestamp
      cursorUuid = lastEvent.uuid ?? ''
      if (rows.length < eventsPerPage) break
    }

    if (signal?.aborted) {
      const result: SyncVisitorSessionsResult = {
        fetched,
        attempted,
        skipped,
        errors,
        since: sinceIso,
        max_at: null,
        attribution_repaired: 0,
        remaining_unattributed_recent: 0,
        duration_ms: dependencies.nowMs() - startedAt,
      }
      log.info(
        `[visitor-session-sync] cancelled fetched=${result.fetched} attempted=${result.attempted} skipped=${result.skipped} errors=${result.errors} since=${result.since ?? 'none'} duration_ms=${result.duration_ms}`,
      )
      return result
    }

    const finalRows = await db.raw<{ max_ts: Date | string | null }>(
      `SELECT MAX(last_event_at) AS max_ts FROM visitor_sessions`,
    )
    const maxAt = finalRows[0]?.max_ts ? new Date(finalRows[0].max_ts).toISOString() : null
    let attributionRepaired = 0
    let remainingUnattributedRecent = 0
    try {
      const repairSql = { unsafe: db.raw.bind(db) } as unknown as RuntimeSql
      const repairEnd = new Date(dependencies.nowMs() + 60 * 60 * 1000)
      const repairStart = new Date(dependencies.nowMs() - 48 * 60 * 60 * 1000)
      const repair = await dependencies.repairAttribution(repairSql, {
        startIso: repairStart.toISOString(),
        endIso: repairEnd.toISOString(),
      })
      attributionRepaired = repair.repaired_orders
      remainingUnattributedRecent = repair.remaining_unattributed_orders
    } catch (error) {
      errors += 1
      log.warn(`[visitor-session-sync] attribution invariant repair failed: ${(error as Error).message}`)
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
      duration_ms: dependencies.nowMs() - startedAt,
    }
    log.info(
      `[visitor-session-sync] fetched=${result.fetched} attempted=${result.attempted} skipped=${result.skipped} errors=${result.errors} since=${result.since ?? 'none'} maxAt=${result.max_at ?? 'none'} attribution_repaired=${result.attribution_repaired} remaining_unattributed_recent=${result.remaining_unattributed_recent} duration_ms=${result.duration_ms}`,
    )
    return result
  }
}

export const runVisitorSessionSync = createVisitorSessionSyncEngine()
