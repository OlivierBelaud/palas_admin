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

  // The `orders` table currently does not carry shopify_customer_id; the
  // canonical join is through the order-contact pivot, populated by a
  // separate workflow. We still expose the count so the caller can log
  // both arms of the reattachment even when one is a no-op.
  const ordersUpdated: Array<{ id: string }> = []

  return {
    carts_attached: cartsUpdated.length,
    orders_attached: ordersUpdated.length,
  }
}
