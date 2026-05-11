// Synthetic 30-day series feeding the /admin/charts-lab showcase page.
// Replace with real aggregated query once STATS-09 lands.

export default defineQuery({
  name: 'charts-lab-data',
  description: 'Synthetic daily orders+revenue for the Charts lab showcase page',
  input: z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    granularity: z.enum(['day', 'week', 'month']).optional(),
  }),
  handler: async (input) => {
    const end = input.to ? new Date(input.to) : new Date()
    const days = 30
    const rows: Array<{ date: string; orders: number; revenue: number }> = []

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(end)
      d.setUTCDate(d.getUTCDate() - i)
      const yyyy = d.getUTCFullYear()
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
      const dd = String(d.getUTCDate()).padStart(2, '0')
      const orders = Math.floor(Math.random() * 20) + 5
      const revenue = Math.round(orders * (50 + Math.random() * 100) * 100) / 100
      rows.push({ date: `${yyyy}-${mm}-${dd}`, orders, revenue })
    }

    const fromIso = (() => {
      const d = new Date(end)
      d.setUTCDate(d.getUTCDate() - (days - 1))
      return d.toISOString()
    })()

    return {
      rows,
      meta: {
        range: { from: fromIso, to: end.toISOString() },
        granularity: 'day' as const,
        xFormat: 'date' as const,
      },
    }
  },
})
