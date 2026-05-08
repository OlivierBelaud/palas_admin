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

type RawDb = { raw: <T>(sql: string, params?: unknown[]) => Promise<T[]> }

const POSTHOG_HOST = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
const HOGQL_LIMIT = 5000
const FALLBACK_LOOKBACK_MS = 365 * 86400 * 1000

interface IngestResult {
  scanned: number
  inserted: number
  skipped: number
}

export default defineCommand({
  name: 'syncKlaviyoEvents',
  description: 'Mirror abandonment-flow Klaviyo events from PostHog DW into local klaviyo_events table',
  input: z.object({
    fullRefresh: z.boolean().default(false),
  }),
  workflow: async (input, { step, log }) => {
    return await step.action('sync-klaviyo-events', {
      invoke: async (_i: unknown, ctx) => {
        const db = ctx.app.infra.db as RawDb | undefined
        if (!db) throw new MantaError('UNEXPECTED_STATE', 'No database configured')

        const phKey = process.env.POSTHOG_API_KEY
        if (!phKey) {
          log.warn('[sync-klaviyo-events] POSTHOG_API_KEY missing — skip')
          return { scanned: 0, inserted: 0, skipped: 0 } as IngestResult
        }

        // High-water mark: most recent occurred_at we already have, minus 1h
        // overlap to be safe against race conditions / event publishing lag.
        let sinceMs: number
        if (input.fullRefresh) {
          sinceMs = Date.now() - FALLBACK_LOOKBACK_MS
        } else {
          const rows = await db.raw<{ max_at: Date | null }>('SELECT MAX(occurred_at) AS max_at FROM klaviyo_events')
          const maxAt = rows[0]?.max_at ? new Date(rows[0].max_at).getTime() : null
          sinceMs = maxAt ? maxAt - 3600 * 1000 : Date.now() - FALLBACK_LOOKBACK_MS
        }
        const sinceIso = new Date(sinceMs).toISOString()
        log.info(`[sync-klaviyo-events] since=${sinceIso} fullRefresh=${input.fullRefresh}`)

        let totalScanned = 0
        let totalInserted = 0
        let totalSkipped = 0
        let offset = 0

        while (true) {
          if (ctx.signal?.aborted) break

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
            WHERE ke.datetime >= toDateTime64('${sinceIso}', 6)
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

          const res = await fetch(`${POSTHOG_HOST}/api/projects/@current/query/`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${phKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: { kind: 'HogQLQuery', query: sql }, refresh: 'force_blocking' }),
            signal: ctx.signal,
          })
          if (!res.ok) {
            log.warn(`[sync-klaviyo-events] HogQL ${res.status} — abort`)
            break
          }
          const data = (await res.json()) as { results?: unknown[][] }
          const rows = data.results ?? []
          if (rows.length === 0) break

          // Dedup by klaviyo_event_id within the batch (HogQL can return dups
          // from join cardinality on edge cases).
          const seen = new Set<string>()
          const batch: Array<{
            klaviyo_event_id: string
            email: string
            metric: string
            subject: string | null
            checkout_token: string | null
            occurred_at: Date
            synced_at: Date
          }> = []
          for (const r of rows) {
            const row = r as Array<unknown>
            const id = String(row[0] ?? '').trim()
            const email = String(row[1] ?? '')
              .trim()
              .toLowerCase()
            const metric = String(row[2] ?? '').trim()
            const subjectRaw = row[3]
            const tokenRaw = row[4]
            const occurredAtStr = String(row[5] ?? '').trim()
            if (!id || !email || !metric || !occurredAtStr || seen.has(id)) continue
            seen.add(id)
            const occurredAt = new Date(occurredAtStr)
            if (Number.isNaN(occurredAt.getTime())) continue
            batch.push({
              klaviyo_event_id: id,
              email,
              metric,
              subject: typeof subjectRaw === 'string' && subjectRaw.length > 0 ? subjectRaw : null,
              checkout_token: typeof tokenRaw === 'string' && tokenRaw.length > 0 ? tokenRaw : null,
              occurred_at: occurredAt,
              synced_at: new Date(),
            })
          }

          totalScanned += rows.length

          if (batch.length === 0) {
            offset += rows.length
            if (rows.length < HOGQL_LIMIT) break
            continue
          }

          // Bulk upsert: if klaviyo_event_id exists, do nothing (events are
          // immutable). Use ON CONFLICT DO NOTHING + reflect actual inserts.
          const placeholders = batch
            .map((_, i) => {
              const j = i * 7
              return `($${j + 1}, $${j + 2}, $${j + 3}, $${j + 4}, $${j + 5}, $${j + 6}, $${j + 7})`
            })
            .join(',')
          const params: unknown[] = []
          for (const b of batch) {
            params.push(b.klaviyo_event_id, b.email, b.metric, b.subject, b.checkout_token, b.occurred_at, b.synced_at)
          }
          const inserted = await db.raw<{ id: string }>(
            `INSERT INTO klaviyo_events (klaviyo_event_id, email, metric, subject, checkout_token, occurred_at, synced_at)
             VALUES ${placeholders}
             ON CONFLICT (klaviyo_event_id) DO NOTHING
             RETURNING id`,
            params,
          )
          totalInserted += inserted.length
          totalSkipped += batch.length - inserted.length

          offset += rows.length
          if (rows.length < HOGQL_LIMIT) break
        }

        log.info(`[sync-klaviyo-events] scanned=${totalScanned} inserted=${totalInserted} skipped=${totalSkipped}`)
        return { scanned: totalScanned, inserted: totalInserted, skipped: totalSkipped } as IngestResult
      },
      compensate: async () => {
        // Sync is read-only on the upstream side and idempotent locally. No
        // compensation — re-run on next tick if it fails.
      },
    })({})
  },
})
