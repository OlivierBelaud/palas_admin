// ChartCard feed: unique visitors per day, split by segment.
// Pivoted shape for a single multi-series LineChart.
// Source: visitor_sessions in [from, to) (with 7d lookback only for symmetry —
// this chart doesn't need had_paid_7d).

import {
  buildAllDaysFromTo,
  dayKey,
  emptyResponse,
  pullSessions,
  type Segment,
  toDate,
} from '../../utils/visitor-stats-helpers'

export default defineQuery({
  name: 'visitor-stats-unique-visitors-by-segment',
  description: 'Per-day unique visitors split by segment. One row per day, one numeric column per segment.',
  input: z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    granularity: z.enum(['day', 'week', 'month']).optional(),
  }),
  handler: async (input, { query, log }) => {
    const pulled = await pullSessions(input, query, log)
    if (!pulled) return emptyResponse(input)
    const { sessions, from, to } = pulled
    const fromMs = from.getTime()
    const toMs = to.getTime()

    const buckets = new Map<string, Record<Segment, Set<string>>>()
    for (const s of sessions) {
      const ms = toDate(s.started_at).getTime()
      if (ms < fromMs || ms >= toMs) continue
      const day = dayKey(toDate(s.started_at))
      let row = buckets.get(day)
      if (!row) {
        row = { unknown: new Set(), known_no_purchase: new Set(), returning_customer: new Set() }
        buckets.set(day, row)
      }
      row[s.segment_at_session_start].add(s.distinct_id)
    }

    const days = buildAllDaysFromTo(from, to)
    const rows = days.map((day) => {
      const b = buckets.get(day)
      return {
        date: day,
        unknown: b ? b.unknown.size : 0,
        known_no_purchase: b ? b.known_no_purchase.size : 0,
        returning_customer: b ? b.returning_customer.size : 0,
      }
    })

    return {
      rows,
      meta: {
        range: { from: from.toISOString(), to: to.toISOString() },
        granularity: 'day' as const,
        xFormat: 'date' as const,
      },
    }
  },
})
