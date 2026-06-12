import { resolveRawDb } from '../../utils/raw-db'

export default defineQuery({
  name: 'group-customers',
  description: 'List customers in a customer group',
  input: z.object({
    group_id: z.string(),
    limit: z.number().int().min(1).max(100).default(20),
    offset: z.number().int().min(0).default(0),
  }),
  handler: async (input, ctx) => {
    const db = resolveRawDb(ctx)
    const limit = input.limit ?? 20
    const offset = input.offset ?? 0
    const rows = await db.raw<Record<string, unknown> & { total_count: string }>(
      `SELECT c.id, c.first_name, c.last_name, c.email, c.avatar_url, c.metadata,
              c.company_name, c.phone, c.has_account, c.created_by, c.created_at, c.updated_at,
              COUNT(*) OVER()::text AS total_count
         FROM customer_customer_group ccg
         JOIN customers c ON c.id = ccg.customer_id
        WHERE ccg.customer_group_id = $1
          AND ccg.deleted_at IS NULL
          AND c.deleted_at IS NULL
        ORDER BY c.email ASC, c.created_at DESC
        LIMIT $2 OFFSET $3`,
      [input.group_id, limit, offset],
    )

    return { data: rows.map(({ total_count: _totalCount, ...row }) => row), count: Number(rows[0]?.total_count ?? 0) }
  },
})
