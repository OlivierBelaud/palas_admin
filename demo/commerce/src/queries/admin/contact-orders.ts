// Named query: list orders linked to a contact via the order-contact pivot.
// Uses SQL-level pagination so the client page never loads the full relation.

import { resolveRawDb } from '../../utils/raw-db'

export default defineQuery({
  name: 'contact-orders',
  description: 'List orders linked to a contact (sorted by placed_at desc)',
  input: z.object({
    id: z.string(),
    limit: z.number().int().min(1).max(200).default(50),
    offset: z.number().int().min(0).default(0),
  }),
  handler: async (input, ctx) => {
    const db = resolveRawDb(ctx)
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const rows = await db.raw<Record<string, unknown> & { total_count: string }>(
      `SELECT o.id, o.shopify_order_id, o.email, o.order_number, o.status, o.financial_status,
              o.fulfillment_status, o.total_price, o.currency, o.items, o.placed_at, o.cancelled_at,
              o.shopify_synced_at, o.created_at, o.updated_at, o.metadata, o.shopify_customer_id,
              o.shopify_source_name, o.shopify_source_identifier, o.shopify_app_name,
              o.shopify_channel_name, o.shopify_tags, o.sales_channel,
              o.include_in_ecommerce_analytics, o.analytics_exclusion_reason,
              COUNT(*) OVER()::text AS total_count
         FROM order_contact oc
         JOIN orders o ON o.id::text = oc.order_id
        WHERE oc.contact_id = $1
          AND oc.deleted_at IS NULL
          AND o.deleted_at IS NULL
        ORDER BY o.placed_at DESC NULLS LAST, o.created_at DESC
        LIMIT $2 OFFSET $3`,
      [input.id, limit, offset],
    )

    return { data: rows.map(({ total_count: _totalCount, ...row }) => row), count: Number(rows[0]?.total_count ?? 0) }
  },
})
