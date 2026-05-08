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

const POSTHOG_HOST = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
const HOGQL_LIMIT = 5000
const FALLBACK_LOOKBACK_MS = 365 * 86400 * 1000
const OVERLAP_MS = 3600 * 1000 // 1h overlap to absorb Klaviyo eventual consistency

interface IngestResult {
  scanned: number
  inserted: number
  skipped: number
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

async function pullEventsFromHogQL(args: {
  sinceIso: string
  signal?: AbortSignal
  warn: (msg: string) => void
}): Promise<KlaviyoEventRow[]> {
  const phKey = process.env.POSTHOG_API_KEY
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
      WHERE ke.datetime >= toDateTime64('${args.sinceIso}', 6)
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
      signal: args.signal,
    })
    if (!res.ok) {
      args.warn(`[sync-klaviyo-events] HogQL ${res.status} — abort`)
      break
    }
    const data = (await res.json()) as { results?: unknown[][] }
    const rows = data.results ?? []
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

    if (events.length === 0) {
      log.info('[syncKlaviyoEvents] no new events')
      return { scanned: 0, inserted: 0, skipped: 0 } satisfies IngestResult
    }

    // step.action persists its output as JSON, so Date fields come back as
    // ISO strings — re-hydrate before handing them to Drizzle.
    const eventsForUpsert = events.map((e) => ({
      ...e,
      occurred_at: e.occurred_at instanceof Date ? e.occurred_at : new Date(e.occurred_at as unknown as string),
      synced_at: e.synced_at instanceof Date ? e.synced_at : new Date(e.synced_at as unknown as string),
    }))

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
    log.info(`[syncKlaviyoEvents] scanned=${scanned} inserted≈${inserted} skipped=${scanned - inserted}`)
    return { scanned, inserted, skipped: scanned - inserted } satisfies IngestResult
  },
})
