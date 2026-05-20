// One-shot backfill — replay 90 days of PostHog event history through
// `planSessionUpsert` to hydrate the local `visitor_sessions` table.
//
// Three things make this script different from `backfill-cart-birth-at.ts`:
//   1. Per-event chronological processing — we walk events ASC and let the
//      pure planner accumulate state. Order matters: the FIRST event of
//      `(distinct_id, session_id)` freezes attribution + segment.
//   2. In-memory session map — we keep already-built sessions for the
//      current run so subsequent events for the same session hit the
//      planner's "existingSession" branch directly. Avoids one
//      `SELECT visitor_sessions` per event.
//   3. Batched contact lookup — every distinct_id in the page is resolved
//      to `(contact_id, first_order_at)` in ONE query before iterating.
//      Subsequent pages reuse the cache.
//
// Apply path: raw SQL UPSERT against `visitor_sessions` with conflict
// target `(distinct_id, session_id)`. Frozen fields are NOT in DO UPDATE
// SET — they keep their initial INSERT values, matching the service-path
// `replaceFields` semantics from upsert-session.ts.
//
// Idempotence:
//   - `seen_event_uuids[]` in the planner skips counter increments on
//     re-runs (capped FIFO 200).
//   - The cohort pass at the end is guarded by `vs.cart_converted = false`.
//   - Re-running the full script produces the same end state.
//
// Run with:
//   pnpm exec tsx scripts/backfill-visitor-sessions.ts            # local, dry-run by default
//   pnpm exec tsx scripts/backfill-visitor-sessions.ts --prod     # Neon prod, dry-run by default
//   pnpm exec tsx scripts/backfill-visitor-sessions.ts --prod --apply
//   pnpm exec tsx scripts/backfill-visitor-sessions.ts --days 30 --prod --apply
//
// `--dry-run` is the DEFAULT to match the plan's safety stance.
// Pass `--apply` (NOT --no-dry-run) to actually write.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { parsePosthogProperties } from '../src/modules/cart-tracking/posthog-sync'
import {
  type ExistingSession,
  type IdentityAtStart,
  planSessionUpsert,
  type SessionSegment,
} from '../src/modules/visitor-session/upsert-session'

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

const args = process.argv.slice(2)
const useProd = args.includes('--prod')
// Default to dry-run for safety; `--apply` flips it.
const dryRun = !args.includes('--apply')
function readNumberFlag(name: string, fallback: number): number {
  const idx = args.indexOf(name)
  if (idx === -1) return fallback
  const raw = args[idx + 1]
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : fallback
}
const DAYS = readNumberFlag('--days', 90)

loadEnv('.env', false)
const localPosthogPersonalKey = process.env.POSTHOG_PERSONAL_API_KEY
const localPosthogKey = process.env.POSTHOG_API_KEY
if (useProd) {
  loadEnv('.env.production', true)
  if (localPosthogPersonalKey) process.env.POSTHOG_PERSONAL_API_KEY = localPosthogPersonalKey
  if (localPosthogKey) process.env.POSTHOG_API_KEY = localPosthogKey
}

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL missing')
  process.exit(1)
}
const PH_HOST = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
const PH_KEY = process.env.POSTHOG_PERSONAL_API_KEY ?? process.env.POSTHOG_API_KEY
if (!PH_KEY) {
  console.error('[backfill-visitor-sessions] missing POSTHOG_PERSONAL_API_KEY / POSTHOG_API_KEY env')
  process.exit(1)
}

const needsSsl = useProd || /neon\.tech/.test(DATABASE_URL)
const sql = postgres(DATABASE_URL, { ssl: needsSsl ? 'require' : undefined, max: 4, prepare: false })

const PAGE = 10000

async function hogql(query: string, retries = 8): Promise<unknown[][]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${PH_HOST}/api/projects/@current/query/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${PH_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
      })
      if (!res.ok) {
        const txt = await res.text()
        if (res.status === 429 || res.status >= 500) {
          const wait = 5000 * (attempt + 1)
          console.log(`  HogQL ${res.status} retry ${attempt + 1}/${retries} in ${wait}ms`)
          await new Promise((r) => setTimeout(r, wait))
          continue
        }
        throw new Error(`HogQL ${res.status} ${txt}`)
      }
      const data = (await res.json()) as { results?: unknown[][] }
      return data.results ?? []
    } catch (e) {
      const code = (e as { code?: string; cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code
      if (code === 'EADDRNOTAVAIL' || code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'UND_ERR_SOCKET') {
        const wait = 5000 * (attempt + 1)
        console.log(`  network ${code} retry ${attempt + 1}/${retries} in ${wait}ms`)
        await new Promise((r) => setTimeout(r, wait))
        continue
      }
      throw e
    }
  }
  throw new Error('HogQL retries exhausted')
}

interface HogQLRow {
  uuid: string
  event: string
  distinct_id: string | null
  timestamp: string
  properties: Record<string, unknown>
  person_email: string | null
}

function decodeRow(row: unknown[]): HogQLRow | null {
  const [uuid, event, distinctId, timestamp, props, personEmail] = row
  if (typeof event !== 'string' || typeof timestamp !== 'string') return null
  let properties: Record<string, unknown>
  try {
    properties = parsePosthogProperties(props)
  } catch {
    return null
  }
  return {
    uuid: String(uuid ?? ''),
    event,
    distinct_id: distinctId == null ? null : String(distinctId),
    timestamp,
    properties,
    person_email: typeof personEmail === 'string' && personEmail.length > 0 ? personEmail : null,
  }
}

interface ContactInfo {
  contact_id: string
  first_order_at: Date | null
}

/** Fetch contact info for a batch of distinct_ids. Cached across pages. */
async function batchLookupContacts(distinctIds: string[], cache: Map<string, ContactInfo | null>): Promise<void> {
  const toFetch = distinctIds.filter((d) => !cache.has(d))
  if (toFetch.length === 0) return
  const rows = (await sql.unsafe(
    `SELECT id, distinct_id, first_order_at
       FROM contacts
      WHERE distinct_id = ANY($1::text[])`,
    [toFetch],
  )) as Array<{ id: string; distinct_id: string; first_order_at: Date | null }>
  const found = new Set<string>()
  for (const r of rows) {
    cache.set(r.distinct_id, {
      contact_id: r.id,
      first_order_at: r.first_order_at,
    })
    found.add(r.distinct_id)
  }
  // Negative-cache misses so we don't re-query next page.
  for (const d of toFetch) {
    if (!found.has(d)) cache.set(d, null)
  }
}

function deriveIdentity(
  distinctId: string,
  occurredAtIso: string,
  contacts: Map<string, ContactInfo | null>,
): IdentityAtStart {
  const info = contacts.get(distinctId) ?? null
  if (!info) return { contact_id: null, email: null, segment: 'unknown' }
  const occurredAt = new Date(occurredAtIso).getTime()
  const firstOrderAt = info.first_order_at ? new Date(info.first_order_at).getTime() : null
  let segment: SessionSegment = 'known_no_purchase'
  if (firstOrderAt != null && firstOrderAt < occurredAt) segment = 'returning_customer'
  return { contact_id: info.contact_id, email: null, segment }
}

interface SessionState extends ExistingSession {
  // In-memory state mirrors the DB row exactly — same shape so the planner
  // treats it as `existingSession`.
}

const SINCE_ISO = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString()

/** Single-row UPSERT against visitor_sessions. */
async function upsertSession(row: ReturnType<typeof planSessionUpsert>['row']): Promise<void> {
  await sql.unsafe(
    `INSERT INTO visitor_sessions
       (id, distinct_id, session_id, started_at, last_event_at, pageviews_count,
        email_at_session_start, email_at_session_end, contact_id,
        segment_at_session_start, first_url, utm_source, utm_medium, utm_campaign,
        referring_domain, is_paid_session, carts_viewed_in_session, carts_created_in_session,
        carts_updated_in_session, cart_converted, order_id,
        became_customer_in_session, became_customer_at,
        email_acquired_in_session, email_acquired_via, email_acquired_at, seen_event_uuids,
        created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5,
             $6, $7, $8,
             $9, $10, $11, $12, $13,
             $14, $15, $16, $17,
             $18, $19, $20,
             $21, $22,
             $23, $24, $25, $26::jsonb,
             NOW(), NOW())
     ON CONFLICT (distinct_id, session_id) DO UPDATE SET
       last_event_at = EXCLUDED.last_event_at,
       email_at_session_end = EXCLUDED.email_at_session_end,
       pageviews_count = EXCLUDED.pageviews_count,
       carts_viewed_in_session = EXCLUDED.carts_viewed_in_session,
       carts_created_in_session = EXCLUDED.carts_created_in_session,
       carts_updated_in_session = EXCLUDED.carts_updated_in_session,
       email_acquired_in_session = EXCLUDED.email_acquired_in_session,
       email_acquired_via = EXCLUDED.email_acquired_via,
       email_acquired_at = EXCLUDED.email_acquired_at,
       seen_event_uuids = EXCLUDED.seen_event_uuids,
       updated_at = NOW()`,
    [
      row.distinct_id,
      row.session_id,
      row.started_at,
      row.last_event_at,
      row.pageviews_count,
      row.email_at_session_start,
      row.email_at_session_end,
      row.contact_id,
      row.segment_at_session_start,
      row.first_url,
      row.utm_source,
      row.utm_medium,
      row.utm_campaign,
      row.referring_domain,
      row.is_paid_session,
      row.carts_viewed_in_session,
      row.carts_created_in_session,
      row.carts_updated_in_session,
      row.cart_converted,
      row.order_id,
      row.became_customer_in_session,
      row.became_customer_at,
      row.email_acquired_in_session,
      row.email_acquired_via,
      row.email_acquired_at,
      row.seen_event_uuids != null ? JSON.stringify(row.seen_event_uuids) : null,
    ],
  )
}

try {
  console.log(
    `[backfill-visitor-sessions] target: ${useProd ? 'PROD' : 'LOCAL'}  dryRun: ${dryRun}  days: ${DAYS}  since: ${SINCE_ISO}`,
  )
  if (!dryRun) {
    await sql.unsafe(
      `ALTER TABLE visitor_sessions ADD COLUMN IF NOT EXISTS carts_viewed_in_session integer NOT NULL DEFAULT 0`,
    )
    await sql.unsafe(
      `ALTER TABLE visitor_sessions ADD COLUMN IF NOT EXISTS became_customer_in_session boolean NOT NULL DEFAULT false`,
    )
    await sql.unsafe(`ALTER TABLE visitor_sessions ADD COLUMN IF NOT EXISTS became_customer_at timestamp`)
    await sql.unsafe(`ALTER TABLE visitor_sessions ADD COLUMN IF NOT EXISTS email_acquired_at timestamp`)
    await sql.unsafe(
      `CREATE INDEX IF NOT EXISTS visitor_sessions_became_customer_idx
         ON visitor_sessions(became_customer_in_session) WHERE became_customer_in_session = true`,
    )
  }
  const t0 = Date.now()

  // ── In-memory caches (preserved across pages) ───────────────────────
  // sessionState maps `${distinct_id}|${session_id}` → ExistingSession.
  // contactCache maps distinct_id → ContactInfo|null (null = miss).
  const sessionState = new Map<string, SessionState>()
  const contactCache = new Map<string, ContactInfo | null>()

  let offset = 0
  let totalRead = 0
  let totalProcessed = 0
  let totalSkippedNoSession = 0
  let totalSkippedNoDistinct = 0
  let totalDropped = 0
  let totalWrites = 0

  while (true) {
    const raws = await hogql(`
      SELECT uuid, event, distinct_id, timestamp, properties, person.properties.email
        FROM events
       WHERE timestamp >= toDateTime('${SINCE_ISO}')
         AND (event LIKE 'cart:%' OR event LIKE 'checkout:%' OR event = '$identify' OR event = '$pageview')
       ORDER BY timestamp ASC
       LIMIT ${PAGE} OFFSET ${offset}
    `)
    if (raws.length === 0) break
    totalRead += raws.length

    // ── Batch contact lookup for this page ─────────────────────────
    const distinctIdsThisPage = new Set<string>()
    for (const r of raws) {
      const decoded = decodeRow(r)
      if (decoded?.distinct_id) distinctIdsThisPage.add(decoded.distinct_id)
    }
    await batchLookupContacts([...distinctIdsThisPage], contactCache)

    for (const raw of raws) {
      const decoded = decodeRow(raw)
      if (!decoded) {
        totalDropped += 1
        continue
      }
      if (!decoded.distinct_id) {
        totalSkippedNoDistinct += 1
        continue
      }
      const sessionId = (() => {
        const sid = decoded.properties.$session_id
        return typeof sid === 'string' && sid.length > 0 ? sid : null
      })()
      if (!sessionId) {
        totalSkippedNoSession += 1
        continue
      }

      // ── Extract event_uuid + email_on_event + attribution props ──
      const props = decoded.properties
      const $set = (props.$set as Record<string, unknown> | undefined) ?? {}
      const emailOnEvent = (() => {
        const direct = $set.email
        if (typeof direct === 'string' && direct.length > 0) return direct
        const checkout = props.checkout as { email?: unknown } | undefined
        if (checkout && typeof checkout.email === 'string' && checkout.email.length > 0) return checkout.email
        if (decoded.person_email) return decoded.person_email
        return null
      })()
      const currentUrl = (props.$current_url as string | undefined) ?? null
      const utmSource = (props.utm_source as string | undefined) ?? null
      const utmMedium = (props.utm_medium as string | undefined) ?? null
      const utmCampaign = (props.utm_campaign as string | undefined) ?? null
      const referringDomain = (props.$referring_domain as string | undefined) ?? null

      const key = `${decoded.distinct_id}|${sessionId}`
      const existing = sessionState.get(key)

      const identityAtStart = existing
        ? {
            contact_id: existing.contact_id,
            email: existing.email_at_session_start,
            segment: existing.segment_at_session_start,
          }
        : deriveIdentity(decoded.distinct_id, decoded.timestamp, contactCache)

      const intent = planSessionUpsert({
        event: {
          distinct_id: decoded.distinct_id,
          session_id: sessionId,
          event_uuid: decoded.uuid || null,
          event_name: decoded.event,
          occurred_at: decoded.timestamp,
          email_on_event: emailOnEvent,
          current_url: currentUrl,
          utm_source: utmSource,
          utm_medium: utmMedium,
          utm_campaign: utmCampaign,
          referring_domain: referringDomain,
        },
        existingSession: existing,
        identityAtStart,
      })

      // Update in-memory state so the NEXT event for this session sees the
      // accumulator the planner just produced. The shape matches ExistingSession.
      const nextState: SessionState = {
        // Fabricate an id for the in-memory map; on real DB conflict the
        // DB row keeps its own id and we don't read it back here.
        id: existing?.id ?? '__memory__',
        started_at: intent.row.started_at,
        last_event_at: intent.row.last_event_at,
        pageviews_count: intent.row.pageviews_count,
        email_at_session_start: intent.row.email_at_session_start,
        email_at_session_end: intent.row.email_at_session_end,
        contact_id: intent.row.contact_id,
        segment_at_session_start: intent.row.segment_at_session_start,
        first_url: intent.row.first_url,
        utm_source: intent.row.utm_source,
        utm_medium: intent.row.utm_medium,
        utm_campaign: intent.row.utm_campaign,
        referring_domain: intent.row.referring_domain,
        is_paid_session: intent.row.is_paid_session,
        carts_created_in_session: intent.row.carts_created_in_session,
        carts_viewed_in_session: intent.row.carts_viewed_in_session,
        carts_updated_in_session: intent.row.carts_updated_in_session,
        cart_converted: intent.row.cart_converted,
        order_id: intent.row.order_id,
        became_customer_in_session: intent.row.became_customer_in_session,
        became_customer_at: intent.row.became_customer_at,
        email_acquired_in_session: intent.row.email_acquired_in_session,
        email_acquired_via: intent.row.email_acquired_via,
        email_acquired_at: intent.row.email_acquired_at,
        seen_event_uuids: intent.row.seen_event_uuids,
      }
      sessionState.set(key, nextState)
      totalProcessed += 1

      if (!dryRun) {
        await upsertSession(intent.row)
        totalWrites += 1
      }
    }

    console.log(
      `  page offset=${offset}: read=${raws.length} processed=${totalProcessed} sessionsTouched=${sessionState.size} noSession=${totalSkippedNoSession} noDistinct=${totalSkippedNoDistinct} dropped=${totalDropped}`,
    )

    offset += raws.length
    if (raws.length < PAGE) break
  }

  // ── Cohort pass: mark conversions ──────────────────────────────────
  let cohortUpdated = 0
  if (!dryRun) {
    const rows = (await sql.unsafe(
      `UPDATE visitor_sessions vs
          SET cart_converted = true,
              order_id = c.shopify_order_id,
              became_customer_in_session = (vs.segment_at_session_start <> 'returning_customer'),
              became_customer_at = CASE
                WHEN vs.segment_at_session_start <> 'returning_customer' THEN c.completed_at
                ELSE NULL
              END,
              updated_at = NOW()
         FROM carts c
         JOIN orders o ON o.shopify_order_id = c.shopify_order_id
        WHERE c.highest_stage = 'completed'
          AND o.include_in_ecommerce_analytics = true
          AND c.distinct_id = vs.distinct_id
          AND c.cart_birth_at >= vs.started_at
          AND c.cart_birth_at <= vs.last_event_at + INTERVAL '30 minutes'
          AND vs.cart_converted = false
        RETURNING vs.id`,
    )) as Array<{ id: string }>
    cohortUpdated = rows.length
  } else {
    console.log('  (dry-run: skipping cohort UPDATE — run with --apply to write)')
  }

  console.log(`\n=== DONE in ${Math.round((Date.now() - t0) / 1000)}s ===`)
  console.log(`events read:           ${totalRead}`)
  console.log(`events processed:      ${totalProcessed}`)
  console.log(`sessions touched:      ${sessionState.size}`)
  console.log(`session upserts:       ${totalWrites}`)
  console.log(`cohort rows updated:   ${cohortUpdated}`)
  console.log(`skipped (no session):  ${totalSkippedNoSession}`)
  console.log(`skipped (no distinct): ${totalSkippedNoDistinct}`)
  console.log(`dropped (bad row):     ${totalDropped}`)
  if (dryRun) {
    console.log(`\n(dry-run — no rows written. Pass --apply to commit.)`)
  }
} catch (err) {
  console.error('FAILED:', err)
  process.exitCode = 1
} finally {
  await sql.end()
}
