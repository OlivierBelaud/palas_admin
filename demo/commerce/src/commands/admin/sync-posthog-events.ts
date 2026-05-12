// Command: continuous PostHog -> carts sync (5-min cron).
//
// PostHog is the source of truth for events. The `cart` snapshot table
// holds the folded state. The subscriber catches what flows through our
// proxy in real time; this loop rescues anything that reaches PostHog
// directly from the storefront (or that we lose to a redeploy /
// throttle).
//
// Strategy:
//   1. Read per-class high-water marks from `cart.last_action_at`:
//      MAX where last_action LIKE 'cart:%' and MAX where 'checkout:%'.
//      Per-class (not global) because the cart:viewed firehose races
//      ahead of checkout:* (Shopify Web Pixel emits checkouts 1–3 min
//      after the cart event), so a single global mark would silently
//      swallow completed checkouts.
//   2. HogQL: pull every cart:* / checkout:* event with timestamp
//      strictly greater than its class mark, ordered ASC, capped at
//      5 000 events / run.
//   3. Normalise via `posthog-sync` helper and dispatch through
//      `step.command.ingestCartEvent`. Errors are counted, not thrown.
//
// Idempotence: ingestCartEvent upserts the cart row by token (+
// distinct_id fallback) and merges monotonically — replaying overlap is
// safe.

import type { RawDb } from '../../modules/cart-tracking/apply-event'
import { type HogQLEventRow, ingestHogQLRows, rowToPosthogEvent } from '../../modules/cart-tracking/posthog-sync'
import { extractSessionId } from '../../modules/visitor-session/attribution'

const MAX_EVENTS_PER_RUN = 5000

export default defineCommand({
  name: 'syncPosthogEvents',
  description: 'Pull recent cart/checkout events from PostHog and dispatch ingestCartEvent for each',
  input: z.object({}),
  workflow: async (_input, { step, log }) => {
    const host = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
    const key = process.env.POSTHOG_API_KEY
    if (!key) {
      throw new MantaError('INVALID_STATE', 'POSTHOG_API_KEY is required for syncPosthogEvents')
    }

    return await step.action('sync-posthog-events', {
      invoke: async (_i: unknown, ctx) => {
        const db = ctx.app.infra.db as RawDb | undefined
        if (!db) throw new MantaError('UNEXPECTED_STATE', 'No database configured')

        const startedAt = Date.now()

        // ── 1. Resolve high-water marks — one per event class ─────────
        // Source: the `carts` snapshot (PostHog itself is the event log;
        // `carts.last_action / last_action_at` is the deepest event that
        // has already been folded in). Per-class marks because the
        // cart:viewed firehose races ahead of checkout:* — a single
        // global MAX would silently swallow completed checkouts.
        const maxRows = await db.raw<{ kind: string; max_ts: Date | null }>(
          `SELECT CASE WHEN last_action LIKE 'cart:%' THEN 'cart' ELSE 'checkout' END AS kind,
                  MAX(last_action_at) AS max_ts
             FROM carts
            WHERE last_action LIKE 'cart:%' OR last_action LIKE 'checkout:%'
            GROUP BY 1`,
        )
        const toIso = (ts: Date | null | undefined): string | null =>
          ts ? (ts instanceof Date ? ts.toISOString() : String(ts)) : null
        const cartSinceIso = toIso(maxRows.find((r) => r.kind === 'cart')?.max_ts)
        const checkoutSinceIso = toIso(maxRows.find((r) => r.kind === 'checkout')?.max_ts)

        const cartClause = cartSinceIso
          ? `(event LIKE 'cart:%' AND timestamp > toDateTime('${cartSinceIso}'))`
          : `event LIKE 'cart:%'`
        const checkoutClause = checkoutSinceIso
          ? `(event LIKE 'checkout:%' AND timestamp > toDateTime('${checkoutSinceIso}'))`
          : `event LIKE 'checkout:%'`

        log.info(
          `[syncPosthogEvents] starting — cartSince=${cartSinceIso ?? 'genesis'} checkoutSince=${checkoutSinceIso ?? 'genesis'}`,
        )

        // ── 2. HogQL query ────────────────────────────────────────────
        const hogql = `SELECT uuid, event, distinct_id, timestamp, properties
                         FROM events
                        WHERE ${cartClause} OR ${checkoutClause}
                        ORDER BY timestamp ASC
                        LIMIT ${MAX_EVENTS_PER_RUN}`

        const res = await fetch(`${host}/api/projects/@current/query/`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: { kind: 'HogQLQuery', query: hogql } }),
          signal: ctx.signal,
        })
        if (!res.ok) {
          throw new MantaError('UNEXPECTED_STATE', `PostHog HogQL ${res.status} ${await res.text().catch(() => '')}`)
        }
        const data = (await res.json()) as { results?: unknown[][] }
        // PostHog returns each row as `[uuid, event, distinct_id, timestamp, properties]`.
        // The HogQL query above selects exactly those 5 columns so the tuple shape is
        // guaranteed at runtime — go through `unknown` to satisfy the strict tuple type.
        const rows = (data.results ?? []) as unknown as HogQLEventRow[]

        log.info(`[syncPosthogEvents] HogQL returned ${rows.length} event(s)`)

        // ── 3. Dispatch each event through ingestCartEvent ────────────
        const counters = await ingestHogQLRows(rows, {
          ingest: (input) => step.command.ingestCartEvent(input),
          warn: (msg) => log.warn(`[syncPosthogEvents] ${msg}`),
          shouldStop: () => ctx.signal?.aborted ?? false,
        })

        // ── 3b. Sibling visitor-session dispatch ─────────────────────
        // Iterate the SAME rows and dispatch upsertVisitorSessionFromEvent
        // for every event carrying $session_id + distinct_id. Idempotent
        // via the per-session seen_event_uuids[] FIFO array, so re-runs
        // (overlapping high-water marks, retries) are safe.
        //
        // V1 limitation: the HogQL query above pulls only `cart:%` and
        // `checkout:%` events. `$pageview` events are not in the cron
        // path — their session counters come from the live subscriber
        // only. Until V2 widens the query, sessions without proxy
        // traffic will under-count pageviews. See backlog VS-FU-01.
        let sessionsAttempted = 0
        let sessionsSkipped = 0
        let sessionsErrors = 0
        for (const row of rows) {
          if (ctx.signal?.aborted) break
          const evt = rowToPosthogEvent(row)
          const sessionId = extractSessionId(evt)
          if (!sessionId || !evt.distinct_id) {
            sessionsSkipped += 1
            continue
          }
          const props = evt.properties ?? {}
          const $set = (props.$set as Record<string, unknown> | undefined) ?? {}
          const emailOnEvent = ($set.email as string | undefined) ?? null
          try {
            sessionsAttempted += 1
            // biome-ignore lint/suspicious/noExplicitAny: command registry is dynamically typed
            await (step.command as any).upsertVisitorSessionFromEvent({
              distinct_id: evt.distinct_id,
              session_id: sessionId,
              event_uuid: evt.uuid,
              event_name: evt.event,
              occurred_at: evt.timestamp,
              email_on_event: emailOnEvent,
              current_url: (props.$current_url as string | undefined) ?? null,
              utm_source: (props.utm_source as string | undefined) ?? null,
              utm_medium: (props.utm_medium as string | undefined) ?? null,
              utm_campaign: (props.utm_campaign as string | undefined) ?? null,
              referring_domain: (props.$referring_domain as string | undefined) ?? null,
            })
          } catch (err) {
            sessionsErrors += 1
            if (sessionsErrors < 10) {
              log.warn(
                `[syncPosthogEvents] upsertVisitorSessionFromEvent failed for ${evt.event} (${evt.uuid}): ${(err as Error).message}`,
              )
            }
          }
        }

        // Translate "stopped early because of cancel" into the canonical
        // MantaError the workflow runner expects. We detect cancellation
        // from `ctx.signal.aborted` (the ingestHogQLRows helper itself
        // never throws — it stops the loop and returns partial counters).
        if (ctx.signal?.aborted) {
          throw new MantaError('CONFLICT', 'syncPosthogEvents cancelled', { code: 'WORKFLOW_CANCELLED' })
        }

        const durationMs = Date.now() - startedAt

        // Re-read marks after ingest so logs reflect actual progress per class.
        const finalRows = await db.raw<{ kind: string; max_ts: Date | null }>(
          `SELECT CASE WHEN last_action LIKE 'cart:%' THEN 'cart' ELSE 'checkout' END AS kind,
                  MAX(last_action_at) AS max_ts
             FROM carts
            WHERE last_action LIKE 'cart:%' OR last_action LIKE 'checkout:%'
            GROUP BY 1`,
        )
        const cartFinalIso = toIso(finalRows.find((r) => r.kind === 'cart')?.max_ts)
        const checkoutFinalIso = toIso(finalRows.find((r) => r.kind === 'checkout')?.max_ts)

        log.info(
          `[syncPosthogEvents] done — fetched=${rows.length} ingested=${counters.ingested} skipped=${counters.skipped} errors=${counters.errors} sessions_attempted=${sessionsAttempted} sessions_skipped=${sessionsSkipped} sessions_errors=${sessionsErrors} duration_ms=${durationMs} cartMark=${cartSinceIso ?? 'genesis'}→${cartFinalIso ?? 'genesis'} checkoutMark=${checkoutSinceIso ?? 'genesis'}→${checkoutFinalIso ?? 'genesis'}`,
        )

        return {
          fetched: rows.length,
          ingested: counters.ingested,
          skipped: counters.skipped,
          errors: counters.errors,
          sessions_attempted: sessionsAttempted,
          sessions_skipped: sessionsSkipped,
          sessions_errors: sessionsErrors,
          duration_ms: durationMs,
          cart_since: cartSinceIso,
          checkout_since: checkoutSinceIso,
        }
      },
      compensate: async () => {
        // ingestCartEvent is idempotent at the cart row level. The cron is
        // a safety net so partial progress is fine — the next tick resumes
        // from the new MAX(last_action_at) per class.
      },
    })
  },
})
