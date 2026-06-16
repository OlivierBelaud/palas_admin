// Command: pull abandonment-flow Klaviyo events from PostHog DW into the
// local `klaviyo_events` table so abandoned-carts can read Postgres instead
// of doing a synchronous HogQL roundtrip.
//
// Triggered hourly by the sync-klaviyo-events job. Uses MAX(occurred_at) as
// a high-water mark so each run only ingests new events (sliding window
// fallback to 365d on first run).
//
// Single source of truth for the event filter: keep this in sync with the
// abandoned-carts query when adding new metrics or subject patterns.
//
// After ingest, also marks matching carts as `abandon_notified_source =
// 'klaviyo'` (only when not already notified) so that
// `cart.abandon_notified_at` is a unified record across Manta + Klaviyo.

import {
  type KlaviyoContactSnapshot,
  mapKlaviyoProfileToContactSnapshot,
} from '../../modules/contact/klaviyo-profile-sync'
import { posthogPrivateKey, runPosthogHogQL } from '../../utils/posthog-query'
import { type CartMarkingRepo, markCartsFromKlaviyoEvents } from '../../utils/sync-klaviyo-events-mark-helper'

const HOGQL_LIMIT = 5000
const FALLBACK_LOOKBACK_MS = 365 * 86400 * 1000
const OVERLAP_MS = 3600 * 1000 // 1h overlap to absorb Klaviyo eventual consistency
const PROFILE_FALLBACK_LOOKBACK_MS = 30 * 86400 * 1000
const PROFILE_ROLLING_LOOKBACK_MS = 48 * 3600 * 1000
const PROFILE_PAGE_SIZE = 100
const PROFILE_MAX_PER_RUN = 1000

function hogqlDateString(iso: string): string {
  return iso.slice(0, 19)
}

interface IngestResult {
  scanned: number
  inserted: number
  skipped: number
  carts_marked_klaviyo: number
  profiles_scanned: number
  profiles_matched: number
  profiles_updated: number
  profiles_missing_local_contact: number
  profiles_has_more: boolean
}

interface KlaviyoEventRow {
  klaviyo_event_id: string
  email: string
  metric: string
  subject: string | null
  checkout_token: string | null
  occurred_at: Date
  synced_at: Date
}

interface KlaviyoProfilesApiResponse {
  data?: Array<{ id: string; attributes?: Record<string, unknown> }>
  links?: { next?: string | null }
}

function profileSince(latestSyncedAt: Date | string | null | undefined): string {
  if (!latestSyncedAt) return new Date(Date.now() - PROFILE_FALLBACK_LOOKBACK_MS).toISOString()
  const latest = latestSyncedAt instanceof Date ? latestSyncedAt : new Date(latestSyncedAt)
  if (Number.isNaN(latest.getTime())) return new Date(Date.now() - PROFILE_FALLBACK_LOOKBACK_MS).toISOString()
  return new Date(Math.min(latest.getTime() - OVERLAP_MS, Date.now() - PROFILE_ROLLING_LOOKBACK_MS)).toISOString()
}

async function pullEventsFromHogQL(args: {
  sinceIso: string
  signal?: AbortSignal
  warn: (msg: string) => void
}): Promise<KlaviyoEventRow[]> {
  const phKey = posthogPrivateKey()
  if (!phKey) {
    args.warn('[sync-klaviyo-events] POSTHOG_API_KEY missing — skip')
    return []
  }

  const out: KlaviyoEventRow[] = []
  const seen = new Set<string>()
  let offset = 0

  while (true) {
    if (args.signal?.aborted) break

    // Same metric + subject filter as abandoned-carts.ts. Don't drift.
    const sql = `
      SELECT
        ke.uuid AS klaviyo_event_id,
        lower(kp.email) AS email,
        km.name AS metric,
        JSONExtractString(ke.event_properties, 'Subject') AS subject,
        coalesce(
          extract(
            JSONExtractString(ke.event_properties, 'checkout_url'),
            'checkouts/ac/([^/?"]+)'
          ),
          JSONExtractString(ke.event_properties, 'checkout_token'),
          ''
        ) AS checkout_token,
        toString(ke.datetime) AS occurred_at
      FROM klaviyo_events ke
      JOIN klaviyo_profiles kp ON kp.id = JSONExtractString(ke.relationships, 'profile', 'data', 'id')
      JOIN klaviyo_metrics km ON km.id = JSONExtractString(ke.relationships, 'metric', 'data', 'id')
      WHERE ke.datetime >= '${hogqlDateString(args.sinceIso)}'
        AND lower(kp.email) != ''
        AND (
          km.name = 'Shopify_Checkout_Abandonned'
          OR km.name = 'Checkout Abandoned'
          OR km.name = 'Ops Cart Abandoned'
          OR (
            km.name = 'Received Email'
            AND (
              positionCaseInsensitive(JSONExtractString(ke.event_properties, 'Subject'), 'oubli') > 0
              OR positionCaseInsensitive(JSONExtractString(ke.event_properties, 'Subject'), 'pensez encore') > 0
              OR positionCaseInsensitive(JSONExtractString(ke.event_properties, 'Subject'), 'attend plus que vous') > 0
              OR positionCaseInsensitive(JSONExtractString(ke.event_properties, 'Subject'), 'commande palas vous attend') > 0
              OR positionCaseInsensitive(JSONExtractString(ke.event_properties, 'Subject'), 'valider votre commande') > 0
              OR positionCaseInsensitive(JSONExtractString(ke.event_properties, 'Subject'), 'sélection de bijoux palas vous attend') > 0
            )
          )
        )
      ORDER BY ke.datetime ASC
      LIMIT ${HOGQL_LIMIT} OFFSET ${offset}
    `

    let rows: unknown[][]
    try {
      rows = await runPosthogHogQL(sql, {
        privateKey: phKey,
        refresh: 'force_blocking',
        signal: args.signal,
      })
    } catch (err) {
      args.warn(`[sync-klaviyo-events] ${(err as Error).message} — abort`)
      break
    }
    if (rows.length === 0) break

    for (const r of rows) {
      const row = r as Array<unknown>
      const id = String(row[0] ?? '').trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      const email = String(row[1] ?? '')
        .trim()
        .toLowerCase()
      const metric = String(row[2] ?? '').trim()
      const subjectRaw = row[3]
      const tokenRaw = row[4]
      const occurredAtStr = String(row[5] ?? '').trim()
      if (!email || !metric || !occurredAtStr) continue
      const occurredAt = new Date(occurredAtStr)
      if (Number.isNaN(occurredAt.getTime())) continue
      out.push({
        klaviyo_event_id: id,
        email,
        metric,
        subject: typeof subjectRaw === 'string' && subjectRaw.length > 0 ? subjectRaw : null,
        checkout_token: typeof tokenRaw === 'string' && tokenRaw.length > 0 ? tokenRaw : null,
        occurred_at: occurredAt,
        synced_at: new Date(),
      })
    }

    offset += rows.length
    if (rows.length < HOGQL_LIMIT) break
  }

  return out
}

async function pullProfilesFromKlaviyo(args: {
  sinceIso: string
  signal?: AbortSignal
  warn: (msg: string) => void
}): Promise<{ snapshots: KlaviyoContactSnapshot[]; has_more: boolean }> {
  const key = process.env.KLAVIYO_API_KEY
  if (!key) {
    args.warn('[sync-klaviyo-events] KLAVIYO_API_KEY missing — skip profiles')
    return { snapshots: [], has_more: false }
  }

  const host = (process.env.KLAVIYO_HOST ?? 'https://a.klaviyo.com').replace(/\/+$/, '')
  const headers = {
    Authorization: `Klaviyo-API-Key ${key}`,
    revision: process.env.KLAVIYO_API_REVISION ?? '2025-04-15',
    accept: 'application/json',
  }
  const snapshots: KlaviyoContactSnapshot[] = []
  const seen = new Set<string>()
  let next: string | null =
    `${host}/api/profiles/?filter=${encodeURIComponent(`greater-than(updated,${args.sinceIso})`)}` +
    `&page[size]=${PROFILE_PAGE_SIZE}`

  while (next && snapshots.length < PROFILE_MAX_PER_RUN) {
    if (args.signal?.aborted) break
    const res = await fetch(next, { headers, signal: args.signal })
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') ?? '5')
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, retryAfter) * 1000))
      continue
    }
    if (!res.ok) {
      args.warn(`[sync-klaviyo-events] profiles ${res.status} — abort profile sync`)
      break
    }
    const body = (await res.json()) as KlaviyoProfilesApiResponse
    for (const profile of body.data ?? []) {
      if (seen.has(profile.id)) continue
      seen.add(profile.id)
      const snapshot = mapKlaviyoProfileToContactSnapshot(profile)
      if (snapshot) snapshots.push(snapshot)
      if (snapshots.length >= PROFILE_MAX_PER_RUN) break
    }
    next = body.links?.next ?? null
  }

  return { snapshots, has_more: Boolean(next) }
}

async function updateContactsFromKlaviyoProfiles(
  db: { raw<T = unknown>(query: string, params?: unknown[]): Promise<T[]> },
  snapshots: KlaviyoContactSnapshot[],
): Promise<{ matched: number; updated: number }> {
  if (snapshots.length === 0) return { matched: 0, updated: 0 }
  const rows = await db.raw<{ matched: string; updated: string }>(
    `WITH payload AS (
       SELECT *
         FROM jsonb_to_recordset($1::jsonb) AS x(
           klaviyo_profile_id text,
           email text,
           first_name text,
           last_name text,
           phone text,
           locale text,
           klaviyo_subscribed boolean,
           klaviyo_suppressed boolean,
           klaviyo_synced_at timestamptz
         )
     ),
     matched AS (
       SELECT DISTINCT ON (c.id)
              c.id,
              p.klaviyo_profile_id,
              p.first_name,
              p.last_name,
              p.phone,
              p.locale,
              p.klaviyo_subscribed,
              p.klaviyo_suppressed,
              p.klaviyo_synced_at
         FROM payload p
         JOIN contacts c
           ON c.deleted_at IS NULL
          AND (
            c.klaviyo_profile_id = p.klaviyo_profile_id
            OR LOWER(c.email) = LOWER(p.email)
          )
        ORDER BY c.id, CASE WHEN c.klaviyo_profile_id = p.klaviyo_profile_id THEN 0 ELSE 1 END
     ),
     updated AS (
       UPDATE contacts c
          SET klaviyo_profile_id = m.klaviyo_profile_id,
              first_name = COALESCE(c.first_name, m.first_name),
              last_name = COALESCE(c.last_name, m.last_name),
              phone = COALESCE(c.phone, m.phone),
              locale = COALESCE(NULLIF(c.locale, ''), m.locale, c.locale),
              klaviyo_subscribed = CASE
                WHEN m.klaviyo_subscribed IS NULL THEN c.klaviyo_subscribed
                ELSE m.klaviyo_subscribed
              END,
              klaviyo_suppressed = CASE
                WHEN m.klaviyo_suppressed IS NULL THEN c.klaviyo_suppressed
                ELSE m.klaviyo_suppressed
              END,
              klaviyo_synced_at = m.klaviyo_synced_at,
              updated_at = NOW()
         FROM matched m
        WHERE c.id = m.id
        RETURNING c.id
     )
     SELECT
       (SELECT COUNT(*)::text FROM matched) AS matched,
       (SELECT COUNT(*)::text FROM updated) AS updated`,
    [
      JSON.stringify(
        snapshots.map((snapshot) => ({
          ...snapshot,
          klaviyo_synced_at: snapshot.klaviyo_synced_at.toISOString(),
        })),
      ),
    ],
  )
  return { matched: Number(rows[0]?.matched ?? 0), updated: Number(rows[0]?.updated ?? 0) }
}

export default defineCommand({
  name: 'syncKlaviyoEvents',
  description: 'Mirror abandonment-flow Klaviyo events from PostHog DW into local klaviyo_events table',
  input: z.object({
    fullRefresh: z.boolean().default(false),
  }),
  workflow: async (input, { step, log }) => {
    // ── 1. High-water mark via service ───────────────────────────────
    let sinceMs: number
    if (input.fullRefresh) {
      sinceMs = Date.now() - FALLBACK_LOOKBACK_MS
    } else {
      // step.service runtime exposes one service per ENTITY (not per module),
      // even when the entity lives in a multi-entity module. So KlaviyoEvent
      // is `(step.service as unknown as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>).klaviyoEvent`, not `step.service.contact`.
      const latest = (await (
        step.service as unknown as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>
      ).klaviyoEvent.listKlaviyoEvents({}, { order: { occurred_at: 'DESC' }, take: 1 })) as Array<{
        occurred_at?: Date | string | null
      }>
      const maxAt = latest[0]?.occurred_at ? new Date(latest[0].occurred_at).getTime() : null
      sinceMs = maxAt ? maxAt - OVERLAP_MS : Date.now() - FALLBACK_LOOKBACK_MS
    }
    const sinceIso = new Date(sinceMs).toISOString()
    log.info(`[syncKlaviyoEvents] since=${sinceIso} fullRefresh=${input.fullRefresh}`)

    // ── 2. Pull from PostHog DW (compensable network step) ───────────
    const events = await step.action('pull-klaviyo-events', {
      invoke: async (_i: unknown, ctx) =>
        pullEventsFromHogQL({
          sinceIso,
          signal: ctx.signal,
          warn: (msg) => log.warn(msg),
        }),
      compensate: async () => {
        // Read-only on PostHog, idempotent locally — no compensation.
      },
    })({})

    const eventsForUpsert = events

    // ── 3. Bulk upsert via service (klaviyoEvent has its own service +
    //     custom upsertWithReplace exposed in entities/klaviyo-event/service.ts).
    //     Klaviyo events are immutable; replaceFields=[] = ON CONFLICT DO
    //     update only `updated_at` — functionally a DO NOTHING for our reads.
    const upserted =
      eventsForUpsert.length > 0
        ? ((await (
            step.service as unknown as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>
          ).klaviyoEvent.upsertWithReplace(
            eventsForUpsert as unknown as Record<string, unknown>[],
            [],
            ['klaviyo_event_id'],
          )) as Array<{ id: string }>)
        : []

    const scanned = events.length
    const inserted = upserted.length

    // ── 4. Mark matching carts as klaviyo-notified (no-op if already set).
    //     We pass the FULL event batch (not just the upserted ones) so a
    //     re-run that finds zero new events for an already-ingested email
    //     still marks the cart on the first pass after the cart was created.
    //     The helper's IS-NULL select clause guarantees idempotence.
    const markRes =
      events.length > 0
        ? await step.action('mark-carts-from-klaviyo', {
            invoke: async () => {
              const stepSvcAny = step.service as unknown as Record<
                string,
                Record<string, (...args: unknown[]) => Promise<unknown>>
              >
              const cartRepo: CartMarkingRepo = {
                // biome-ignore lint/suspicious/noExplicitAny: $-prefixed Manta filter operators not in entity type
                list: (where) => stepSvcAny.cart.listCarts(where as any) as Promise<never>,
                update: (patch) => stepSvcAny.cart.updateCarts(patch),
              }
              return markCartsFromKlaviyoEvents(events, cartRepo, log)
            },
            compensate: async () => {
              // Marking is idempotent and a side-effect on our own DB — no useful
              // compensation. Re-running the command is the natural recovery.
            },
          })({})
        : { carts_marked_klaviyo: 0, carts_skipped_already_notified: 0 }

    const latestProfiles = (await (
      step.service as unknown as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>
    ).contact.listContacts(
      { klaviyo_synced_at: { $notnull: true } },
      {
        order: { klaviyo_synced_at: 'DESC' },
        take: 1,
      },
    )) as Array<{ klaviyo_synced_at?: Date | string | null }>
    const profileSinceIso = profileSince(latestProfiles[0]?.klaviyo_synced_at)
    const profiles = await step.action('pull-klaviyo-profiles', {
      invoke: async (_i: unknown, ctx) =>
        pullProfilesFromKlaviyo({
          sinceIso: profileSinceIso,
          signal: ctx.signal,
          warn: (msg) => log.warn(msg),
        }),
      compensate: async () => {
        // Read-only on Klaviyo; local update below is idempotent.
      },
    })({})
    const profileUpdate = await step.action('update-contacts-from-klaviyo-profiles', {
      invoke: async (_i: unknown, ctx) => {
        const db = ctx.app.resolve('IDatabasePort') as
          | { raw<T = unknown>(query: string, params?: unknown[]): Promise<T[]> }
          | undefined
        if (!db) throw new MantaError('UNEXPECTED_STATE', 'No database configured')
        return updateContactsFromKlaviyoProfiles(db, profiles.snapshots)
      },
      compensate: async () => {},
    })({})

    log.info(
      `[syncKlaviyoEvents] scanned=${scanned} inserted≈${inserted} skipped=${scanned - inserted} carts_marked_klaviyo=${markRes.carts_marked_klaviyo} carts_skipped_already_notified=${markRes.carts_skipped_already_notified} profiles_scanned=${profiles.snapshots.length} profiles_updated=${profileUpdate.updated} profiles_has_more=${profiles.has_more}`,
    )
    return {
      scanned,
      inserted,
      skipped: scanned - inserted,
      carts_marked_klaviyo: markRes.carts_marked_klaviyo,
      profiles_scanned: profiles.snapshots.length,
      profiles_matched: profileUpdate.matched,
      profiles_updated: profileUpdate.updated,
      profiles_missing_local_contact: profiles.snapshots.length - profileUpdate.matched,
      profiles_has_more: profiles.has_more,
    } satisfies IngestResult
  },
})
