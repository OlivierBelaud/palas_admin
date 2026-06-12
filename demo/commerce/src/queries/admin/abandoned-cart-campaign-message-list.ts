import { resolveRawDb } from '../../utils/raw-db'

export default defineQuery({
  name: 'abandoned-cart-campaign-message-list',
  description: 'Paginated abandoned-cart campaign messages.',
  input: z.object({
    from: z.string(),
    to: z.string(),
    limit: z.number().int().positive().max(200).default(50),
    offset: z.number().int().min(0).default(0),
    status: z.string().default('all'),
    search: z.string().default(''),
  }),
  handler: async (input, ctx) => {
    const from = new Date(input.from)
    const to = new Date(input.to)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
      throw new MantaError('INVALID_DATA', 'abandoned-cart-campaign-message-list: invalid range')
    }

    const db = resolveRawDb(ctx)
    const status = input.status && input.status !== 'all' ? input.status : null
    const search = (input.search ?? '').trim() || null
    const rows = await db.raw<MessageListRow>(
      `SELECT m.id, m.case_id, m.cart_id, m.email, c.case_type, c.stage_at_open,
              m.message_type, m.sequence_version, m.sequence_started_at, m.status,
              m.scheduled_for, m.sent_at, COALESCE(m.sent_at, m.updated_at, m.scheduled_for) AS activity_at,
              m.provider, m.provider_message_id, m.locale, m.subject, m.snapshot_html_url,
              m.snapshot_error, m.skip_reason, m.error_message,
              (c.recovered_source_message_id = m.id) AS recovered,
              CASE WHEN c.recovered_source_message_id = m.id THEN c.recovered_amount ELSE 0 END AS recovered_amount,
              COUNT(*) OVER()::text AS total_count
         FROM abandoned_cart_messages m
         LEFT JOIN abandoned_cart_cases c ON c.id = m.case_id AND c.deleted_at IS NULL
        WHERE m.deleted_at IS NULL
          AND COALESCE(m.sent_at, m.updated_at, m.scheduled_for) >= $1::timestamptz
          AND COALESCE(m.sent_at, m.updated_at, m.scheduled_for) < $2::timestamptz
          AND ($3::text IS NULL OR m.status = $3 OR m.message_type = $3 OR m.skip_reason = $3)
          AND (
            $4::text IS NULL
            OR lower(m.email) LIKE '%' || lower($4) || '%'
            OR lower(COALESCE(m.subject, '')) LIKE '%' || lower($4) || '%'
            OR lower(COALESCE(m.skip_reason, '')) LIKE '%' || lower($4) || '%'
            OR lower(COALESCE(m.error_message, '')) LIKE '%' || lower($4) || '%'
            OR lower(m.message_type) LIKE '%' || lower($4) || '%'
            OR lower(m.status) LIKE '%' || lower($4) || '%'
          )
        ORDER BY activity_at DESC NULLS LAST
        LIMIT $5 OFFSET $6`,
      [from.toISOString(), to.toISOString(), status, search, input.limit, input.offset],
    )

    return {
      items: rows.map((row) => ({
        id: row.id,
        case_id: row.case_id,
        cart_id: row.cart_id,
        email: row.email,
        case_type: row.case_type,
        stage_at_open: row.stage_at_open,
        message_type: row.message_type,
        sequence_version: row.sequence_version ?? 1,
        sequence_started_at: iso(row.sequence_started_at),
        status: row.status,
        scheduled_for: iso(row.scheduled_for) ?? new Date().toISOString(),
        sent_at: iso(row.sent_at),
        activity_at: iso(row.activity_at) ?? new Date().toISOString(),
        provider: row.provider,
        provider_message_id: row.provider_message_id,
        locale: row.locale,
        subject: row.subject,
        snapshot_html_url: row.snapshot_html_url,
        snapshot_error: row.snapshot_error,
        skip_reason: row.skip_reason,
        error_message: row.error_message,
        recovered: row.recovered === true,
        recovered_amount: money(row.recovered_amount),
      })),
      count: Number(rows[0]?.total_count ?? 0),
      limit: input.limit,
      offset: input.offset,
    }
  },
})

interface MessageListRow {
  id: string
  case_id: string
  cart_id: string
  email: string
  case_type: string | null
  stage_at_open: string | null
  message_type: string
  sequence_version: number | null
  sequence_started_at: Date | string | null
  status: string
  scheduled_for: Date | string
  sent_at: Date | string | null
  activity_at: Date | string | null
  provider: string | null
  provider_message_id: string | null
  locale: string | null
  subject: string | null
  snapshot_html_url: string | null
  snapshot_error: string | null
  skip_reason: string | null
  error_message: string | null
  recovered: boolean | null
  recovered_amount: number | string | null
  total_count: string
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function money(value: number | string | null | undefined): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}
