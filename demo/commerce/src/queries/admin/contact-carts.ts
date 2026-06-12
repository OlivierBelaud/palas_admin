// Named query: list carts linked to a contact via the cart-contact pivot.
// Uses SQL-level pagination so the client page never loads the full relation.

import { resolveRawDb } from '../../utils/raw-db'

export default defineQuery({
  name: 'contact-carts',
  description: 'List carts linked to a contact (sorted by last_action_at desc)',
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
      `SELECT c.id, c.cart_token, c.distinct_id, c.email, c.first_name, c.last_name,
              c.phone, c.city, c.country_code, c.shopify_customer_id, c.items,
              c.total_price, c.item_count, c.currency, c.last_action, c.last_action_at,
              c.highest_stage, c.status, c.order_id, c.shopify_order_id, c.is_first_order,
              c.shipping_method, c.shipping_price, c.discounts_amount, c.discounts,
              c.subtotal_price, c.total_tax, c.metadata, c.created_at, c.updated_at,
              c.checkout_token, c.abandon_notified_at, c.abandon_notified_count,
              c.abandon_notified_source, c.completed_at, c.cart_birth_at, c.browser_locale,
              COUNT(*) OVER()::text AS total_count
         FROM cart_contact cc
         JOIN carts c ON c.id = cc.cart_id
        WHERE cc.contact_id = $1
          AND cc.deleted_at IS NULL
          AND c.deleted_at IS NULL
        ORDER BY c.last_action_at DESC NULLS LAST, c.updated_at DESC
        LIMIT $2 OFFSET $3`,
      [input.id, limit, offset],
    )

    return { data: rows.map(({ total_count: _totalCount, ...row }) => row), count: Number(rows[0]?.total_count ?? 0) }
  },
})
