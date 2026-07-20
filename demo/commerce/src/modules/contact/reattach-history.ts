// Retro-attach historical Cart and Order rows to a Contact once the
// Contact's shopify_customer_id is known. Called at the tail of the
// Shopify customer sync so anonymous carts written before we knew the
// customer (e.g. cart:viewed firing on a page with no $identify yet)
// can be joined back to the contact without rebuilding all source rows.
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
  cart_links_attached: number
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
  if (!email || !cust) return { carts_attached: 0, cart_links_attached: 0, orders_attached: 0 }

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
  if (!contactId) {
    throw new Error('Cannot reattach contact history: contact not found')
  }

  // Select all matching carts, not only rows updated above. If a previous
  // attempt stamped shopify_customer_id but failed before inserting the
  // pivot, a retry can still repair the missing relationship.
  const cartLinksInserted = await db.raw<{ cart_id: string }>(
    `INSERT INTO cart_contact (id, cart_id, contact_id, created_at, updated_at)
         SELECT gen_random_uuid(), c.id::text, $1, NOW(), NOW()
           FROM carts c
          WHERE LOWER(c.email) = $2
            AND c.shopify_customer_id = $3
            AND NOT EXISTS (
              SELECT 1
                FROM cart_contact existing
               WHERE existing.cart_id = c.id::text
                 AND existing.contact_id = $1
            )
         ON CONFLICT DO NOTHING
         RETURNING cart_id`,
    [contactId, email, cust],
  )

  const ordersUpdated = await db.raw<{ id: string }>(
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

  return {
    carts_attached: cartsUpdated.length,
    cart_links_attached: cartLinksInserted.length,
    orders_attached: ordersUpdated.length,
  }
}

export async function reattachShopifyCustomerHistory(
  db: RawDb,
  customers: ReattachInput[],
): Promise<ReattachOutcome> {
  const total: ReattachOutcome = {
    carts_attached: 0,
    cart_links_attached: 0,
    orders_attached: 0,
  }
  for (const customer of customers) {
    const outcome = await reattachHistoryForContact(db, customer)
    total.carts_attached += outcome.carts_attached
    total.cart_links_attached += outcome.cart_links_attached
    total.orders_attached += outcome.orders_attached
  }
  return total
}
