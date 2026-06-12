import { resolveRawDb } from '../../utils/raw-db'

export default defineQuery({
  name: 'abandoned-cart-campaign-check-list',
  description: 'Paginated abandoned-cart campaign guard checks.',
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
      throw new MantaError('INVALID_DATA', 'abandoned-cart-campaign-check-list: invalid range')
    }

    const db = resolveRawDb(ctx)
    const status = input.status && input.status !== 'all' ? input.status : null
    const search = (input.search ?? '').trim() || null
    const rows = await db.raw<CheckListRow>(
      `SELECT ch.id, ch.case_id, ch.message_id, c.email, c.case_type, m.message_type,
              ch.check_type, ch.status, ch.checked_at, ch.raw_summary,
              COUNT(*) OVER()::text AS total_count
         FROM abandoned_cart_checks ch
         LEFT JOIN abandoned_cart_cases c ON c.id = ch.case_id AND c.deleted_at IS NULL
         LEFT JOIN abandoned_cart_messages m ON m.id = ch.message_id AND m.deleted_at IS NULL
        WHERE ch.deleted_at IS NULL
          AND ch.checked_at >= $1::timestamptz
          AND ch.checked_at < $2::timestamptz
          AND ($3::text IS NULL OR ch.status = $3 OR ch.check_type = $3)
          AND (
            $4::text IS NULL
            OR lower(COALESCE(c.email, '')) LIKE '%' || lower($4) || '%'
            OR lower(ch.check_type) LIKE '%' || lower($4) || '%'
            OR lower(ch.status) LIKE '%' || lower($4) || '%'
            OR lower(COALESCE(ch.raw_summary, '')) LIKE '%' || lower($4) || '%'
          )
        ORDER BY ch.checked_at DESC
        LIMIT $5 OFFSET $6`,
      [from.toISOString(), to.toISOString(), status, search, input.limit, input.offset],
    )

    return {
      items: rows.map((row) => ({
        id: row.id,
        case_id: row.case_id,
        message_id: row.message_id,
        email: row.email,
        case_type: row.case_type,
        message_type: row.message_type,
        check_type: row.check_type,
        status: row.status,
        checked_at: iso(row.checked_at) ?? new Date().toISOString(),
        raw_summary: row.raw_summary,
      })),
      count: Number(rows[0]?.total_count ?? 0),
      limit: input.limit,
      offset: input.offset,
    }
  },
})

interface CheckListRow {
  id: string
  case_id: string
  message_id: string | null
  email: string | null
  case_type: string | null
  message_type: string | null
  check_type: string
  status: string
  checked_at: Date | string
  raw_summary: string | null
  total_count: string
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
