// Shared helpers for the /admin/visitor-stats ChartCard queries.
//
// Each chart query pulls the same visitor_sessions slice and pivots it
// per chart. We co-locate the pull + day-bucket scaffolding here to
// avoid duplicating the boilerplate across five query files.

import { type DrizzleReadContext, readRows } from './drizzle-read'

export const LOOKBACK_DAYS_FOR_HAD_PAID_7D = 7
export const MS_PER_DAY = 86_400_000

export type Segment = 'unknown' | 'known_no_purchase' | 'returning_customer'

export interface VisitorStatsRangeInput {
  from?: string
  to?: string
}

export interface SessionLite {
  distinct_id: string
  started_at: Date | string
  segment_at_session_start: Segment
  is_paid_session: boolean
  carts_viewed_in_session?: number
  carts_created_in_session: number
  carts_updated_in_session: number
  cart_converted: boolean
  became_customer_in_session?: boolean
  email_acquired_in_session: boolean
  email_acquired_via: 'newsletter' | 'checkout_started' | null
}

export function dayKey(d: Date): string {
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v)
}

export function normalizeVisitorStatsRange(input: VisitorStatsRangeInput): { from: string; to: string } {
  if (input.from && input.to) return { from: input.from, to: input.to }
  const to = new Date()
  const from = new Date(to.getTime() - 30 * MS_PER_DAY)
  return {
    from: input.from ?? from.toISOString(),
    to: input.to ?? to.toISOString(),
  }
}

/**
 * Pull visitor_sessions for [from - 7d, to). The 7d lookback exists so
 * had_paid_7d can be computed for sessions near `from`. Callers that
 * don't need had_paid_7d are still safe — they just ignore the extra
 * rows when filtering by [from, to) downstream.
 *
 * On database read failure (missing table — bootstrap not yet run), returns
 * `null` so the caller can degrade gracefully to an empty response.
 */
export async function pullSessions(
  input: VisitorStatsRangeInput,
  ctx: DrizzleReadContext,
  log: { warn: (m: string) => void },
): Promise<{ sessions: SessionLite[]; from: Date; to: Date } | null> {
  const range = normalizeVisitorStatsRange(input)
  const from = new Date(range.from)
  const to = new Date(range.to)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new MantaError('INVALID_DATA', `visitor-stats: invalid date range from=${input.from} to=${input.to}`)
  }
  const lookbackStart = new Date(from.getTime() - LOOKBACK_DAYS_FOR_HAD_PAID_7D * MS_PER_DAY)
  // 30d × ~700 sessions/day = ~21k rows. We paginate to drain the window.
  // We paginate to drain the window — safety cap at 100k to avoid pathological loops.
  const PAGE = 5000
  const HARD_CAP = 100_000
  const all: SessionLite[] = []
  try {
    for (let offset = 0; offset < HARD_CAP; offset += PAGE) {
      const page = (await readRows(ctx, {
        entity: 'visitorSession',
        fields: [
          'distinct_id',
          'started_at',
          'segment_at_session_start',
          'is_paid_session',
          'carts_viewed_in_session',
          'carts_created_in_session',
          'carts_updated_in_session',
          'cart_converted',
          'became_customer_in_session',
          'email_acquired_in_session',
          'email_acquired_via',
        ],
        filters: {
          started_at: { $gte: lookbackStart.toISOString(), $lt: to.toISOString() },
        },
        pagination: { take: PAGE, skip: offset, limit: PAGE, offset },
      })) as unknown as SessionLite[]
      if (!Array.isArray(page) || page.length === 0) break
      all.push(...page)
      if (page.length < PAGE) break
    }
    return { sessions: all, from, to }
  } catch (err) {
    log.warn(`[visitor-stats] database query failed (table missing?): ${(err as Error).message}. Returning empty.`)
    return null
  }
}

export interface ChartResponse<TRow> {
  rows: TRow[]
  meta: {
    range: { from: string; to: string }
    granularity: 'day'
    xFormat: 'date'
  }
}

export function emptyResponse(input: VisitorStatsRangeInput): ChartResponse<never> {
  const range = normalizeVisitorStatsRange(input)
  return {
    rows: [],
    meta: {
      range: { from: new Date(range.from).toISOString(), to: new Date(range.to).toISOString() },
      granularity: 'day',
      xFormat: 'date',
    },
  }
}

/**
 * All UTC day keys (YYYY-MM-DD) within [from, to). Inclusive of `from`'s
 * day, exclusive of `to`. Used to emit zero-filled rows for empty days
 * so the chart x-axis stays continuous.
 */
export function buildAllDaysFromTo(from: Date, to: Date): string[] {
  const days: string[] = []
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  const end = to.getTime()
  for (let t = start; t < end; t += MS_PER_DAY) {
    days.push(dayKey(new Date(t)))
  }
  return days
}
