// Daily visitor-session aggregates feeding the /admin/visitor-stats page.
//
// One row per (day, segment, is_paid_session, had_paid_7d). The SQL plan
// (.claude/plans/visitor-session-snapshot.md §Phase H) calls for a window
// subquery to compute `had_paid_7d`; the query handler keeps the same
// in-memory aggregation shape but now reads through Drizzle.
//
//   1. Pull all visitor_sessions in [from - 7d, to) via Drizzle
//      (the 7d lookback is needed to compute had_paid_7d for sessions
//      near the start of the requested window).
//   2. Delegate the aggregation to the pure `aggregateVisitorSessions`
//      helper (in utils/) — so unit tests can hammer it without booting
//      the framework.
//
// Output shape: `{ rows: [...flat rows...], meta: { range, granularity } }`
// — matches the ChartCard contract documented in
// dashboard-core/primitives/query-types.ts.
//
// Empty-DB safety: if visitor_sessions doesn't exist (bootstrap not yet
// run), pullSessions returns null and we short-circuit to an empty
// response so the page renders fine.

import { aggregateVisitorSessions } from '../../utils/visitor-stats-aggregator'
import { emptyResponse, pullSessions } from '../../utils/visitor-stats-helpers'

export default defineQuery({
  name: 'visitor-session-daily-stats',
  description:
    'Daily visitor-session aggregates split by segment × is_paid_session × had_paid_7d. Source of truth for the visitor-stats charts.',
  input: z.object({
    from: z.string(),
    to: z.string(),
    granularity: z.enum(['day', 'week', 'month']).optional(),
  }),
  handler: async (input, { db, schema, log }) => {
    const pulled = await pullSessions(input, { db, schema }, log)
    if (!pulled) return emptyResponse(input)
    const { sessions, from, to } = pulled
    if (sessions.length === 0) return emptyResponse(input)

    const rows = aggregateVisitorSessions(sessions, from, to)
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
