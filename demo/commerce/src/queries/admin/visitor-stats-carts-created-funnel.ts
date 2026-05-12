// ChartCard feed: per-day cart-creation funnel.
// Two series: `carts_created` (sum) and `carts_created_converted` (count of
// sessions where carts_created_in_session>0 AND cart_converted).

import { buildAllDaysFromTo, dayKey, emptyResponse, pullSessions, toDate } from '../../utils/visitor-stats-helpers'

export default defineQuery({
  name: 'visitor-stats-carts-created-funnel',
  description: 'Per-day total vs converted carts created in session. Total = SUM(carts_created_in_session).',
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

    const buckets = new Map<string, { total: number; converted: number }>()
    for (const s of sessions) {
      const ms = toDate(s.started_at).getTime()
      if (ms < fromMs || ms >= toMs) continue
      const day = dayKey(toDate(s.started_at))
      let b = buckets.get(day)
      if (!b) {
        b = { total: 0, converted: 0 }
        buckets.set(day, b)
      }
      b.total += s.carts_created_in_session
      if (s.carts_created_in_session > 0 && s.cart_converted) b.converted += 1
    }

    const days = buildAllDaysFromTo(from, to)
    const rows = days.map((day) => {
      const b = buckets.get(day)
      return {
        date: day,
        carts_created: b ? b.total : 0,
        carts_created_converted: b ? b.converted : 0,
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
