// One-shot backfill — pull 365 days of abandonment-flow Klaviyo events from
// PostHog DW into the local klaviyo_events table. Same filter as the
// syncKlaviyoEvents command (kept inline for one-shot independence).
//
// Run with:
//   pnpm exec tsx scripts/backfill-klaviyo-events.ts --prod

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const here = dirname(fileURLToPath(import.meta.url))

function loadEnv(rel: string, override: boolean): void {
  const full = resolve(here, '..', rel)
  try {
    const raw = readFileSync(full, 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      if (override || !process.env[m[1]]) process.env[m[1]] = m[2]
    }
  } catch {
    // ignore
  }
}

const useProd = process.argv.includes('--prod')
loadEnv('.env', false)
if (useProd) loadEnv('.env.production', true)

const DATABASE_URL = process.env.DATABASE_URL!
const PH_HOST = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
process.env.POSTHOG_API_KEY ?? process.env.POSTHOG_PERSONAL_API_KEY ?? ''

const needsSsl = useProd || /neon\.tech/.test(DATABASE_URL)
const sql = postgres(DATABASE_URL, { ssl: needsSsl ? 'require' : undefined, max: 4, prepare: false })

async function hogql(query: string): Promise<unknown[][]> {
  const res = await fetch(`${PH_HOST}/api/projects/@current/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PH_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query }, refresh: 'force_blocking' }),
  })
  if (!res.ok) throw new Error(`HogQL ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { results?: unknown[][] }
  return data.results ?? []
}

const PAGE = 5000

try {
  console.log(`[backfill-klaviyo-events] target: ${useProd ? 'PROD' : 'LOCAL'}`)
  const t0 = Date.now()
  let offset = 0
  let totalInserted = 0
  let totalScanned = 0

  while (true) {
    const rows = await hogql(`
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
      WHERE lower(kp.email) != ''
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
      LIMIT ${PAGE} OFFSET ${offset}
    `)
    if (rows.length === 0) break
    totalScanned += rows.length

    // Dedup within batch
    const seen = new Set<string>()
    const batch = rows
      .map((r) => {
        const row = r as Array<unknown>
        const id = String(row[0] ?? '').trim()
        if (!id || seen.has(id)) return null
        seen.add(id)
        const email = String(row[1] ?? '')
          .trim()
          .toLowerCase()
        const metric = String(row[2] ?? '').trim()
        const subjectRaw = row[3]
        const tokenRaw = row[4]
        const occurredAtStr = String(row[5] ?? '').trim()
        if (!email || !metric || !occurredAtStr) return null
        const occurredAt = new Date(occurredAtStr)
        if (Number.isNaN(occurredAt.getTime())) return null
        return {
          klaviyo_event_id: id,
          email,
          metric,
          subject: typeof subjectRaw === 'string' && subjectRaw.length > 0 ? subjectRaw : null,
          checkout_token: typeof tokenRaw === 'string' && tokenRaw.length > 0 ? tokenRaw : null,
          occurred_at: occurredAt,
          synced_at: new Date(),
        }
      })
      .filter((b): b is NonNullable<typeof b> => b !== null)

    if (batch.length === 0) {
      offset += rows.length
      if (rows.length < PAGE) break
      continue
    }

    const inserted = await sql<{ id: string }[]>`
      INSERT INTO klaviyo_events ${sql(batch)}
      ON CONFLICT (klaviyo_event_id) DO NOTHING
      RETURNING id
    `
    totalInserted += inserted.length
    console.log(`  scanned ${totalScanned} | inserted ${totalInserted} (offset ${offset})`)

    offset += rows.length
    if (rows.length < PAGE) break
  }

  console.log(`\n=== DONE in ${Math.round((Date.now() - t0) / 1000)}s ===`)
  console.log(`scanned: ${totalScanned}`)
  console.log(`inserted: ${totalInserted}`)
  const [{ n }] = await sql<{ n: string }[]>`SELECT COUNT(*)::text AS n FROM klaviyo_events`
  console.log(`klaviyo_events total: ${n}`)
} catch (err) {
  console.error('FAILED:', err)
  process.exitCode = 1
} finally {
  await sql.end()
}
