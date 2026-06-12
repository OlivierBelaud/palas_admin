import { resolveRawDb } from '../../utils/raw-db'

export default defineQuery({
  name: 'abandoned-cart-campaign-case-list',
  description: 'Paginated abandoned-cart campaign cases.',
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
      throw new MantaError('INVALID_DATA', 'abandoned-cart-campaign-case-list: invalid range')
    }

    const db = resolveRawDb(ctx)
    const status = input.status && input.status !== 'all' ? input.status : null
    const search = (input.search ?? '').trim() || null
    const rows = await db.raw<CaseListRow>(
      `WITH scoped_cases AS (
         SELECT c.*,
                GREATEST(
                  COALESCE(c.opened_at, 'epoch'::timestamptz),
                  COALESCE(c.last_cart_action_at, 'epoch'::timestamptz),
                  COALESCE(c.recovered_at, 'epoch'::timestamptz),
                  COALESCE(MAX(m.sent_at), 'epoch'::timestamptz)
                ) AS last_activity_at,
                COUNT(m.id) FILTER (WHERE m.status = 'sent')::int AS messages_sent,
                MAX(m.sent_at) FILTER (WHERE m.status = 'sent') AS last_sent_at,
                MIN(m.scheduled_for) FILTER (
                  WHERE m.status = 'pending'
                    AND m.sequence_version = COALESCE(c.current_sequence_version, 1)
                ) AS next_due_at,
                MAX(m.sequence_version)::int AS total_sequences,
                MAX(m.message_type) FILTER (WHERE m.id = c.recovered_source_message_id) AS recovered_by_message_type,
                MAX(CASE WHEN m.status = 'skipped' THEN 'skipped:' || COALESCE(m.skip_reason, 'unknown') ELSE m.status END) FILTER (
                  WHERE m.message_type = 'abandoned_cart_1'
                    AND m.sequence_version = COALESCE(c.current_sequence_version, 1)
                ) AS email_1,
                MAX(CASE WHEN m.status = 'skipped' THEN 'skipped:' || COALESCE(m.skip_reason, 'unknown') ELSE m.status END) FILTER (
                  WHERE m.message_type = 'abandoned_cart_2'
                    AND m.sequence_version = COALESCE(c.current_sequence_version, 1)
                ) AS email_2,
                MAX(CASE WHEN m.status = 'skipped' THEN 'skipped:' || COALESCE(m.skip_reason, 'unknown') ELSE m.status END) FILTER (
                  WHERE m.message_type = 'abandoned_cart_3'
                    AND m.sequence_version = COALESCE(c.current_sequence_version, 1)
                ) AS email_3,
                MAX(CASE WHEN m.status = 'skipped' THEN 'skipped:' || COALESCE(m.skip_reason, 'unknown') ELSE m.status END) FILTER (
                  WHERE m.message_type = 'payment_help_1'
                    AND m.sequence_version = COALESCE(c.current_sequence_version, 1)
                ) AS payment_help,
                COUNT(DISTINCT ch.id) FILTER (WHERE ch.status = 'blocked')::int AS checks_blocked,
                COUNT(DISTINCT ch.id) FILTER (WHERE ch.status = 'error')::int AS checks_error
           FROM abandoned_cart_cases c
           LEFT JOIN abandoned_cart_messages m ON m.case_id = c.id AND m.deleted_at IS NULL
           LEFT JOIN abandoned_cart_checks ch ON ch.case_id = c.id AND ch.deleted_at IS NULL
          WHERE c.deleted_at IS NULL
            AND (
              (c.opened_at >= $1::timestamptz AND c.opened_at < $2::timestamptz)
              OR EXISTS (
                SELECT 1
                  FROM abandoned_cart_messages wm
                 WHERE wm.case_id = c.id
                   AND wm.deleted_at IS NULL
                   AND COALESCE(wm.sent_at, wm.updated_at, wm.scheduled_for) >= $1::timestamptz
                   AND COALESCE(wm.sent_at, wm.updated_at, wm.scheduled_for) < $2::timestamptz
              )
            )
            AND ($3::text IS NULL OR c.status = $3 OR c.case_type = $3)
            AND (
              $4::text IS NULL
              OR lower(c.email) LIKE '%' || lower($4) || '%'
              OR lower(c.case_type) LIKE '%' || lower($4) || '%'
              OR lower(c.status) LIKE '%' || lower($4) || '%'
            )
          GROUP BY c.id
       )
       SELECT *, COUNT(*) OVER()::text AS total_count
         FROM scoped_cases
        ORDER BY last_activity_at DESC NULLS LAST, opened_at DESC
        LIMIT $5 OFFSET $6`,
      [from.toISOString(), to.toISOString(), status, search, input.limit, input.offset],
    )

    return {
      items: rows.map((row) => ({
        id: row.id,
        cart_id: row.cart_id,
        email: row.email,
        case_type: row.case_type,
        status: row.status,
        current_sequence_version: row.current_sequence_version ?? 1,
        sequence_started_at: iso(row.sequence_started_at),
        total_sequences: Math.max(row.current_sequence_version ?? 1, row.total_sequences ?? 1),
        stage_at_open: row.stage_at_open,
        opened_at: iso(row.opened_at),
        last_cart_action_at: iso(row.last_cart_action_at),
        last_activity_at: iso(row.last_activity_at) ?? iso(row.opened_at),
        email_1: row.email_1,
        email_2: row.email_2,
        email_3: row.email_3,
        payment_help: row.payment_help,
        messages_sent: row.messages_sent ?? 0,
        last_sent_at: iso(row.last_sent_at),
        next_due_at: iso(row.next_due_at),
        recovered_at: iso(row.recovered_at),
        recovered_amount: money(row.recovered_amount),
        recovered_by_message_type: row.recovered_by_message_type,
        checks_blocked: row.checks_blocked ?? 0,
        checks_error: row.checks_error ?? 0,
      })),
      count: Number(rows[0]?.total_count ?? 0),
      limit: input.limit,
      offset: input.offset,
    }
  },
})

interface CaseListRow {
  id: string
  cart_id: string
  email: string
  case_type: string
  status: string
  current_sequence_version: number | null
  sequence_started_at: Date | string | null
  stage_at_open: string | null
  last_cart_action_at: Date | string
  opened_at: Date | string
  recovered_at: Date | string | null
  recovered_amount: number | string | null
  last_activity_at: Date | string | null
  messages_sent: number | null
  last_sent_at: Date | string | null
  next_due_at: Date | string | null
  total_sequences: number | null
  recovered_by_message_type: string | null
  email_1: string | null
  email_2: string | null
  email_3: string | null
  payment_help: string | null
  checks_blocked: number | null
  checks_error: number | null
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
