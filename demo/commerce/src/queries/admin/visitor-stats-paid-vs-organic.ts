// ChartCard feed: per-day session count split by paid vs organic traffic.
// `is_paid_session` is determined by attribution.ts (D2 rule — see
// docs/visitor-funnel-rules.md).

import { buildAllDaysFromTo, dayKey, emptyResponse, pullSessions, toDate } from '../../utils/visitor-stats-helpers'

export default defineQuery({
  name: 'visitor-stats-paid-vs-organic',
  description: 'Per-day session count split by is_paid_session.',
  input: z.object({
    from: z.string(),
    to: z.string(),
    granularity: z.enum(['day', 'week', 'month']).optional(),
  }),
  handler: async (input, { query, log }) => {
    const pulled = await pullSessions(input, query, log)
    if (!pulled) return emptyResponse(input)
    const { sessions, from, to } = pulled
    const fromMs = from.getTime()
    const toMs = to.getTime()

    const buckets = new Map<string, { paid: number; organic: number }>()
    for (const s of sessions) {
      const ms = toDate(s.started_at).getTime()
      if (ms < fromMs || ms >= toMs) continue
      const day = dayKey(toDate(s.started_at))
      let b = buckets.get(day)
      if (!b) {
        b = { paid: 0, organic: 0 }
        buckets.set(day, b)
      }
      if (s.is_paid_session) b.paid += 1
      else b.organic += 1
    }

    const days = buildAllDaysFromTo(from, to)
    const rows = days.map((day) => {
      const b = buckets.get(day)
      return {
        date: day,
        paid: b ? b.paid : 0,
        organic: b ? b.organic : 0,
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
