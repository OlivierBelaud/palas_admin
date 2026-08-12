// Command: pull abandonment-flow events directly from Klaviyo into the
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
  isKlaviyoCartOrCheckoutEmail,
  pullAbandonEventsFromKlaviyo,
} from '../../utils/klaviyo-abandon-event-sync'
import { type CartMarkingRepo, markCartsFromKlaviyoEvents } from '../../utils/sync-klaviyo-events-mark-helper'

const FALLBACK_LOOKBACK_MS = 365 * 86400 * 1000
const OVERLAP_MS = 3600 * 1000 // 1h overlap to absorb Klaviyo eventual consistency
const MAX_EVENT_WINDOW_MS = 6 * 3600 * 1000

interface IngestResult {
  scanned: number
  inserted: number
  skipped: number
  carts_marked_klaviyo: number
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

async function pullEventsFromKlaviyo(args: {
  sinceIso: string
  untilIso: string
  signal?: AbortSignal
}): Promise<KlaviyoEventRow[]> {
  const key = process.env.KLAVIYO_API_KEY
  if (!key) throw new MantaError('INVALID_STATE', 'KLAVIYO_API_KEY is required to sync Klaviyo events')
  return pullAbandonEventsFromKlaviyo({
    apiKey: key,
    sinceIso: args.sinceIso,
    untilIso: args.untilIso,
    host: process.env.KLAVIYO_HOST,
    revision: process.env.KLAVIYO_API_REVISION,
    signal: args.signal,
  })
}

export default defineCommand({
  name: 'syncKlaviyoEvents',
  description: 'Mirror abandonment-flow events directly from Klaviyo into local klaviyo_events table',
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
    const untilIso = new Date(Math.min(Date.now(), sinceMs + MAX_EVENT_WINDOW_MS)).toISOString()
    log.info(`[syncKlaviyoEvents] since=${sinceIso} until=${untilIso} fullRefresh=${input.fullRefresh}`)

    // ── 2. Pull directly from Klaviyo (compensable network step) ─────
    const events = await step.action('pull-klaviyo-events', {
      invoke: async (_i: unknown, ctx) =>
        pullEventsFromKlaviyo({
          sinceIso,
          untilIso,
          signal: ctx.signal,
        }),
      compensate: async () => {
        // Read-only on Klaviyo, idempotent locally — no compensation.
      },
    })({})

    if (events.length === 0) {
      log.info('[syncKlaviyoEvents] no new events')
      return { scanned: 0, inserted: 0, skipped: 0, carts_marked_klaviyo: 0 } satisfies IngestResult
    }

    const eventsForUpsert = events

    // ── 3. Bulk upsert via service (klaviyoEvent has its own service +
    //     custom upsertWithReplace exposed in entities/klaviyo-event/service.ts).
    //     Klaviyo events are immutable; replaceFields=[] = ON CONFLICT DO
    //     update only `updated_at` — functionally a DO NOTHING for our reads.
    const upserted = (await (
      step.service as unknown as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>
    ).klaviyoEvent.upsertWithReplace(
      eventsForUpsert as unknown as Record<string, unknown>[],
      [],
      ['klaviyo_event_id'],
    )) as Array<{ id: string }>

    const scanned = events.length
    const inserted = upserted.length

    // ── 4. Mark matching carts as klaviyo-notified (no-op if already set).
    //     We pass the FULL event batch (not just the upserted ones) so a
    //     re-run that finds zero new events for an already-ingested email
    //     still marks the cart on the first pass after the cart was created.
    //     The helper's IS-NULL select clause guarantees idempotence.
    const markRes = await step.action('mark-carts-from-klaviyo', {
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
        return markCartsFromKlaviyoEvents(events.filter(isKlaviyoCartOrCheckoutEmail), cartRepo, log)
      },
      compensate: async () => {
        // Marking is idempotent and a side-effect on our own DB — no useful
        // compensation. Re-running the command is the natural recovery.
      },
    })({})

    log.info(
      `[syncKlaviyoEvents] scanned=${scanned} inserted≈${inserted} skipped=${scanned - inserted} carts_marked_klaviyo=${markRes.carts_marked_klaviyo} carts_skipped_already_notified=${markRes.carts_skipped_already_notified}`,
    )
    return {
      scanned,
      inserted,
      skipped: scanned - inserted,
      carts_marked_klaviyo: markRes.carts_marked_klaviyo,
    } satisfies IngestResult
  },
})
