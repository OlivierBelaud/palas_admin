import { json, nowMs, requireAdmin, timingHeader, unauthorized } from './runtime.mjs'

export default {
  async fetch(req) {
    const started = nowMs()
    const auth = requireAdmin(req)
    if (!auth) return unauthorized()
    const authDone = nowMs()

    const url = new URL(req.url)
    const end = url.searchParams.get('to') ? new Date(url.searchParams.get('to')) : new Date()
    const days = 30
    const rows = []

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(end)
      d.setUTCDate(d.getUTCDate() - i)
      const date = d.toISOString().slice(0, 10)
      const seed = Number(date.replaceAll('-', '')) % 97
      const orders = 5 + (seed % 20)
      const revenue = Math.round(orders * (50 + (seed % 100)) * 100) / 100
      rows.push({ date, orders, revenue })
    }

    const from = new Date(end)
    from.setUTCDate(from.getUTCDate() - (days - 1))
    const done = nowMs()
    return json(
      {
        data: {
          rows,
          meta: {
            range: { from: from.toISOString(), to: end.toISOString() },
            granularity: 'day',
            xFormat: 'date',
          },
        },
      },
      {
        headers: {
          'server-timing': timingHeader({
            auth: authDone - started,
            total: done - started,
          }),
        },
      },
    )
  },
}
