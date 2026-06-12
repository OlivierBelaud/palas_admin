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
import { posthogPrivateKey, runPosthogHogQL } from '../utils/posthog-query'

interface SyncVisitorSessionsResult {
  fetched: number
  attempted: number
  skipped: number
  errors: number
  since: string | null
  max_at: string | null
  duration_ms: number
}

const EMPTY: SyncVisitorSessionsResult = {
  fetched: 0,
  attempted: 0,
  skipped: 0,
  errors: 0,
  since: null,
  max_at: null,
  duration_ms: 0,
}

type RuntimeDatabase = {
  raw<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
}

type ContactRow = {
  id: string
  first_order_at?: Date | string | null
}

const MAX_EVENTS_PER_RUN = 250
const DEFAULT_LOOKBACK_MINUTES = 15

function segmentForContact(contact: ContactRow | undefined, occurredAt: string): SessionSegment {
  if (!contact) return 'unknown'
  const firstOrderAt = contact.first_order_at ? new Date(contact.first_order_at).getTime() : null
  if (firstOrderAt != null && firstOrderAt < new Date(occurredAt).getTime()) return 'returning_customer'
  return 'known_no_purchase'
}

type ContactInfo = {
  contact_id: string
  first_order_at: Date | string | null
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
    `SELECT id AS contact_id, first_order_at
       FROM contacts
      WHERE distinct_id = $1
      LIMIT 1`,
    [distinctId],
  )
  return rows[0]
}

async function getContactByEmail(db: RuntimeDatabase, email: string): Promise<ContactInfo | undefined> {
  const rows = await db.raw<ContactInfo>(
    `SELECT id AS contact_id, first_order_at
       FROM contacts
      WHERE lower(email) = $1
      LIMIT 1`,
    [email.trim().toLowerCase()],
  )
  return rows[0]
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
    ? new Date(latest.getTime() - DEFAULT_LOOKBACK_MINUTES * 60 * 1000)
    : new Date(Date.now() - 24 * 60 * 60 * 1000)
  const sinceIso = since.toISOString()

  const rows = (await runPosthogHogQL(
    `SELECT uuid, event, distinct_id, timestamp, properties
       FROM events
      WHERE timestamp > toDateTime('${sinceIso}')
        AND distinct_id IS NOT NULL
        AND properties.$session_id IS NOT NULL
      ORDER BY timestamp ASC, uuid ASC
      LIMIT ${MAX_EVENTS_PER_RUN}`,
    { privateKey: key },
  )) as unknown as HogQLEventRow[]

  const sessionCache = new Map<string, ExistingSession | undefined>()
  const contactByDistinct = new Map<string, ContactRow | undefined>()
  const contactByEmail = new Map<string, ContactRow | undefined>()

  let attempted = 0
  let skipped = 0
  let errors = 0

  for (const row of rows) {
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
      contactByDistinct.set(
        evt.distinct_id,
        contact ? { id: contact.contact_id, first_order_at: contact.first_order_at } : undefined,
      )
    }
    let contact = contactByDistinct.get(evt.distinct_id)
    if (!contact && emailOnEvent) {
      const email = emailOnEvent.trim().toLowerCase()
      if (!contactByEmail.has(email)) {
        const contactByMail = await getContactByEmail(runtimeDb, email)
        contactByEmail.set(
          email,
          contactByMail ? { id: contactByMail.contact_id, first_order_at: contactByMail.first_order_at } : undefined,
        )
      }
      contact = contactByEmail.get(email)
    }

    const identityAtStart: IdentityAtStart = existing
      ? {
          contact_id: existing.contact_id ?? contact?.id ?? null,
          email: existing.email_at_session_start,
          segment: existing.segment_at_session_start,
        }
      : {
          contact_id: contact?.id ?? null,
          email: null,
          segment: segmentForContact(contact, evt.timestamp),
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

  const finalRows = await runtimeDb.raw<{ max_ts: Date | string | null }>(
    `SELECT MAX(last_event_at) AS max_ts FROM visitor_sessions`,
  )
  const maxAt = finalRows[0]?.max_ts ? new Date(finalRows[0].max_ts).toISOString() : null
  const result: SyncVisitorSessionsResult = {
    fetched: rows.length,
    attempted,
    skipped,
    errors,
    since: sinceIso,
    max_at: maxAt,
    duration_ms: Date.now() - startedAt,
  }

  log.info(
    `[sync-visitor-sessions] fetched=${result.fetched} attempted=${result.attempted} skipped=${result.skipped} errors=${result.errors} since=${result.since ?? 'none'} maxAt=${result.max_at ?? 'none'} duration_ms=${result.duration_ms}`,
  )
  return result
})
