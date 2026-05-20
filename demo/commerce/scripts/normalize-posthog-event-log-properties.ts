// Repair posthog_event_log rows where `properties` is a JSONB string
// containing JSON instead of a JSONB object.
//
// Safe/idempotent:
//   - dry-run by default
//   - only updates rows where jsonb_typeof(properties) = 'string'
//   - leaves malformed strings untouched and reports them

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const here = dirname(fileURLToPath(import.meta.url))

function loadEnv(rel: string, override: boolean): void {
  const full = resolve(here, '..', rel)
  try {
    for (const line of readFileSync(full, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      if (override || !process.env[m[1]]) process.env[m[1]] = m[2]
    }
  } catch {
    // ignore
  }
}

const args = process.argv.slice(2)
const useProd = args.includes('--prod')
const dryRun = !args.includes('--apply')

loadEnv('.env', false)
if (useProd) loadEnv('.env.production', true)

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL missing')
  process.exit(1)
}

const sql = postgres(DATABASE_URL, {
  ssl: useProd || /neon\.tech/.test(DATABASE_URL) ? 'require' : undefined,
  max: 2,
  prepare: false,
})

function parseJsonString(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

try {
  console.log(`[normalize-posthog-event-log-properties] target=${useProd ? 'PROD' : 'LOCAL'} dryRun=${dryRun}`)
  const before = await sql.unsafe<
    {
      typ: string | null
      count: string
      max_ts: Date | null
    }[]
  >(`SELECT jsonb_typeof(properties) typ, COUNT(*)::text count, MAX(event_timestamp) max_ts
        FROM posthog_event_log
       GROUP BY 1
       ORDER BY 2 DESC`)
  console.log('before:', before)

  let lastTs: string | null = null
  let lastUuid: string | null = null
  let scanned = 0
  let repaired = 0
  let malformed = 0

  while (true) {
    const params: string[] = []
    let where = `WHERE jsonb_typeof(properties) = 'string'`
    if (lastTs && lastUuid) {
      params.push(lastTs, lastUuid)
      where += ` AND (event_timestamp, posthog_uuid) > ($1::timestamptz, $2)`
    }
    const rows = await sql.unsafe<
      {
        posthog_uuid: string
        event_timestamp: Date
        properties: string
      }[]
    >(
      `SELECT posthog_uuid, event_timestamp, properties #>> '{}' AS properties
         FROM posthog_event_log
        ${where}
        ORDER BY event_timestamp ASC, posthog_uuid ASC
        LIMIT 500`,
      params,
    )
    if (rows.length === 0) break

    for (const row of rows) {
      lastTs = row.event_timestamp instanceof Date ? row.event_timestamp.toISOString() : String(row.event_timestamp)
      lastUuid = row.posthog_uuid
      scanned += 1
      const parsed = parseJsonString(row.properties)
      if (!parsed) {
        malformed += 1
        continue
      }
      if (!dryRun) {
        await sql.unsafe(
          `UPDATE posthog_event_log
              SET properties = (properties #>> '{}')::jsonb
            WHERE posthog_uuid = $1
              AND jsonb_typeof(properties) = 'string'`,
          [row.posthog_uuid],
        )
      }
      repaired += 1
    }
  }

  console.log({ scanned, repaired: dryRun ? 0 : repaired, repairable: repaired, malformed })
  const after = await sql.unsafe<
    {
      typ: string | null
      count: string
      max_ts: Date | null
    }[]
  >(`SELECT jsonb_typeof(properties) typ, COUNT(*)::text count, MAX(event_timestamp) max_ts
        FROM posthog_event_log
       GROUP BY 1
       ORDER BY 2 DESC`)
  console.log('after:', after)
  if (dryRun) console.log('(dry-run — pass --apply to write)')
} catch (err) {
  console.error('FAILED:', err)
  process.exitCode = 1
} finally {
  await sql.end()
}
