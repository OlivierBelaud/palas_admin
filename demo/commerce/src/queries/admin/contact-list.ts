import { resolveRawDb } from '../../utils/raw-db'

export default defineQuery({
  name: 'contact-list',
  description: 'List contacts for the admin contacts table',
  input: z.object({}),
  handler: async (_input, ctx) => {
    const db = resolveRawDb(ctx)
    return db.raw(
      `WITH linked_orders AS (
         SELECT DISTINCT c.id AS contact_id, o.id, o.total_price, o.placed_at
           FROM contacts c
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
          WHERE c.deleted_at IS NULL
       ),
       order_agg AS (
         SELECT contact_id,
                COUNT(*)::int AS orders_count,
                COALESCE(SUM(total_price), 0)::float AS total_spent,
                MAX(placed_at) AS last_order_at
           FROM linked_orders
          GROUP BY contact_id
       )
       SELECT c.id, c.email, c.first_name, c.last_name,
              COALESCE(a.orders_count, 0)::int AS orders_count,
              COALESCE(a.total_spent, 0)::float AS total_spent,
              a.last_order_at,
              c.last_activity_at,
              c.country_code
         FROM contacts c
         LEFT JOIN order_agg a ON a.contact_id = c.id
        WHERE c.deleted_at IS NULL
        ORDER BY c.last_activity_at DESC NULLS LAST
        LIMIT 1000`,
    )
  },
})
