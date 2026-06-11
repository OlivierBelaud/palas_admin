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

type DispatchLogRow = {
  event_id: string
  destination: string
  status: string
  http_status: number | null
  error_code: string | null
  error_message: string | null
  attempt_count: number
  sent_at: string | Date | null
  last_attempt_at: string | Date | null
}

type ContactRow = {
  id: string
  email: string
  distinct_id: string | null
}

export default defineQuery({
  name: 'tracking-health',
  description: 'Live Event Hub hot log for the last 24 hours',
  input: z.object({
    hours: z.number().int().positive().max(24).default(4),
    limit: z.number().int().positive().max(200).default(50),
    offset: z.number().int().min(0).default(0),
    event_name: z.string().optional(),
  }),
  handler: async (input, { query }) => {
    const hours = input.hours ?? 4
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const to = new Date()
    const from = new Date(to.getTime() - hours * 60 * 60 * 1000)
    const baseFilters: Record<string, unknown> = {
      received_at: { $gte: from.toISOString(), $lte: to.toISOString() },
    }
    const filters: Record<string, unknown> = { ...baseFilters }
    if (input.event_name && input.event_name !== 'all') filters.event_name = input.event_name

    const fields = [
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
    ]

    const [rows, total] = (await query.graphAndCount({
      entity: 'eventLog',
      filters,
      fields,
      sort: { received_at: 'desc' },
      pagination: { limit, offset },
    })) as unknown as [EventLogRow[], number]
    const pageEventIds = rows.map((row) => row.event_id).filter(Boolean)
    const pageDispatchRows =
      pageEventIds.length > 0
        ? ((await query.graph({
            entity: 'dispatchLog',
            filters: { destination: 'ga4', event_id: { $in: pageEventIds } },
            fields: [
              'event_id',
              'destination',
              'status',
              'http_status',
              'error_code',
              'error_message',
              'attempt_count',
              'sent_at',
              'last_attempt_at',
            ],
            sort: { event_received_at: 'desc' },
            pagination: { limit: Math.max(limit, pageEventIds.length), offset: 0 },
          })) as unknown as DispatchLogRow[])
        : []
    const dispatchByEventId = new Map(pageDispatchRows.map((row) => [row.event_id, row]))
    const contactIds = uniqueStrings(
      rows
        .map((row) => {
          const payload = row.payload_normalized ?? {}
          const user = (payload.user ?? {}) as Record<string, unknown>
          return typeof user.contact_id === 'string' ? user.contact_id : null
        })
        .filter(Boolean) as string[],
    )
    const distinctIds = uniqueStrings(rows.map((row) => row.distinct_id).filter(Boolean) as string[])
    const [contactsByIdRows, contactsByDistinctRows] = await Promise.all([
      contactIds.length > 0
        ? (query.graph({
            entity: 'contact',
            filters: { id: { $in: contactIds } },
            fields: ['id', 'email', 'distinct_id'],
            pagination: { limit: Math.max(contactIds.length, 1), offset: 0 },
          }) as Promise<ContactRow[]>)
        : Promise.resolve([]),
      distinctIds.length > 0
        ? (query.graph({
            entity: 'contact',
            filters: { distinct_id: { $in: distinctIds } },
            fields: ['id', 'email', 'distinct_id'],
            pagination: { limit: Math.max(distinctIds.length, 1), offset: 0 },
          }) as Promise<ContactRow[]>)
        : Promise.resolve([]),
    ])
    const contactById = new Map(contactsByIdRows.map((row) => [row.id, row]))
    const contactByDistinctId = new Map(
      contactsByDistinctRows.filter((row) => row.distinct_id).map((row) => [row.distinct_id as string, row]),
    )

    const typeRows = (await query.graph({
      entity: 'eventLog',
      filters: baseFilters,
      fields,
      sort: { received_at: 'desc' },
      pagination: { limit: 10000, offset: 0 },
    })) as unknown as EventLogRow[]

    const statRows =
      input.event_name && input.event_name !== 'all'
        ? ((await query.graph({
            entity: 'eventLog',
            filters,
            fields,
            sort: { received_at: 'desc' },
            pagination: { limit: 10000, offset: 0 },
          })) as unknown as EventLogRow[])
        : typeRows
    const dispatchStatRows = (await query.graph({
      entity: 'dispatchLog',
      filters: {
        destination: 'ga4',
        event_received_at: { $gte: from.toISOString(), $lte: to.toISOString() },
      },
      fields: ['event_id', 'status', 'http_status', 'error_code', 'attempt_count', 'sent_at', 'last_attempt_at'],
      sort: { event_received_at: 'desc' },
      pagination: { limit: 10000, offset: 0 },
    })) as unknown as DispatchLogRow[]

    const byType = new Map<
      string,
      { event_name: string; count: number; valid: number; invalid: number; latest_at: string | null }
    >()
    let identified = 0
    let valid = 0
    let ga4Ready = 0
    let posthogForwarded = 0
    const ga4StatusCounts = countBy(dispatchStatRows, (row) => row.status)
    const latestAt = typeRows[0]?.received_at ? new Date(typeRows[0].received_at).toISOString() : null

    for (const row of statRows) {
      const payload = row.payload_normalized ?? {}
      const user = (payload.user ?? {}) as Record<string, unknown>
      const dispatch = (payload.dispatch ?? {}) as Record<string, unknown>
      const ga4 = (dispatch.ga4 ?? {}) as Record<string, unknown>
      const posthog = (dispatch.posthog ?? {}) as Record<string, unknown>

      if (user.contact_id || row.identity_email_sha256 || row.identity_muid || row.distinct_id) identified += 1
      if (row.valid) valid += 1
      if (ga4.ready === true) ga4Ready += 1
      if (posthog.status === 'forwarded') posthogForwarded += 1
    }

    for (const row of typeRows) {
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
      const user = (payload.user ?? {}) as Record<string, unknown>
      const dispatch = (payload.dispatch ?? {}) as Record<string, unknown>
      const ga4 = (dispatch.ga4 ?? {}) as Record<string, unknown>
      const posthog = (dispatch.posthog ?? {}) as Record<string, unknown>
      const ga4Log = dispatchByEventId.get(row.event_id)
      const contactId = typeof user.contact_id === 'string' ? user.contact_id : null
      const email = contactId
        ? contactById.get(contactId)?.email
        : row.distinct_id
          ? contactByDistinctId.get(row.distinct_id)?.email
          : null
      const hasEmailHash = Boolean(row.identity_email_sha256 || user.email_sha256)
      return {
        id: row.id,
        event_id: row.event_id,
        event_name: row.event_name,
        raw_event_name: typeof payload.raw_event_name === 'string' ? payload.raw_event_name : row.event_name,
        source: row.source,
        received_at: new Date(row.received_at).toISOString(),
        page_type: row.page_type,
        market: row.market,
        identity: user.contact_id
          ? 'contact'
          : row.identity_email_sha256
            ? 'email'
            : row.identity_muid
              ? 'muid'
              : row.distinct_id
                ? 'posthog'
                : 'anon',
        identity_source: typeof user.identity_source === 'string' ? user.identity_source : null,
        contact_id: contactId,
        email: email ?? null,
        email_status: email ? 'resolved' : hasEmailHash ? 'hashed' : 'unknown',
        matched_v1: user.matched_v1 === true,
        valid: row.valid,
        validation_errors: row.validation_errors ?? [],
        value: ecommerce.value ?? null,
        currency: ecommerce.currency ?? null,
        item_count: ecommerce.item_count ?? null,
        cart_token: cart.token ?? null,
        checkout_token: checkout.token ?? null,
        shopify_order_id: checkout.shopify_order_id ?? null,
        posthog_status: typeof posthog.status === 'string' ? posthog.status : 'unknown',
        posthog_http_status: typeof posthog.http_status === 'number' ? posthog.http_status : null,
        ga4_ready: ga4Log ? ['pending', 'sending', 'sent', 'retry'].includes(ga4Log.status) : ga4.ready === true,
        ga4_status: ga4Log?.status ?? (typeof ga4.status === 'string' ? ga4.status : 'not_configured'),
        ga4_http_status: ga4Log?.http_status ?? null,
        ga4_error_code: ga4Log?.error_code ?? null,
        ga4_error_message: ga4Log?.error_message ?? null,
        ga4_attempt_count: ga4Log?.attempt_count ?? 0,
        ga4_sent_at: ga4Log?.sent_at ? new Date(ga4Log.sent_at).toISOString() : null,
      }
    })

    return {
      meta: {
        range: { from: from.toISOString(), to: to.toISOString() },
        generated_at: new Date().toISOString(),
        latest_event_at: latestAt,
        retention_hours: 24,
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
        valid,
        invalid: total - valid,
        identified,
        anonymous: total - identified,
        ga4_ready: ga4Ready,
        ga4_pending: countStatus(ga4StatusCounts, 'pending') + countStatus(ga4StatusCounts, 'retry'),
        ga4_sent: countStatus(ga4StatusCounts, 'sent'),
        ga4_invalid: countStatus(ga4StatusCounts, 'invalid'),
        ga4_error:
          countStatus(ga4StatusCounts, 'error') +
          countStatus(ga4StatusCounts, 'not_configured') +
          countStatus(ga4StatusCounts, 'sending'),
        posthog_forwarded: posthogForwarded,
      },
      event_types: Array.from(byType.values()).sort((a, b) => b.count - a.count),
      events,
    }
  },
})

function countBy<T>(rows: T[], key: (row: T) => string) {
  const map = new Map<string, number>()
  for (const row of rows) {
    const k = key(row)
    map.set(k, (map.get(k) ?? 0) + 1)
  }
  return map
}

function countStatus(map: Map<string, number>, status: string) {
  return map.get(status) ?? 0
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}
