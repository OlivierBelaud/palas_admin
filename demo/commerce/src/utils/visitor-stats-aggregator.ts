// Pure aggregation core for the visitor-session-daily-stats query.
// Separated so the test file can import it without booting the framework
// (defineQuery is a runtime global, only available after bootstrap).
//
// Identical aggregation rules to .claude/plans/visitor-session-snapshot.md §H.
// See visitor-session-daily-stats.ts for the framework-facing wrapper.

import {
  dayKey,
  LOOKBACK_DAYS_FOR_HAD_PAID_7D,
  MS_PER_DAY,
  type Segment,
  type SessionLite,
  toDate,
} from './visitor-stats-helpers'

export interface DailyStatsAggregateRow {
  day: string // YYYY-MM-DD
  segment: Segment
  is_paid_session: boolean
  had_paid_7d: boolean
  unique_visitors: number
  carts_created: number
  carts_viewed: number
  carts_updated: number
  carts_created_converted: number
  carts_updated_converted: number
  became_customers: number
  identity_newsletter: number
  identity_checkout: number
}

/**
 * Aggregate sessions into per-(day, segment, is_paid, had_paid_7d) rows.
 * Sessions outside [from, to) are ignored for the OUTPUT but are still
 * consulted to compute had_paid_7d (so callers should pass sessions in
 * [from - 7d, to)).
 */
export function aggregateVisitorSessions(sessions: SessionLite[], from: Date, to: Date): DailyStatsAggregateRow[] {
  // Build paid lookup per distinct_id, sorted by ts ASC.
  const paidByDistinct = new Map<string, Array<{ ts: number; paid: boolean }>>()
  for (const s of sessions) {
    const arr = paidByDistinct.get(s.distinct_id) ?? []
    arr.push({ ts: toDate(s.started_at).getTime(), paid: s.is_paid_session })
    paidByDistinct.set(s.distinct_id, arr)
  }
  for (const arr of paidByDistinct.values()) {
    arr.sort((a, b) => a.ts - b.ts)
  }

  function hadPaid7d(distinctId: string, sessionStartMs: number): boolean {
    const arr = paidByDistinct.get(distinctId)
    if (!arr) return false
    const cutoff = sessionStartMs - LOOKBACK_DAYS_FOR_HAD_PAID_7D * MS_PER_DAY
    for (const item of arr) {
      if (item.ts >= sessionStartMs) break
      if (item.paid && item.ts >= cutoff) return true
    }
    return false
  }

  const fromMs = from.getTime()
  const toMs = to.getTime()
  const accs = new Map<string, DailyStatsAggregateRow>()
  const uniqueSetByKey = new Map<string, Set<string>>()

  for (const s of sessions) {
    const startedAt = toDate(s.started_at)
    const startedMs = startedAt.getTime()
    if (startedMs < fromMs || startedMs >= toMs) continue

    const day = dayKey(startedAt)
    const hadPaid = hadPaid7d(s.distinct_id, startedMs)
    const key = `${day}|${s.segment_at_session_start}|${s.is_paid_session ? '1' : '0'}|${hadPaid ? '1' : '0'}`

    let acc = accs.get(key)
    if (!acc) {
      acc = {
        day,
        segment: s.segment_at_session_start,
        is_paid_session: s.is_paid_session,
        had_paid_7d: hadPaid,
        unique_visitors: 0,
        carts_created: 0,
        carts_viewed: 0,
        carts_updated: 0,
        carts_created_converted: 0,
        carts_updated_converted: 0,
        became_customers: 0,
        identity_newsletter: 0,
        identity_checkout: 0,
      }
      accs.set(key, acc)
      uniqueSetByKey.set(key, new Set<string>())
    }
    const uniqueSet = uniqueSetByKey.get(key) as Set<string>
    uniqueSet.add(s.distinct_id)

    acc.carts_viewed += s.carts_viewed_in_session ?? 0
    acc.carts_created += s.carts_created_in_session
    acc.carts_updated += s.carts_updated_in_session
    if (s.carts_created_in_session > 0 && s.cart_converted) acc.carts_created_converted += 1
    if (s.carts_updated_in_session > 0 && s.cart_converted) acc.carts_updated_converted += 1
    if (s.became_customer_in_session) acc.became_customers += 1
    if (s.email_acquired_in_session && s.email_acquired_via === 'newsletter') acc.identity_newsletter += 1
    if (s.email_acquired_in_session && s.email_acquired_via === 'checkout_started') acc.identity_checkout += 1
  }

  for (const [key, acc] of accs) {
    const set = uniqueSetByKey.get(key)
    acc.unique_visitors = set ? set.size : 0
  }

  return [...accs.values()].sort((a, b) => {
    if (a.day !== b.day) return a.day < b.day ? -1 : 1
    if (a.segment !== b.segment) return a.segment < b.segment ? -1 : 1
    if (a.is_paid_session !== b.is_paid_session) return a.is_paid_session ? 1 : -1
    if (a.had_paid_7d !== b.had_paid_7d) return a.had_paid_7d ? 1 : -1
    return 0
  })
}
