import type { RawDb } from '../cart-tracking/refresh-cart'

type Segment = 'unknown' | 'known_no_purchase' | 'returning_customer'

export interface LifecycleSessionFactSource {
  distinct_id: string
  started_at: Date | string
  last_event_at: Date | string | null
  segment_at_session_start: Segment
  contact_id?: string | null
  carts_viewed_in_session: number | null
  carts_created_in_session: number | null
  carts_updated_in_session: number | null
  cart_converted: boolean | null
  order_id: string | null
  became_customer_in_session: boolean | null
  email_acquired_in_session: boolean | null
}

export interface LifecycleActorDailyFactRow {
  day: string
  actor_key: string
  first_started_at: string
  segment_at_day_start: Segment
  sessions: number
  cart_viewed: boolean
  cart_initiated: boolean
  cart_updated: boolean
  converted: boolean
  converted_sessions: number
  became_known: boolean
  became_customer: boolean
  known_without_contact: boolean
  converted_without_order_id: boolean
  became_customer_without_contact: boolean
  order_ids: string[]
  computed_at: string
  source_last_event_at: string | null
}

export interface RefreshLifecycleFactsResult {
  from: string
  to: string
  days: number
  sessions: number
  facts: number
  duration_ms: number
}

const FACTS_TABLE = 'visitor_lifecycle_actor_daily_facts'
const DAYS_TABLE = 'visitor_lifecycle_day_snapshots'
const MS_PER_DAY = 86_400_000

export async function ensureLifecycleFactsTables(db: RawDb): Promise<void> {
  for (const statement of LIFECYCLE_FACTS_DDL) {
    await db.raw(statement)
  }
}

export async function refreshLifecycleFacts(
  db: RawDb,
  input: { from: Date; to: Date; onlyChanged?: boolean },
): Promise<RefreshLifecycleFactsResult> {
  const started = Date.now()
  await ensureLifecycleFactsTables(db)

  const from = startOfUtcDay(input.from)
  const to = startOfUtcDay(input.to)
  if (to.getTime() < from.getTime()) {
    throw new MantaError('INVALID_DATA', `refreshLifecycleFacts: invalid range ${input.from} -> ${input.to}`)
  }

  let totalSessions = 0
  let totalFacts = 0
  let days = 0
  for (const day of enumerateDays(from, to)) {
    const next = new Date(day.getTime() + MS_PER_DAY)
    const dayKey = toDayKey(day)
    // All source rows remain in PostgreSQL. The statement either publishes
    // the entire day and its ready snapshot, or changes nothing on failure.
    const rows = await db.raw<{ sessions: number; facts: number }>(REFRESH_DAY_SQL, [
      dayKey,
      day.toISOString(),
      next.toISOString(),
      input.onlyChanged === true,
    ])
    if (!rows.length) continue
    days += 1
    totalSessions += Number(rows[0].sessions)
    totalFacts += Number(rows[0].facts)
  }

  return {
    from: toDayKey(from),
    to: toDayKey(to),
    days,
    sessions: totalSessions,
    facts: totalFacts,
    duration_ms: Date.now() - started,
  }
}

export function buildLifecycleActorDailyFacts(
  sessions: LifecycleSessionFactSource[],
  day: string,
  computedAt: string,
): LifecycleActorDailyFactRow[] {
  const facts = new Map<string, LifecycleActorDailyFactRow>()
  const sorted = [...sessions].sort((a, b) => toMs(a.started_at) - toMs(b.started_at))

  for (const session of sorted) {
    const actorKey = session.distinct_id
    let fact = facts.get(actorKey)
    if (!fact) {
      fact = {
        day,
        actor_key: actorKey,
        first_started_at: toIso(session.started_at),
        segment_at_day_start: session.segment_at_session_start,
        sessions: 0,
        cart_viewed: false,
        cart_initiated: false,
        cart_updated: false,
        converted: false,
        converted_sessions: 0,
        became_known: false,
        became_customer: false,
        known_without_contact: false,
        converted_without_order_id: false,
        became_customer_without_contact: false,
        order_ids: [],
        computed_at: computedAt,
        source_last_event_at: session.last_event_at ? toIso(session.last_event_at) : null,
      }
      facts.set(actorKey, fact)
    }

    fact.sessions += 1
    fact.cart_viewed ||= count(session.carts_viewed_in_session) > 0
    fact.cart_initiated ||= count(session.carts_created_in_session) > 0
    fact.cart_updated ||= count(session.carts_updated_in_session) > 0
    fact.converted ||= session.cart_converted === true
    if (session.cart_converted === true) fact.converted_sessions += 1
    fact.became_known ||= session.email_acquired_in_session === true
    fact.became_customer ||= session.became_customer_in_session === true
    fact.known_without_contact ||= session.segment_at_session_start !== 'unknown' && !session.contact_id
    fact.converted_without_order_id ||= session.cart_converted === true && !session.order_id
    fact.became_customer_without_contact ||= session.became_customer_in_session === true && !session.contact_id
    if (session.order_id && !fact.order_ids.includes(session.order_id)) fact.order_ids.push(session.order_id)
    if (
      session.last_event_at &&
      (!fact.source_last_event_at || toMs(session.last_event_at) > toMs(fact.source_last_event_at))
    ) {
      fact.source_last_event_at = toIso(session.last_event_at)
    }
  }

  return [...facts.values()]
}

// Disjoint upsert/delete sets avoid modifying the same row twice in one CTE.
// Snapshot and facts share one PostgreSQL statement/transaction. No pooled
// BEGIN/COMMIT calls and no client-side parameter list proportional to actors.
const REFRESH_DAY_SQL = `
WITH source AS MATERIALIZED (
  SELECT distinct_id,started_at,last_event_at,segment_at_session_start,contact_id,
    carts_viewed_in_session,carts_created_in_session,carts_updated_in_session,cart_converted,
    order_id,became_customer_in_session,email_acquired_in_session,updated_at,deleted_at
  FROM visitor_sessions WHERE started_at >= $2::timestamptz AND started_at < $3::timestamptz
), version AS (
  SELECT MD5(COALESCE(STRING_AGG(TO_JSONB(source)::text, '' ORDER BY TO_JSONB(source)::text), '')) AS signature FROM source
), changed AS MATERIALIZED (
  SELECT signature FROM version WHERE NOT $4::boolean OR NOT EXISTS (
    SELECT 1 FROM visitor_lifecycle_day_snapshots d WHERE d.day = $1 AND d.status = 'ready'
      AND d.source_signature = version.signature
  )
), live AS MATERIALIZED (
  SELECT s.* FROM source s CROSS JOIN changed WHERE s.deleted_at IS NULL
), facts AS MATERIALIZED (
  SELECT distinct_id AS actor_key, MIN(started_at) AS first_started_at,
    (ARRAY_AGG(segment_at_session_start ORDER BY started_at))[1] AS segment_at_day_start,
    COUNT(*)::integer AS sessions,
    BOOL_OR(COALESCE(carts_viewed_in_session,0) > 0) AS cart_viewed,
    BOOL_OR(COALESCE(carts_created_in_session,0) > 0) AS cart_initiated,
    BOOL_OR(COALESCE(carts_updated_in_session,0) > 0) AS cart_updated,
    BOOL_OR(COALESCE(cart_converted,false)) AS converted,
    COUNT(*) FILTER (WHERE cart_converted IS TRUE)::integer AS converted_sessions,
    BOOL_OR(COALESCE(email_acquired_in_session,false)) AS became_known,
    BOOL_OR(COALESCE(became_customer_in_session,false)) AS became_customer,
    BOOL_OR(segment_at_session_start <> 'unknown' AND NULLIF(contact_id,'') IS NULL) AS known_without_contact,
    BOOL_OR(COALESCE(cart_converted,false) AND NULLIF(order_id,'') IS NULL) AS converted_without_order_id,
    BOOL_OR(COALESCE(became_customer_in_session,false) AND NULLIF(contact_id,'') IS NULL) AS became_customer_without_contact,
    MAX(last_event_at) AS source_last_event_at
  FROM live GROUP BY distinct_id
), orders AS (
  SELECT distinct_id, JSONB_AGG(order_id ORDER BY first_seen, order_id) AS ids FROM (
    SELECT distinct_id, order_id, MIN(started_at) AS first_seen FROM live
    WHERE NULLIF(order_id,'') IS NOT NULL GROUP BY distinct_id,order_id
  ) o GROUP BY distinct_id
), written AS (
  INSERT INTO visitor_lifecycle_actor_daily_facts (
    day,actor_key,first_started_at,segment_at_day_start,sessions,cart_viewed,cart_initiated,cart_updated,
    converted,converted_sessions,became_known,became_customer,known_without_contact,
    converted_without_order_id,became_customer_without_contact,order_ids,computed_at,source_last_event_at)
  SELECT $1,f.actor_key,f.first_started_at,f.segment_at_day_start,f.sessions,f.cart_viewed,f.cart_initiated,f.cart_updated,
    f.converted,f.converted_sessions,f.became_known,f.became_customer,f.known_without_contact,
    f.converted_without_order_id,f.became_customer_without_contact,COALESCE(o.ids,'[]'::jsonb),NOW(),f.source_last_event_at
  FROM facts f LEFT JOIN orders o ON o.distinct_id=f.actor_key
  ON CONFLICT (day,actor_key) DO UPDATE SET
    first_started_at=EXCLUDED.first_started_at,segment_at_day_start=EXCLUDED.segment_at_day_start,
    sessions=EXCLUDED.sessions,cart_viewed=EXCLUDED.cart_viewed,cart_initiated=EXCLUDED.cart_initiated,
    cart_updated=EXCLUDED.cart_updated,converted=EXCLUDED.converted,converted_sessions=EXCLUDED.converted_sessions,
    became_known=EXCLUDED.became_known,became_customer=EXCLUDED.became_customer,
    known_without_contact=EXCLUDED.known_without_contact,converted_without_order_id=EXCLUDED.converted_without_order_id,
    became_customer_without_contact=EXCLUDED.became_customer_without_contact,order_ids=EXCLUDED.order_ids,
    computed_at=EXCLUDED.computed_at,source_last_event_at=EXCLUDED.source_last_event_at,updated_at=NOW(),deleted_at=NULL
  RETURNING actor_key
), removed AS (
  DELETE FROM visitor_lifecycle_actor_daily_facts f WHERE day=$1 AND EXISTS (SELECT 1 FROM changed)
    AND NOT EXISTS (SELECT 1 FROM facts n WHERE n.actor_key=f.actor_key) RETURNING 1
), snapshot AS (
  INSERT INTO visitor_lifecycle_day_snapshots
    (day,status,sessions_count,facts_count,computed_at,source_max_last_event_at,error_message,source_signature)
  SELECT $1,'ready',(SELECT COUNT(*) FROM live),(SELECT COUNT(*) FROM written),NOW(),
    (SELECT MAX(last_event_at) FROM live),NULL,signature FROM changed
    WHERE (SELECT COUNT(*) FROM removed) >= 0
  ON CONFLICT(day) DO UPDATE SET status='ready',sessions_count=EXCLUDED.sessions_count,
    facts_count=EXCLUDED.facts_count,computed_at=EXCLUDED.computed_at,
    source_max_last_event_at=EXCLUDED.source_max_last_event_at,error_message=NULL,
    source_signature=EXCLUDED.source_signature,updated_at=NOW()
  RETURNING sessions_count AS sessions,facts_count AS facts
) SELECT * FROM snapshot`

function enumerateDays(from: Date, to: Date): Date[] {
  const days: Date[] = []
  for (let t = from.getTime(); t <= to.getTime(); t += MS_PER_DAY) days.push(new Date(t))
  return days
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function toDayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function toIso(input: Date | string): string {
  return input instanceof Date ? input.toISOString() : new Date(input).toISOString()
}

function toMs(input: Date | string): number {
  return input instanceof Date ? input.getTime() : new Date(input).getTime()
}

function count(value: number | null | undefined): number {
  return Number(value ?? 0)
}

const LIFECYCLE_FACTS_DDL = [
  `CREATE TABLE IF NOT EXISTS ${FACTS_TABLE} (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     day text NOT NULL,
     actor_key text NOT NULL,
     first_started_at timestamptz NOT NULL,
     segment_at_day_start text NOT NULL,
     sessions integer NOT NULL DEFAULT 0,
     cart_viewed boolean NOT NULL DEFAULT false,
     cart_initiated boolean NOT NULL DEFAULT false,
     cart_updated boolean NOT NULL DEFAULT false,
     converted boolean NOT NULL DEFAULT false,
     converted_sessions integer NOT NULL DEFAULT 0,
     became_known boolean NOT NULL DEFAULT false,
     became_customer boolean NOT NULL DEFAULT false,
     known_without_contact boolean NOT NULL DEFAULT false,
     converted_without_order_id boolean NOT NULL DEFAULT false,
     became_customer_without_contact boolean NOT NULL DEFAULT false,
     order_ids jsonb,
     computed_at timestamptz NOT NULL,
     source_last_event_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     deleted_at timestamptz
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS visitor_lifecycle_actor_daily_facts_day_actor_uq
     ON ${FACTS_TABLE}(day, actor_key)`,
  `ALTER TABLE ${FACTS_TABLE}
     ADD COLUMN IF NOT EXISTS converted_sessions integer NOT NULL DEFAULT 0`,
  `ALTER TABLE ${FACTS_TABLE}
     ADD COLUMN IF NOT EXISTS known_without_contact boolean NOT NULL DEFAULT false`,
  `ALTER TABLE ${FACTS_TABLE}
     ADD COLUMN IF NOT EXISTS converted_without_order_id boolean NOT NULL DEFAULT false`,
  `ALTER TABLE ${FACTS_TABLE}
     ADD COLUMN IF NOT EXISTS became_customer_without_contact boolean NOT NULL DEFAULT false`,
  `CREATE INDEX IF NOT EXISTS visitor_lifecycle_actor_daily_facts_day_idx
     ON ${FACTS_TABLE}(day)`,
  `CREATE INDEX IF NOT EXISTS visitor_lifecycle_actor_daily_facts_actor_idx
     ON ${FACTS_TABLE}(actor_key)`,
  `CREATE INDEX IF NOT EXISTS visitor_lifecycle_actor_daily_facts_segment_idx
     ON ${FACTS_TABLE}(segment_at_day_start)`,
  `CREATE TABLE IF NOT EXISTS ${DAYS_TABLE} (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     day text NOT NULL UNIQUE,
     status text NOT NULL DEFAULT 'ready',
     sessions_count integer NOT NULL DEFAULT 0,
     facts_count integer NOT NULL DEFAULT 0,
     computed_at timestamptz NOT NULL,
     source_max_last_event_at timestamptz,
     error_message text,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     deleted_at timestamptz
   )`,
  `ALTER TABLE ${DAYS_TABLE} ADD COLUMN IF NOT EXISTS source_signature text`,
  `CREATE INDEX IF NOT EXISTS visitor_lifecycle_day_snapshots_day_status_idx
     ON ${DAYS_TABLE}(day, status)`,
]
