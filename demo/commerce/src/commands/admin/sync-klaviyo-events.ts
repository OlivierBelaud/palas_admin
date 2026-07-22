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

import { posthogPrivateKey, runPosthogHogQL } from '../../utils/posthog-query'
import { buildKlaviyoAbandonmentHogqlPredicate } from '../../utils/klaviyo-abandonment-contract'
import {
  markKlaviyoProjectionSyncFailed,
  markKlaviyoProjectionSyncSucceeded,
  startKlaviyoProjectionSyncAttempt,
  type KlaviyoSyncAttempt,
} from '../../utils/klaviyo-projection-state'
import { resolveSql } from '../../utils/manta-runtime'
import { type CartMarkingRepo, markCartsFromKlaviyoEvents } from '../../utils/sync-klaviyo-events-mark-helper'

const HOGQL_LIMIT = 5000
const FALLBACK_LOOKBACK_MS = 365 * 86400 * 1000
const OVERLAP_MS = 3600 * 1000 // 1h overlap to absorb Klaviyo eventual consistency

function hogqlDateString(iso: string): string {
  return iso.slice(0, 19)
}

interface IngestResult {
  scanned: number
  inserted: number
  skipped: number
  carts_marked_klaviyo: number
  projection_fence: KlaviyoSyncAttempt
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

export async function pullEventsFromHogQL(args: {
  sinceIso: string
  throughIso: string
  signal?: AbortSignal
  warn: (msg: string) => void
}): Promise<KlaviyoEventRow[]> {
  const phKey = posthogPrivateKey()
  if (!phKey) {
    throw new Error('POSTHOG_API_KEY missing')
  }

  const out: KlaviyoEventRow[] = []
  const seen = new Set<string>()
  let offset = 0

  while (true) {
    if (args.signal?.aborted) throw new Error('Klaviyo projection sync aborted')

    const subjectExpression = "JSONExtractString(ke.event_properties, 'Subject')"
    const abandonmentPredicate = buildKlaviyoAbandonmentHogqlPredicate('km.name', subjectExpression)
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
        AND ke.datetime <= '${hogqlDateString(args.throughIso)}'
        AND lower(kp.email) != ''
        AND ${abandonmentPredicate}
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
      throw err
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

export default defineCommand({
  name: 'syncKlaviyoEvents',
  description: 'Mirror abandonment-flow Klaviyo events from PostHog DW into local klaviyo_events table',
  input: z.object({
    fullRefresh: z.boolean().default(false),
  }),
  workflow: async (input, { step, log }) => {
    const recordProjection = async (
      actionName: string,
      update: (sql: NonNullable<ReturnType<typeof resolveSql>>) => Promise<void>,
    ): Promise<void> => {
      await step.action(actionName, {
        invoke: async (_i: unknown, ctx) => {
          const sql = resolveSql(ctx.app)
          if (!sql) throw new Error('Database port missing for Klaviyo projection watermark')
          await update(sql)
        },
        compensate: async () => {},
      })({})
    }
    // These values are created and returned inside the checkpointed step. A
    // WorkflowManager replay therefore consumes the exact generation/bounds
    // that were persisted, instead of inventing a new outer token.
    const syncAttempt = await step.action('start-klaviyo-projection-sync', {
      invoke: async (_i: unknown, ctx) => {
        const sql = resolveSql(ctx.app)
        if (!sql) throw new Error('Database port missing for Klaviyo projection watermark')
        return startKlaviyoProjectionSyncAttempt(sql)
      },
      compensate: async () => {},
    })({})
    const attemptedAt = new Date(syncAttempt.attemptedAtIso)

    // ── 1. High-water mark via service ───────────────────────────────
    let sinceMs: number
    try {
      if (input.fullRefresh) {
        sinceMs = attemptedAt.getTime() - FALLBACK_LOOKBACK_MS
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
        sinceMs =
          maxAt && Number.isFinite(maxAt) ? maxAt - OVERLAP_MS : attemptedAt.getTime() - FALLBACK_LOOKBACK_MS
      }
    } catch (error) {
      await recordProjection('fail-klaviyo-projection-high-water', (sql) =>
        markKlaviyoProjectionSyncFailed(sql, syncAttempt, new Date(), error),
      )
      throw error
    }
    const sinceIso = new Date(sinceMs).toISOString()
    log.info(`[syncKlaviyoEvents] since=${sinceIso} fullRefresh=${input.fullRefresh}`)

    // ── 2. Pull from PostHog DW (compensable network step) ───────────
    let events: KlaviyoEventRow[]
    try {
      events = await step.action('pull-klaviyo-events', {
        invoke: async (_i: unknown, ctx) =>
          pullEventsFromHogQL({
            sinceIso,
            throughIso: syncAttempt.throughIso,
            signal: ctx.signal,
            warn: (msg) => log.warn(msg),
          }),
        compensate: async () => {
          // Read-only on PostHog, idempotent locally — no compensation.
        },
      })({})
    } catch (error) {
      await recordProjection('fail-klaviyo-projection-pull', (sql) =>
        markKlaviyoProjectionSyncFailed(sql, syncAttempt, new Date(), error),
      )
      throw error
    }

    if (events.length === 0) {
      await recordProjection('complete-empty-klaviyo-projection-sync', (sql) =>
        markKlaviyoProjectionSyncSucceeded(sql, syncAttempt, new Date()),
      )
      log.info('[syncKlaviyoEvents] no new events')
      return {
        scanned: 0,
        inserted: 0,
        skipped: 0,
        carts_marked_klaviyo: 0,
        projection_fence: syncAttempt,
      } satisfies IngestResult
    }

    const eventsForUpsert = events

    // ── 3. Bulk upsert via service (klaviyoEvent has its own service +
    //     custom upsertWithReplace exposed in entities/klaviyo-event/service.ts).
    //     Klaviyo events are immutable; replaceFields=[] = ON CONFLICT DO
    //     update only `updated_at` — functionally a DO NOTHING for our reads.
    let upserted: Array<{ id: string }>
    try {
      upserted = (await (
        step.service as unknown as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>
      ).klaviyoEvent.upsertWithReplace(
        eventsForUpsert as unknown as Record<string, unknown>[],
        [],
        ['klaviyo_event_id'],
      )) as Array<{ id: string }>
    } catch (error) {
      await recordProjection('fail-klaviyo-projection-upsert', (sql) =>
        markKlaviyoProjectionSyncFailed(sql, syncAttempt, new Date(), error),
      )
      throw error
    }

    const scanned = events.length
    const inserted = upserted.length

    // ── 4. Mark matching carts as klaviyo-notified (no-op if already set).
    //     We pass the FULL event batch (not just the upserted ones) so a
    //     re-run that finds zero new events for an already-ingested email
    //     still marks the cart on the first pass after the cart was created.
    //     The helper's IS-NULL select clause guarantees idempotence.
    let markRes: Awaited<ReturnType<typeof markCartsFromKlaviyoEvents>>
    try {
      markRes = await step.action('mark-carts-from-klaviyo', {
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
    } catch (error) {
      await recordProjection('fail-klaviyo-projection-cart-marking', (sql) =>
        markKlaviyoProjectionSyncFailed(sql, syncAttempt, new Date(), error),
      )
      throw error
    }

    await recordProjection('complete-klaviyo-projection-sync', (sql) =>
      markKlaviyoProjectionSyncSucceeded(sql, syncAttempt, new Date()),
    )

    log.info(
      `[syncKlaviyoEvents] scanned=${scanned} inserted≈${inserted} skipped=${scanned - inserted} carts_marked_klaviyo=${markRes.carts_marked_klaviyo} carts_skipped_already_notified=${markRes.carts_skipped_already_notified}`,
    )
    return {
      scanned,
      inserted,
      skipped: scanned - inserted,
      carts_marked_klaviyo: markRes.carts_marked_klaviyo,
      projection_fence: syncAttempt,
    } satisfies IngestResult
  },
})
