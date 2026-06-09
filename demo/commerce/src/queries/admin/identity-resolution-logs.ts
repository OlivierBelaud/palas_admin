export default defineQuery({
  name: 'identity-resolution-logs',
  description: 'Shadow V1/V2 identity resolution logs for recent PostHog events',
  input: z.object({
    hours: z.number().int().positive().max(24).default(4),
    limit: z.number().int().positive().max(200).default(50),
    offset: z.number().int().min(0).default(0),
    status: z.enum(['all', 'anonymous', 'identified', 'diverged', 'error']).default('all'),
    event_name: z.string().optional(),
  }),
  handler: async (input, { query }) => {
    const hours = input.hours ?? 4
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const to = new Date()
    const from = new Date(to.getTime() - hours * 60 * 60 * 1000)
    const baseFilters: Record<string, unknown> = {
      observed_at: { $gte: from.toISOString(), $lte: to.toISOString() },
    }
    const filters: Record<string, unknown> = { ...baseFilters }
    if (input.status && input.status !== 'all') filters.resolution_status = input.status
    if (input.event_name && input.event_name !== 'all') filters.event_name = input.event_name

    const fields = [
      'id',
      'event_id',
      'event_name',
      'observed_at',
      'resolved_at',
      'posthog_distinct_id',
      'session_id',
      'cart_token',
      'checkout_token',
      'v1_email_sha256',
      'v1_source',
      'v1_contact_id',
      'v2_email_sha256',
      'v2_source',
      'v2_contact_id',
      'resolution_status',
      'matched_v1',
      'duration_ms',
      'error_message',
      'aliases_seen',
      'evidence',
    ]

    const [rows, total] = (await query.graphAndCount({
      entity: 'identityResolutionLog',
      filters,
      fields,
      sort: { observed_at: 'desc' },
      pagination: { limit, offset },
    })) as unknown as [Array<Record<string, unknown>>, number]

    const statRows = (await query.graph({
      entity: 'identityResolutionLog',
      filters: baseFilters,
      fields: ['event_name', 'resolution_status', 'matched_v1', 'v1_source', 'v2_source', 'duration_ms'],
      sort: { observed_at: 'desc' },
      pagination: { limit: 10000, offset: 0 },
    })) as unknown as Array<{
      event_name: string
      resolution_status: string
      matched_v1: boolean
      v1_source: string | null
      v2_source: string | null
      duration_ms: number
    }>

    const byStatus = countBy(statRows, (row) => row.resolution_status)
    const byEvent = countBy(statRows, (row) => row.event_name)
    const byV1Source = countBy(statRows, (row) => row.v1_source ?? 'none')
    const byV2Source = countBy(statRows, (row) => row.v2_source ?? 'none')
    const matched = statRows.filter((row) => row.matched_v1).length
    const durations = statRows.map((row) => Number(row.duration_ms || 0)).sort((a, b) => a - b)

    return {
      meta: {
        range: { from: from.toISOString(), to: to.toISOString() },
        generated_at: new Date().toISOString(),
        pagination: {
          limit,
          offset,
          total,
          page: Math.floor(offset / limit) + 1,
          page_count: Math.max(1, Math.ceil(total / limit)),
        },
      },
      kpis: {
        total,
        stat_total: statRows.length,
        matched_v1: matched,
        diverged: statRows.filter((row) => row.resolution_status === 'diverged').length,
        identified: statRows.filter((row) => row.resolution_status === 'identified').length,
        anonymous: statRows.filter((row) => row.resolution_status === 'anonymous').length,
        error: statRows.filter((row) => row.resolution_status === 'error').length,
        p95_duration_ms: percentile(durations, 0.95),
      },
      breakdowns: {
        by_status: byStatus,
        by_event: byEvent,
        by_v1_source: byV1Source,
        by_v2_source: byV2Source,
      },
      logs: rows,
    }
  },
})

function countBy<T>(rows: T[], key: (row: T) => string) {
  const map = new Map<string, number>()
  for (const row of rows) {
    const k = key(row)
    map.set(k, (map.get(k) ?? 0) + 1)
  }
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const idx = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * p) - 1))
  return values[idx] ?? 0
}
