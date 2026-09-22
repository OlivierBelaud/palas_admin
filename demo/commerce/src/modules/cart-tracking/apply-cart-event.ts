import type { RawDb } from './refresh-cart'

const SNAPSHOT_FIELDS = ['items', 'total_price', 'item_count', 'currency', 'last_action', 'last_action_at']
const ENRICHMENT_FIELDS = [
  'distinct_id',
  'email',
  'first_name',
  'last_name',
  'phone',
  'city',
  'country_code',
  'browser_locale',
  'shopify_customer_id',
  'checkout_token',
  'is_first_order',
  'shipping_method',
  'shipping_price',
  'discounts_amount',
  'discounts',
  'subtotal_price',
  'total_tax',
]

/** Compare inside UPDATE, against the row PostgreSQL locks, not an earlier service read.
 * Equal timestamps retain the first snapshot: replay order cannot choose a different winner.
 * Funnel/completion are monotonic facts, independent of the latest cart snapshot.
 */
export async function applyCartEvent<T>(db: RawDb, cartId: string, incoming: Record<string, unknown>): Promise<T> {
  const newer = '(c.last_action_at IS NULL OR e.last_action_at > c.last_action_at)'
  const snapshot = SNAPSHOT_FIELDS.map((field) => `${field} = CASE WHEN ${newer} THEN e.${field} ELSE c.${field} END`)
  const identityFields = new Set([
    'distinct_id',
    'email',
    'first_name',
    'last_name',
    'phone',
    'city',
    'country_code',
    'browser_locale',
    'shopify_customer_id',
  ])
  const compatibleIdentity = `(e.email IS NULL OR c.email IS NULL OR LOWER(TRIM(e.email)) = LOWER(TRIM(c.email)))`
  const enrichment = ENRICHMENT_FIELDS.map(
    (field) => `${field} = CASE WHEN ${newer} THEN COALESCE(e.${field}, c.${field})
    ELSE ${identityFields.has(field) ? `CASE WHEN ${compatibleIdentity} THEN COALESCE(c.${field}, e.${field}) ELSE c.${field} END` : `COALESCE(c.${field}, e.${field})`} END`,
  )
  const [cart] = await db.raw<T>(
    `UPDATE carts c SET
      ${[...snapshot, ...enrichment].join(',\n      ')},
      highest_stage = (ARRAY['cart','checkout_started','checkout_engaged','payment_attempted','completed'])[GREATEST(
        COALESCE(array_position(ARRAY['cart','checkout_started','checkout_engaged','payment_attempted','completed'], c.highest_stage), 1),
        array_position(ARRAY['cart','checkout_started','checkout_engaged','payment_attempted','completed'], e.highest_stage))],
      status = CASE WHEN e.last_action = 'checkout:completed' THEN 'completed' ELSE c.status END,
      completed_at = CASE WHEN e.last_action = 'checkout:completed' THEN COALESCE(c.completed_at, e.last_action_at) ELSE c.completed_at END,
      shopify_order_id = CASE WHEN ${newer} THEN COALESCE(e.shopify_order_id, c.shopify_order_id)
        WHEN e.last_action = 'checkout:completed' THEN COALESCE(c.shopify_order_id, e.shopify_order_id) ELSE c.shopify_order_id END,
      updated_at = NOW()
    FROM jsonb_populate_record(NULL::carts, $2::text::jsonb) e
    WHERE c.id = $1 AND c.deleted_at IS NULL RETURNING c.*`,
    [cartId, JSON.stringify(incoming)],
  )
  if (!cart) throw new Error('Cart disappeared before its event could be applied')
  return cart
}
