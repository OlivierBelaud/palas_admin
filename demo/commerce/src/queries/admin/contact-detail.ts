import { resolveRawDb } from '../../utils/raw-db'

export default defineQuery({
  name: 'contact-detail',
  description: 'Flat contact detail fields for dashboard cards',
  input: z.object({
    id: z.string(),
  }),
  handler: async (input, ctx) => {
    const db = resolveRawDb(ctx)
    const rows = await db.raw(
      `WITH contact_row AS (
         SELECT id, email, phone, locale, first_name, last_name, country_code, city,
                shopify_customer_id, klaviyo_profile_id, distinct_id
           FROM contacts
          WHERE id = $1
            AND deleted_at IS NULL
          LIMIT 1
       ),
       linked_orders AS (
         SELECT DISTINCT o.id, o.total_price, o.placed_at
           FROM contact_row c
           JOIN orders o
             ON o.deleted_at IS NULL
            AND o.status IN ('paid', 'fulfilled')
            AND (
              LOWER(o.email) = LOWER(c.email)
              OR EXISTS (
                SELECT 1
                  FROM order_contact oc
                 WHERE oc.deleted_at IS NULL
                   AND oc.contact_id = c.id::text
                   AND oc.order_id = o.id::text
              )
            )
       ),
       order_agg AS (
         SELECT COUNT(*)::int AS orders_count,
                COALESCE(SUM(total_price), 0)::float AS total_spent,
                MIN(placed_at) AS first_order_at,
                MAX(placed_at) AS last_order_at
           FROM linked_orders
       )
       SELECT c.*, a.orders_count, a.total_spent, a.first_order_at, a.last_order_at
         FROM contact_row c
         CROSS JOIN order_agg a`,
      [input.id],
    )

    return rows[0] ?? null
  },
})
