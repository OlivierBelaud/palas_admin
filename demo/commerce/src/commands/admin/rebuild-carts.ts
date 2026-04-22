// Command: rebuild the carts snapshot table from PostHog events.
// Wipes carts + cart_events, replays all cart/checkout events we've ever
// seen through the same upsert logic as ingestCartEvent.
//
// Decomposed into 3 steps per WORKFLOW_PROGRESS.md §11:
//   1. fetch-events   — incremental HogQL reads (only events we don't have
//                       yet) + UPSERT into the durable event log.
//   2. replay-events  — SELECT the full event log in batches and apply to
//                       carts.
//   3. persist-stats  — final summary counts.
//
// Why `posthog_event_log` (durable accumulating copy of PostHog cart/checkout
// events, deduped on PostHog's own UUID):
//   * Neon's TCP pooler caps query payloads at 64 MB — holding the full event
//     set in a checkpoint between steps 1 and 2 blew that limit as soon as
//     raw `properties` got verbose.
//   * Idempotent by design: each rebuild only fetches events we haven't seen
//     yet (WHERE timestamp > max(event_timestamp), then INSERT ... ON
//     CONFLICT DO NOTHING on PostHog's uuid).
//   * A subsequent "rebuild a single cart" action becomes a filter on
//     cart_token in the log — no PostHog roundtrip needed.
//   * When we're confident the live ingestion never drifts, this whole log
//     can be dropped; for now it's a cheap safety net + debug buffer.
//
// Compensation is documented as no-op: the rebuild is destructive by design
// (step 2 wipes both tables at the start). The user accepts this trade-off;
// compensation logs a warning only.
//
// Event extraction goes through `normalizeCartEvent` so this command and the
// live subscriber share the exact same read semantics (v2 unified schema +
// v1 legacy fallback). Never inspect `evt.properties` directly here.

import { applyEvent, type PosthogEvent, type RawDb } from '../../modules/cart-tracking/apply-event'
import { enrichEventWithEmail, resolveEmailsBatch } from '../../modules/cart-tracking/identity-resolver'

const POSTHOG_PAGE_SIZE = 1000
const LOG_INSERT_BATCH = 200 // rows per multi-values INSERT — keeps payload well under Neon's 64 MB cap
const LOG_READ_BATCH = 500

// Cleanup: early iterations used a table called `posthog_event_staging` with
// a batch_id column. The durable, idempotent design replaces it with
// `posthog_event_log` keyed on PostHog's own uuid. DROP the obsolete table
// if it lingers from an older deploy.
const LOG_DROP_LEGACY_DDL = `DROP TABLE IF EXISTS posthog_event_staging`

const LOG_DDL = `
  CREATE TABLE IF NOT EXISTS posthog_event_log (
    posthog_uuid TEXT PRIMARY KEY,
    event_name TEXT NOT NULL,
    distinct_id TEXT,
    event_timestamp TIMESTAMPTZ NOT NULL,
    properties JSONB NOT NULL,
    inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`
const LOG_IDX_DDL = `
  CREATE INDEX IF NOT EXISTS idx_posthog_event_log_ts
    ON posthog_event_log(event_timestamp)
`

export default defineCommand({
  name: 'rebuildCarts',
  description: 'Wipe carts table and rebuild from PostHog event history',
  input: z.object({}),
  workflow: async (_input, { step, log }) => {
    // ── Step 1: fetch-events — incremental sync from PostHog ───────
    const fetchEvents = step.action('fetch-events', {
      invoke: async (_i: unknown, ctx): Promise<{ total: number; newlyInserted: number }> => {
        const host = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
        const key = process.env.POSTHOG_API_KEY
        if (!key) throw new MantaError('INVALID_STATE', 'POSTHOG_API_KEY is required')

        const db = ctx.app.resolve('IDatabasePort') as RawDb | undefined
        if (!db) throw new MantaError('UNEXPECTED_STATE', 'No database')

        // Bootstrap the log table (drops the legacy batch_id-scoped variant
        // from earlier iterations if it lingers). CREATE IF NOT EXISTS is
        // idempotent and atomic.
        await db.raw(LOG_DROP_LEGACY_DDL)
        await db.raw(LOG_DDL)
        await db.raw(LOG_IDX_DDL)

        // Incremental: fetch only events newer than whatever we've already
        // logged. On first run or after a migration, the max is null and we
        // fetch everything.
        const maxRows = await db.raw<{ max_ts: Date | null }>(
          'SELECT MAX(event_timestamp) AS max_ts FROM posthog_event_log',
        )
        const sinceTs = maxRows[0]?.max_ts
        const sinceIso = sinceTs ? (sinceTs instanceof Date ? sinceTs.toISOString() : String(sinceTs)) : null
        const sinceFilter = sinceIso ? ` AND timestamp > toDateTime('${sinceIso}')` : ''

        log.info(`[rebuildCarts] Syncing PostHog events (incremental from ${sinceIso ?? 'genesis'})...`)

        // Count ALL events in PostHog (for determinate progress bar) and
        // the subset we still need to fetch.
        const countRes = await fetch(`${host}/api/projects/@current/query/`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: {
              kind: 'HogQLQuery',
              query: `SELECT count() FROM events WHERE (event LIKE 'cart:%' OR event LIKE 'checkout:%')${sinceFilter}`,
            },
          }),
          signal: ctx.signal,
        })
        if (!countRes.ok) throw new MantaError('UNEXPECTED_STATE', `PostHog count ${countRes.status}`)
        const countData = (await countRes.json()) as { results?: unknown[][] }
        const newEventsInPosthog = Number(countData.results?.[0]?.[0] ?? 0) || 0
        log.info(`[rebuildCarts] PostHog has ${newEventsInPosthog} events to sync`)

        ctx.progress?.(0, newEventsInPosthog || null, `Syncing ${newEventsInPosthog} new events`)

        let newlyInserted = 0
        let offset = 0
        let page = 0
        while (newEventsInPosthog > 0) {
          if (ctx.signal?.aborted) {
            throw new MantaError('CONFLICT', 'Cancelled during fetch', { code: 'WORKFLOW_CANCELLED' })
          }

          const res = await fetch(`${host}/api/projects/@current/query/`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: {
                kind: 'HogQLQuery',
                query: `SELECT uuid, event, distinct_id, timestamp, properties FROM events WHERE (event LIKE 'cart:%' OR event LIKE 'checkout:%')${sinceFilter} ORDER BY timestamp ASC LIMIT ${POSTHOG_PAGE_SIZE} OFFSET ${offset}`,
              },
            }),
            signal: ctx.signal,
          })
          if (!res.ok) throw new MantaError('UNEXPECTED_STATE', `PostHog ${res.status}`)
          const data = (await res.json()) as { results?: unknown[][] }
          if (!data.results) throw new MantaError('UNEXPECTED_STATE', 'No results from PostHog')

          const batch = data.results.map(
            // biome-ignore lint/suspicious/noExplicitAny: PostHog row shape
            (row: any): PosthogEvent => ({
              uuid: String(row[0]),
              event: row[1] as string,
              distinct_id: (row[2] ?? null) as string | null,
              timestamp: row[3] as string,
              properties: typeof row[4] === 'string' ? JSON.parse(row[4]) : (row[4] ?? {}),
            }),
          )

          // Upsert each page into the log in sub-batches. Unique key on
          // `posthog_uuid` means redelivered events are silently skipped.
          for (let i = 0; i < batch.length; i += LOG_INSERT_BATCH) {
            const chunk = batch.slice(i, i + LOG_INSERT_BATCH)
            const placeholders: string[] = []
            const params: unknown[] = []
            for (let j = 0; j < chunk.length; j += 1) {
              const p = j * 5
              placeholders.push(`($${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}::jsonb)`)
              const evt = chunk[j]
              params.push(evt.uuid, evt.event, evt.distinct_id, evt.timestamp, JSON.stringify(evt.properties))
            }
            const rows = await db.raw<{ inserted: number }>(
              `INSERT INTO posthog_event_log (posthog_uuid, event_name, distinct_id, event_timestamp, properties)
               VALUES ${placeholders.join(', ')}
               ON CONFLICT (posthog_uuid) DO NOTHING
               RETURNING posthog_uuid`,
              params,
            )
            newlyInserted += rows.length
          }

          page += 1
          offset += batch.length

          ctx.progress?.(newlyInserted, newEventsInPosthog, `Synced ${newlyInserted}/${newEventsInPosthog} new events`)

          if (batch.length < POSTHOG_PAGE_SIZE) break
        }

        // Final total = rows currently in the log (what step 2 will replay).
        const totalRows = await db.raw<{ total: string }>('SELECT COUNT(*)::text AS total FROM posthog_event_log')
        const total = Number(totalRows[0]?.total ?? 0)

        log.info(`[rebuildCarts] Sync done — ${newlyInserted} new event(s) across ${page} page(s), log total=${total}`)

        return { total, newlyInserted }
      },
      compensate: async () => {
        // Log writes are idempotent — leaving a partially-synced log on
        // cancel is safe; the next run resumes from the new max timestamp.
      },
    })

    // ── Step 2: replay-events — apply events to carts table ────────
    const replayEvents = step.action('replay-events', {
      invoke: async (
        input: { total: number; newlyInserted: number },
        ctx,
      ): Promise<{
        rebuilt: number
        skipped: number
        errors: number
        identities_recovered: number
      }> => {
        const db = ctx.app.resolve('IDatabasePort') as RawDb | undefined
        if (!db) throw new MantaError('UNEXPECTED_STATE', 'No database')

        // Identity recovery — single HogQL query returning every known
        // distinct_id → person.properties.email pair for cart/checkout events.
        // PostHog's person_id_override_properties_on_events is best-effort; a
        // substantial fraction of cart events land with an empty $set but a
        // resolvable Person. We backfill here so the snapshot has the owner.
        ctx.progress?.(0, input.total, 'Resolving PostHog person identities...')
        const emailMap = await resolveEmailsBatch()
        log.info(`[rebuildCarts] Identity map: ${emailMap.size} distinct_id → email pairs from PostHog`)

        // Wipe cart snapshot tables. The durable event log is the source of
        // truth — this just tears down the derived view so we can rebuild it.
        await db.raw('DELETE FROM cart_events')
        await db.raw('DELETE FROM carts')
        log.info('[rebuildCarts] Snapshot tables wiped')

        let rebuilt = 0
        let skipped = 0
        let errors = 0
        let identitiesRecovered = 0
        let done = 0

        // Keyset-paginate through the entire event log in timestamp order.
        // `event_timestamp` is indexed; posthog_uuid is the tiebreaker.
        let lastTs: string | null = null
        let lastUuid: string | null = null
        while (true) {
          if (ctx.signal?.aborted) {
            throw new MantaError('CONFLICT', 'Cancelled during replay', { code: 'WORKFLOW_CANCELLED' })
          }
          const params: unknown[] = [LOG_READ_BATCH]
          let where = ''
          if (lastTs !== null && lastUuid !== null) {
            where = ' WHERE (event_timestamp, posthog_uuid) > ($2::timestamptz, $3)'
            params.push(lastTs, lastUuid)
          }
          const page = await db.raw<{
            posthog_uuid: string
            event_name: string
            distinct_id: string | null
            event_timestamp: Date
            properties: Record<string, unknown>
          }>(
            `SELECT posthog_uuid, event_name, distinct_id, event_timestamp, properties
               FROM posthog_event_log${where}
              ORDER BY event_timestamp ASC, posthog_uuid ASC
              LIMIT $1`,
            params,
          )
          if (page.length === 0) break

          for (const row of page) {
            const evt: PosthogEvent = {
              uuid: row.posthog_uuid,
              event: row.event_name,
              distinct_id: row.distinct_id,
              timestamp:
                row.event_timestamp instanceof Date ? row.event_timestamp.toISOString() : String(row.event_timestamp),
              properties: row.properties ?? {},
            }
            if (enrichEventWithEmail(evt, emailMap)) identitiesRecovered += 1
            const outcome = await applyEvent(db, evt, log, errors)
            if (outcome === 'rebuilt') rebuilt += 1
            else if (outcome === 'skipped') skipped += 1
            else errors += 1
            lastTs = evt.timestamp
            lastUuid = evt.uuid ?? row.posthog_uuid
            done += 1
          }

          ctx.progress?.(done, input.total, `Replayed ${done}/${input.total} events`)
        }

        log.info(`[rebuildCarts] Enriched ${identitiesRecovered} events with recovered email`)
        return { rebuilt, skipped, errors, identities_recovered: identitiesRecovered }
      },
      compensate: async (output) => {
        // Destructive by design — cannot roll back wiped + rebuilt carts (WP-F13).
        // We surface a structured warn so operators see the cart tables are in an
        // intermediate state after a cancelled/failed rebuild. No automatic repair
        // is possible — the only remedy is to re-run the workflow.
        log.warn(
          'Workflow cancelled after destructive operation — cart tables are in an intermediate state and require manual inspection or a full re-run',
          {
            step: 'replay-events',
            command: 'rebuildCarts',
            nonReversible: true,
            rebuilt: output.rebuilt,
            skipped: output.skipped,
            errors: output.errors,
          },
        )
      },
    })

    // ── Step 3: persist-stats — single summary SELECT ──────────────
    const persistStats = step.action('persist-stats', {
      invoke: async (
        input: { rebuilt: number; skipped: number; errors: number; identities_recovered: number },
        _ctx,
      ): Promise<{ rebuilt: number; skipped: number; errors: number; identities_recovered: number }> => {
        // Summary is derived from step 2's output — we simply forward it.
        // A separate step exists to match the plan's structure (fetch/replay/persist)
        // and give the UI a clear "finalisation" checkpoint.
        log.info(
          `[rebuildCarts] Done — rebuilt: ${input.rebuilt}, skipped: ${input.skipped}, errors: ${input.errors}, identities_recovered: ${input.identities_recovered}`,
        )
        return input
      },
      compensate: async () => {
        // No side-effects.
      },
    })

    // Orchestrate the 3 steps.
    const { total, newlyInserted } = await fetchEvents({})
    const replayResult = await replayEvents({ total, newlyInserted })
    const result = await persistStats(replayResult)
    return result
  },
})
