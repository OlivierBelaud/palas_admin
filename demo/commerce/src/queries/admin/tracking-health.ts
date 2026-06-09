type EventLogRow = {
  id: string
  event_id: string
  event_name: string
  source: string
  received_at: string | Date
  page_type: string | null
  market: string | null
  identity_muid: string | null
  identity_email_sha256: string | null
  distinct_id: string | null
  valid: boolean
  validation_errors: string[] | null
  payload_normalized: Record<string, unknown> | null
}

export default defineQuery({
  name: 'tracking-health',
  description: 'Live Event Hub hot log for the last 24 hours',
  input: z.object({
    hours: z.number().int().positive().max(24).default(4),
    limit: z.number().int().positive().max(500).default(200),
    event_name: z.string().optional(),
  }),
  handler: async (input, { query }) => {
    const hours = input.hours ?? 4
    const limit = input.limit ?? 200
    const to = new Date()
    const from = new Date(to.getTime() - hours * 60 * 60 * 1000)
    const filters: Record<string, unknown> = {
      received_at: { $gte: from.toISOString(), $lte: to.toISOString() },
    }
    if (input.event_name && input.event_name !== 'all') filters.event_name = input.event_name

    const rows = (await query.graph({
      entity: 'eventLog',
      filters,
      fields: [
        'id',
        'event_id',
        'event_name',
        'source',
        'received_at',
        'page_type',
        'market',
        'identity_muid',
        'identity_email_sha256',
        'distinct_id',
        'valid',
        'validation_errors',
        'payload_normalized',
      ],
      sort: { received_at: 'desc' },
      pagination: { limit },
    })) as unknown as EventLogRow[]

    const byType = new Map<
      string,
      { event_name: string; count: number; valid: number; invalid: number; latest_at: string | null }
    >()
    let identified = 0
    let valid = 0

    for (const row of rows) {
      if (row.identity_muid || row.identity_email_sha256 || row.distinct_id) identified += 1
      if (row.valid) valid += 1
      const item = byType.get(row.event_name) ?? {
        event_name: row.event_name,
        count: 0,
        valid: 0,
        invalid: 0,
        latest_at: null,
      }
      item.count += 1
      if (row.valid) item.valid += 1
      else item.invalid += 1
      const receivedAt = new Date(row.received_at).toISOString()
      if (!item.latest_at || receivedAt > item.latest_at) item.latest_at = receivedAt
      byType.set(row.event_name, item)
    }

    const events = rows.map((row) => {
      const payload = row.payload_normalized ?? {}
      const ecommerce = (payload.ecommerce ?? {}) as Record<string, unknown>
      const cart = (payload.cart ?? {}) as Record<string, unknown>
      const checkout = (payload.checkout ?? {}) as Record<string, unknown>
      return {
        id: row.id,
        event_id: row.event_id,
        event_name: row.event_name,
        source: row.source,
        received_at: new Date(row.received_at).toISOString(),
        page_type: row.page_type,
        market: row.market,
        identity: row.identity_email_sha256
          ? 'email'
          : row.identity_muid
            ? 'muid'
            : row.distinct_id
              ? 'posthog'
              : 'anon',
        valid: row.valid,
        validation_errors: row.validation_errors ?? [],
        value: ecommerce.value ?? null,
        currency: ecommerce.currency ?? null,
        item_count: ecommerce.item_count ?? null,
        cart_token: cart.token ?? null,
        checkout_token: checkout.token ?? null,
        shopify_order_id: checkout.shopify_order_id ?? null,
      }
    })

    return {
      meta: {
        range: { from: from.toISOString(), to: to.toISOString() },
        generated_at: new Date().toISOString(),
        retention_hours: 24,
      },
      kpis: {
        total: rows.length,
        valid,
        invalid: rows.length - valid,
        identified,
        anonymous: rows.length - identified,
      },
      event_types: Array.from(byType.values()).sort((a, b) => b.count - a.count),
      events,
    }
  },
})
