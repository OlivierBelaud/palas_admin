import type { RawDb } from './refresh-cart'

/** Fence the final link against the cart row, including an enrichment that
 * started before a newer identity arrived. A deterministic pivot ID also makes
 * concurrent same-identity retries safe on the legacy pivot (no pair unique key).
 */
export async function linkCurrentCartContact(
  db: RawDb,
  cartId: string,
  contactId: string,
  email: string,
): Promise<boolean> {
  const rows = await db.raw<{ changed: boolean }>(
    `WITH current_cart AS MATERIALIZED (
      SELECT id FROM carts WHERE id = $1 AND deleted_at IS NULL
        AND LOWER(TRIM(email)) = LOWER(TRIM($3::text)) FOR UPDATE
    ), removed AS (
      DELETE FROM cart_contact cc USING current_cart c
      WHERE cc.cart_id = c.id AND cc.id <> $4 RETURNING cc.id
    ), linked AS (
    INSERT INTO cart_contact (id, cart_id, contact_id, created_at, updated_at)
    SELECT $4, id, $2, NOW(), NOW() FROM current_cart
    WHERE (SELECT count(*) FROM removed) >= 0
    ON CONFLICT (id) DO UPDATE SET contact_id = EXCLUDED.contact_id,
      updated_at = NOW(), deleted_at = NULL
    WHERE cart_contact.contact_id IS DISTINCT FROM EXCLUDED.contact_id OR cart_contact.deleted_at IS NOT NULL
    RETURNING id
    ) SELECT EXISTS(SELECT 1 FROM removed) OR EXISTS(SELECT 1 FROM linked) AS changed`,
    [cartId, contactId, email, `cart-contact:${cartId}`],
  )
  return rows[0]?.changed === true
}
