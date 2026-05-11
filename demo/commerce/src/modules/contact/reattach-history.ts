// Retro-attach historical Cart and Order rows to a Contact once the
// Contact's shopify_customer_id is known. Called at the tail of the
// Shopify customer sync so anonymous carts written before we knew the
// customer (e.g. cart:viewed firing on a page with no $identify yet)
// can be joined back to the contact without rebuilding the entire
// snapshot.
//
// Idempotent. First-write-wins on the receiving columns — we never
// overwrite a shopify_customer_id that another path has already set.

export interface RawDb {
  raw: <T>(sql: string, params?: unknown[]) => Promise<T[]>
}

export interface ReattachInput {
  email: string
  shopify_customer_id: string
}

export interface ReattachOutcome {
  carts_attached: number
  orders_attached: number
}

/**
 * Attach every anonymous cart + order matching `email` (case-insensitive)
 * to the given `shopify_customer_id`. Only fills NULL columns so we never
 * clobber a value another sync path already wrote.
 */
export async function reattachHistoryForContact(db: RawDb, input: ReattachInput): Promise<ReattachOutcome> {
  const email = input.email.trim().toLowerCase()
  const cust = input.shopify_customer_id.trim()
  if (!email || !cust) return { carts_attached: 0, orders_attached: 0 }

  const cartsUpdated = await db.raw<{ id: string }>(
    `UPDATE carts
        SET shopify_customer_id = $1
      WHERE LOWER(email) = $2
        AND shopify_customer_id IS NULL
      RETURNING id`,
    [cust, email],
  )

  // Resolve the Contact id once — both pivot inserts need it.
  const contactRows = await db.raw<{ id: string }>(
    `SELECT id::text AS id FROM contacts WHERE LOWER(email) = $1 LIMIT 1`,
    [email],
  )
  const contactId = contactRows[0]?.id ?? null

  // Pivot rows: cart_contact + order_contact. Idempotent via ON CONFLICT
  // DO NOTHING; relies on the pivot tables having a UNIQUE constraint on
  // (left_id, right_id) — same shape as cart_order_cart_id_order_id_key.
  if (contactId) {
    for (const c of cartsUpdated) {
      await db
        .raw(
          `INSERT INTO cart_contact (id, cart_id, contact_id, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, NOW(), NOW())
           ON CONFLICT DO NOTHING`,
          [c.id, contactId],
        )
        .catch(() => {})
    }
  }

  const ordersUpdated: Array<{ id: string }> = contactId
    ? await db.raw<{ id: string }>(
        `WITH ins AS (
           INSERT INTO order_contact (id, order_id, contact_id, created_at, updated_at)
           SELECT gen_random_uuid(), o.id::text, $1, NOW(), NOW()
             FROM orders o
            WHERE LOWER(o.email) = $2
              AND NOT EXISTS (SELECT 1 FROM order_contact oc WHERE oc.order_id = o.id::text)
           ON CONFLICT DO NOTHING
           RETURNING order_id
         )
         SELECT order_id AS id FROM ins`,
        [contactId, email],
      )
    : []

  return {
    carts_attached: cartsUpdated.length,
    orders_attached: ordersUpdated.length,
  }
}
