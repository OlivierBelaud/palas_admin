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

type EntityCrud<Row> = {
  list: (filters: Record<string, unknown>) => Promise<Row[]>
  upsertWithReplace?: (
    rows: Record<string, unknown>[],
    replaceFields?: string[],
    conflictTarget?: string[],
  ) => Promise<Record<string, unknown>[]>
}

type SessionRow = ExistingSession

type ContactRow = {
  id: string
  distinct_id?: string | null
  first_order_at?: Date | string | null
}

type JobApp = {
  modules: {
    visitorSession?: EntityCrud<SessionRow>
    contact?: EntityCrud<ContactRow>
  }
}

const MAX_EVENTS_PER_RUN = 250
const DEFAULT_LOOKBACK_MINUTES = 15

function segmentForContact(contact: ContactRow | undefined, occurredAt: string): SessionSegment {
  if (!contact) return 'unknown'
  const firstOrderAt = contact.first_order_at ? new Date(contact.first_order_at).getTime() : null
  if (firstOrderAt != null && firstOrderAt < new Date(occurredAt).getTime()) return 'returning_customer'
  return 'known_no_purchase'
}

export default defineJob('sync-visitor-sessions', '*/5 * * * *', async ({ app, db, log }) => {
  if (process.env.NODE_ENV !== 'production') {
    log.info(`[sync-visitor-sessions] skipped (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}, prod-only)`)
    return EMPTY
  }

  const runtimeDb = db as RuntimeDatabase | undefined
  const visitorSession = (app as JobApp | undefined)?.modules.visitorSession
  const contactService = (app as JobApp | undefined)?.modules.contact
  const key = posthogPrivateKey()

  if (!runtimeDb?.raw || !visitorSession?.upsertWithReplace || !contactService || !key) {
    log.error('[sync-visitor-sessions] DB, services, or POSTHOG_API_KEY missing')
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
      const existingRows = await visitorSession.list({ distinct_id: evt.distinct_id, session_id: sessionId })
      sessionCache.set(cacheKey, existingRows[0])
    }
    const existing = sessionCache.get(cacheKey)

    if (!contactByDistinct.has(evt.distinct_id)) {
      const contacts = await contactService.list({ distinct_id: evt.distinct_id })
      contactByDistinct.set(evt.distinct_id, contacts[0])
    }
    let contact = contactByDistinct.get(evt.distinct_id)
    if (!contact && emailOnEvent) {
      const email = emailOnEvent.trim().toLowerCase()
      if (!contactByEmail.has(email)) {
        const contacts = await contactService.list({ email })
        contactByEmail.set(email, contacts[0])
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

      await visitorSession.upsertWithReplace(
        [intent.row as unknown as Record<string, unknown>],
        intent.replaceFields,
        [...intent.conflictTarget],
      )

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
