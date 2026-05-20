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
  input: { from: Date; to: Date },
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
  const computedAt = new Date().toISOString()

  for (const day of enumerateDays(from, to)) {
    days += 1
    const next = new Date(day.getTime() + MS_PER_DAY)
    const dayKey = toDayKey(day)
    const sessions = await db.raw<LifecycleSessionFactSource>(
      `SELECT distinct_id,
              started_at,
              last_event_at,
              segment_at_session_start,
              contact_id,
              carts_viewed_in_session,
              carts_created_in_session,
              carts_updated_in_session,
              cart_converted,
              order_id,
              became_customer_in_session,
              email_acquired_in_session
         FROM visitor_sessions
        WHERE deleted_at IS NULL
          AND started_at >= $1
          AND started_at < $2
        ORDER BY started_at ASC`,
      [day.toISOString(), next.toISOString()],
    )
    const facts = buildLifecycleActorDailyFacts(sessions, dayKey, computedAt)
    await replaceLifecycleFactsForDay(db, dayKey, facts)
    await upsertLifecycleDaySnapshot(db, {
      day: dayKey,
      status: 'ready',
      sessions_count: sessions.length,
      facts_count: facts.length,
      computed_at: computedAt,
      source_max_last_event_at: maxIso(sessions.map((session) => session.last_event_at)),
      error_message: null,
    })
    totalSessions += sessions.length
    totalFacts += facts.length
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

async function replaceLifecycleFactsForDay(db: RawDb, day: string, facts: LifecycleActorDailyFactRow[]): Promise<void> {
  await db.raw(`DELETE FROM ${FACTS_TABLE} WHERE day = $1`, [day])
  if (facts.length === 0) return

  const params: unknown[] = []
  const values = facts.map((fact, index) => {
    const base = index * 18
    params.push(
      fact.day,
      fact.actor_key,
      fact.first_started_at,
      fact.segment_at_day_start,
      fact.sessions,
      fact.cart_viewed,
      fact.cart_initiated,
      fact.cart_updated,
      fact.converted,
      fact.converted_sessions,
      fact.became_known,
      fact.became_customer,
      fact.known_without_contact,
      fact.converted_without_order_id,
      fact.became_customer_without_contact,
      JSON.stringify(fact.order_ids),
      fact.computed_at,
      fact.source_last_event_at,
    )
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}, $${base + 16}::jsonb, $${base + 17}, $${base + 18})`
  })

  await db.raw(
    `INSERT INTO ${FACTS_TABLE}
        (day, actor_key, first_started_at, segment_at_day_start, sessions,
         cart_viewed, cart_initiated, cart_updated, converted, converted_sessions, became_known,
         became_customer, known_without_contact, converted_without_order_id, became_customer_without_contact,
         order_ids, computed_at, source_last_event_at)
     VALUES ${values.join(', ')}`,
    params,
  )
}

async function upsertLifecycleDaySnapshot(
  db: RawDb,
  row: {
    day: string
    status: 'ready' | 'failed'
    sessions_count: number
    facts_count: number
    computed_at: string
    source_max_last_event_at: string | null
    error_message: string | null
  },
): Promise<void> {
  await db.raw(
    `INSERT INTO ${DAYS_TABLE}
       (day, status, sessions_count, facts_count, computed_at, source_max_last_event_at, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (day) DO UPDATE SET
       status = EXCLUDED.status,
       sessions_count = EXCLUDED.sessions_count,
       facts_count = EXCLUDED.facts_count,
       computed_at = EXCLUDED.computed_at,
       source_max_last_event_at = EXCLUDED.source_max_last_event_at,
       error_message = EXCLUDED.error_message,
       updated_at = now()`,
    [
      row.day,
      row.status,
      row.sessions_count,
      row.facts_count,
      row.computed_at,
      row.source_max_last_event_at,
      row.error_message,
    ],
  )
}

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

function maxIso(values: Array<Date | string | null>): string | null {
  let max: string | null = null
  for (const value of values) {
    if (!value) continue
    const iso = toIso(value)
    if (!max || iso > max) max = iso
  }
  return max
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
  `CREATE INDEX IF NOT EXISTS visitor_lifecycle_day_snapshots_day_status_idx
     ON ${DAYS_TABLE}(day, status)`,
]
