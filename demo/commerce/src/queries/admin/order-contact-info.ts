import { resolveRawDb } from '../../utils/raw-db'

// Named query: contact linked to an order, with summary fields derived from
// the live orders table instead of duplicated Contact snapshot columns.

export default defineQuery({
  name: 'order-contact-info',
  description: 'Contact linked to an order via order-contact or matching email',
  input: z.object({
    id: z.string(),
  }),
  handler: async (input, ctx) => {
    const db = resolveRawDb(ctx)
    const rows = await db.raw<Record<string, unknown>>(
      `WITH target_order AS (
         SELECT id, email
           FROM orders
          WHERE id = $1
            AND deleted_at IS NULL
          LIMIT 1
       ),
       contact_row AS (
         SELECT c.id, c.email, c.first_name, c.last_name
           FROM target_order o
           JOIN contacts c
             ON c.deleted_at IS NULL
            AND (
              LOWER(c.email) = LOWER(o.email)
              OR EXISTS (
                SELECT 1
                  FROM order_contact oc
                 WHERE oc.deleted_at IS NULL
                   AND oc.order_id = o.id::text
                   AND oc.contact_id = c.id::text
              )
            )
          ORDER BY
            CASE
              WHEN EXISTS (
                SELECT 1
                  FROM order_contact oc
                 WHERE oc.deleted_at IS NULL
                   AND oc.order_id = o.id::text
                   AND oc.contact_id = c.id::text
              ) THEN 0
              ELSE 1
            END
          LIMIT 1
       ),
       order_agg AS (
         SELECT COUNT(DISTINCT o.id)::int AS orders_count
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
       )
       SELECT c.id AS contact_id,
              c.email,
              c.first_name,
              c.last_name,
              COALESCE(a.orders_count, 0)::int AS orders_count
         FROM contact_row c
         CROSS JOIN order_agg a`,
      [input.id],
    )

    const contact = rows[0]
    if (!contact?.contact_id) return null

    return {
      contact_id: contact.contact_id,
      email: contact.email ?? null,
      first_name: contact.first_name ?? null,
      last_name: contact.last_name ?? null,
      orders_count: contact.orders_count ?? 0,
      contact_url: `/clients/${contact.contact_id}`,
    }
  },
})
