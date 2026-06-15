// ChartCard feed: per-day email-identity acquisitions, split by source.

import { buildAllDaysFromTo, dayKey, emptyResponse, pullSessions, toDate } from '../../utils/visitor-stats-helpers'

export default defineQuery({
  name: 'visitor-stats-identity-acquisitions',
  description: 'Per-day count of sessions that acquired email identity, split by newsletter vs checkout_started.',
  input: z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    granularity: z.enum(['day', 'week', 'month']).optional(),
  }),
  handler: async (input, { db, schema, log }) => {
    const pulled = await pullSessions(input, { db, schema }, log)
    if (!pulled) return emptyResponse(input)
    const { sessions, from, to } = pulled
    const fromMs = from.getTime()
    const toMs = to.getTime()

    const buckets = new Map<string, { newsletter: number; checkout_started: number }>()
    for (const s of sessions) {
      const ms = toDate(s.started_at).getTime()
      if (ms < fromMs || ms >= toMs) continue
      if (!s.email_acquired_in_session) continue
      const day = dayKey(toDate(s.started_at))
      let b = buckets.get(day)
      if (!b) {
        b = { newsletter: 0, checkout_started: 0 }
        buckets.set(day, b)
      }
      if (s.email_acquired_via === 'newsletter') b.newsletter += 1
      else if (s.email_acquired_via === 'checkout_started') b.checkout_started += 1
    }

    const days = buildAllDaysFromTo(from, to)
    const rows = days.map((day) => {
      const b = buckets.get(day)
      return {
        date: day,
        newsletter: b ? b.newsletter : 0,
        checkout_started: b ? b.checkout_started : 0,
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
