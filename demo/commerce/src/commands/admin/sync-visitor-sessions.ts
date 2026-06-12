// Command: continuous PostHog -> visitor_sessions snapshot sync.
//
// PostHog remains the raw event log. This command only folds recent events
// carrying (distinct_id, $session_id) into the local visitor_sessions snapshot.
// It complements the live posthog-cart-tracker subscriber for events that reach
// PostHog directly or arrive while the app is redeploying.

import { type HogQLEventRow, rowToPosthogEvent } from '../../modules/cart-tracking/posthog-sync'
import { extractSessionId } from '../../modules/visitor-session/attribution'
import { posthogPrivateKey, runPosthogHogQL } from '../../utils/posthog-query'

type RawDb = {
  raw<T = unknown>(query: string, params?: unknown[]): Promise<T[]>
}

const MAX_EVENTS_PER_RUN = 5000
const DEFAULT_LOOKBACK_MINUTES = 15

export default defineCommand({
  name: 'syncVisitorSessions',
  description: 'Fold recent PostHog session events into visitor_sessions without storing raw events locally',
  input: z.object({
    lookbackMinutes: z.number().min(1).max(1440).optional(),
  }),
  workflow: async (input, { step, log }) => {
    const key = posthogPrivateKey()
    if (!key) {
      throw new MantaError('INVALID_STATE', 'POSTHOG_API_KEY is required for syncVisitorSessions')
    }

    return await step.action('sync-visitor-sessions', {
      invoke: async (_i: unknown, ctx) => {
        const db = ctx.app.resolve('IDatabasePort') as RawDb | undefined
        if (!db) throw new MantaError('UNEXPECTED_STATE', 'No database configured')

        const startedAt = Date.now()
        const lookbackMinutes = input.lookbackMinutes ?? DEFAULT_LOOKBACK_MINUTES
        const latestRows = await db.raw<{ max_ts: Date | string | null }>(
          `SELECT MAX(last_event_at) AS max_ts FROM visitor_sessions`,
        )
        const latest = latestRows[0]?.max_ts ? new Date(latestRows[0].max_ts) : null
        const since = latest
          ? new Date(latest.getTime() - lookbackMinutes * 60 * 1000)
          : new Date(Date.now() - 24 * 60 * 60 * 1000)
        const sinceIso = since.toISOString()

        log.info(`[syncVisitorSessions] starting — since=${sinceIso} lookbackMinutes=${lookbackMinutes}`)

        const hogql = `SELECT uuid, event, distinct_id, timestamp, properties
                         FROM events
                        WHERE timestamp > toDateTime('${sinceIso}')
                          AND distinct_id IS NOT NULL
                          AND properties.$session_id IS NOT NULL
                        ORDER BY timestamp ASC, uuid ASC
                        LIMIT ${MAX_EVENTS_PER_RUN}`

        const rows = (await runPosthogHogQL(hogql, {
          privateKey: key,
          signal: ctx.signal,
        })) as unknown as HogQLEventRow[]

        let attempted = 0
        let skipped = 0
        let errors = 0
        for (const row of rows) {
          if (ctx.signal?.aborted) break

          const evt = rowToPosthogEvent(row)
          const sessionId = extractSessionId(evt)
          if (!sessionId || !evt.distinct_id) {
            skipped += 1
            continue
          }

          const props = evt.properties ?? {}
          const $set = (props.$set as Record<string, unknown> | undefined) ?? {}
          const emailOnEvent = ($set.email as string | undefined) ?? null

          try {
            attempted += 1
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
            errors += 1
            if (errors < 10) {
              log.warn(
                `[syncVisitorSessions] upsertVisitorSessionFromEvent failed for ${evt.event} (${evt.uuid}): ${(err as Error).message}`,
              )
            }
          }
        }

        if (ctx.signal?.aborted) {
          throw new MantaError('CONFLICT', 'syncVisitorSessions cancelled', { code: 'WORKFLOW_CANCELLED' })
        }

        const finalRows = await db.raw<{ max_ts: Date | string | null }>(
          `SELECT MAX(last_event_at) AS max_ts FROM visitor_sessions`,
        )
        const durationMs = Date.now() - startedAt
        const maxAt = finalRows[0]?.max_ts ? new Date(finalRows[0].max_ts).toISOString() : null

        log.info(
          `[syncVisitorSessions] done — fetched=${rows.length} attempted=${attempted} skipped=${skipped} errors=${errors} maxAt=${maxAt ?? 'none'} duration_ms=${durationMs}`,
        )

        return {
          fetched: rows.length,
          attempted,
          skipped,
          errors,
          since: sinceIso,
          max_at: maxAt,
          duration_ms: durationMs,
        }
      },
      compensate: async () => {
        // upsertVisitorSessionFromEvent is idempotent per event_uuid/session.
      },
    })({})
  },
})
