// Shared upsert logic for a Shopify "paid" order → carts table.
//
// Used by three callers:
//   - api/shopify-webhooks/orders-paid/route.ts  (real-time, ~100% capture)
//   - jobs/reconcile-shopify-daily.ts            (safety net, catches missed webhooks)
//   - scripts/backfill-shopify-completions.ts    (one-shot historical fill)
//
// Direct postgres on purpose — both the cron and the script need to run the
// full pipeline inline on serverless (Manta `defineCommand` short-circuits
// at 300ms via Promise.race). See `detect-abandoned-carts.ts` header for
// the long version of the rationale.
//
// Matching strategy (same as before extraction):
//   1) cart_token exact, then LIKE `${token}?key=%` (the pixel persists
//      tokens with the `?key=` suffix)
//   2) email + shopify_order_id IS NULL + last_action_at within ±30d
//   3) INSERT a synthetic row (covers POS / admin orders that never
//      touched the pixel)
//
// Idempotent: if the matched row already carries `shopify_order_id` AND
// is at the `completed` stage, we no-op. Shopify can replay webhooks for
// up to 48h after the first delivery.

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Sql } from 'postgres'

const MATCH_WINDOW_DAYS = 30

export interface ShopifyLineItem {
  id?: number | string
  product_id?: number | string | null
  variant_id?: number | string | null
  sku?: string | null
  title?: string | null
  variant_title?: string | null
  quantity?: number
  price?: string | number | null
  total_discount?: string | number | null
  image_url?: string | null
}

export interface ShopifyOrderPayload {
  id: number | string
  email: string | null
  cart_token: string | null
  checkout_token: string | null
  created_at: string
  total_price: string | number | null
  subtotal_price?: string | number | null
  currency: string | null
  line_items: ShopifyLineItem[] | null
  financial_status?: string | null
  fulfillment_status?: string | null
  name?: string | null
  order_number?: number | string | null
  cancelled_at?: string | null
}

export interface UpsertOutcome {
  /** How the cart row was discovered (or 'inserted' if none matched). */
  matched_via: 'cart_token' | 'email' | 'shopify_order_id' | 'inserted' | 'noop'
  /** UUID of the affected `carts` row, when known. */
  cart_id: string | null
  /** Was the row already marked complete with this order id? (Shopify replay) */
  already_completed: boolean
}

// We use the postgres-js tagged-template `Sql` shape directly. Typed loosely
// at the call sites (rows array shape) because postgres-js leaves the row
// type to consumer assertion. Generic parameter intentionally unconstrained.
// biome-ignore lint/suspicious/noExplicitAny: postgres-js tagged-template surface
export type SqlClient = Sql<any>

// ── HMAC verification ────────────────────────────────────────────────

/**
 * Verify a Shopify webhook signature. `rawBody` MUST be the exact bytes
 * Shopify sent — never re-stringify the parsed JSON.
 *
 * Header: X-Shopify-Hmac-Sha256 (base64).
 * Returns true on match. Uses timingSafeEqual to keep comparison
 * constant-time.
 */
export function verifyShopifyHmac(rawBody: string, headerValue: string | null, secret: string): boolean {
  if (!headerValue || !secret) return false
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64')
  // Lengths must match before timingSafeEqual or Node throws synchronously.
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(headerValue, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

// ── Helpers ──────────────────────────────────────────────────────────

function normalizeCartToken(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cleaned = String(raw).split('?')[0].trim()
  return cleaned.length > 0 ? cleaned : null
}

function toNumber(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

export function mapLineItems(items: ShopifyLineItem[] | null | undefined): Array<Record<string, unknown>> {
  if (!Array.isArray(items)) return []
  return items.map((li) => {
    const quantity = typeof li.quantity === 'number' ? li.quantity : 1
    const unitPrice = toNumber(li.price, 0)
    const linePrice = unitPrice * quantity
    return {
      id: li.variant_id != null ? String(li.variant_id) : li.id != null ? String(li.id) : '',
      product_id: li.product_id != null ? String(li.product_id) : '',
      sku: li.sku ?? '',
      title: li.title ?? '',
      variant_title: li.variant_title ?? '',
      quantity,
      price: unitPrice,
      line_price: linePrice,
      image_url: li.image_url ?? null,
      url: null,
    }
  })
}

interface CartRow {
  id: string
  email: string | null
  items: unknown
  currency: string | null
  shopify_order_id: string | null
  highest_stage: string
  status: string
  last_action_at: Date | string | null
}

async function findCartByShopifyOrderId(sql: SqlClient, shopifyOrderId: string): Promise<CartRow | null> {
  const rows = (await sql`
    SELECT id, email, items, currency, shopify_order_id, highest_stage, status, last_action_at
      FROM carts
     WHERE shopify_order_id = ${shopifyOrderId}
     LIMIT 1`) as CartRow[]
  return rows[0] ?? null
}

async function findCartByToken(sql: SqlClient, token: string): Promise<CartRow | null> {
  let rows = (await sql`
    SELECT id, email, items, currency, shopify_order_id, highest_stage, status, last_action_at
      FROM carts
     WHERE cart_token = ${token}
     LIMIT 1`) as CartRow[]
  if (rows.length === 0) {
    rows = (await sql`
      SELECT id, email, items, currency, shopify_order_id, highest_stage, status, last_action_at
        FROM carts
       WHERE cart_token LIKE ${`${token}?key=%`}
       LIMIT 1`) as CartRow[]
  }
  return rows[0] ?? null
}

async function findCartByEmailRecent(sql: SqlClient, email: string, createdAt: Date): Promise<CartRow | null> {
  const windowStart = new Date(createdAt.getTime() - MATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const windowEnd = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000)
  const rows = (await sql`
    SELECT id, email, items, currency, shopify_order_id, highest_stage, status, last_action_at
      FROM carts
     WHERE LOWER(email) = LOWER(${email})
       AND shopify_order_id IS NULL
       AND last_action_at >= ${windowStart}
       AND last_action_at <= ${windowEnd}
     ORDER BY last_action_at DESC
     LIMIT 1`) as CartRow[]
  return rows[0] ?? null
}

export interface UpsertOptions {
  /** Don't write — only report what would happen. */
  dryRun?: boolean
}

function deriveOrderStatus(payload: ShopifyOrderPayload): 'pending' | 'paid' | 'fulfilled' | 'cancelled' | 'refunded' {
  if (payload.cancelled_at) return 'cancelled'
  const fin = (payload.financial_status ?? '').toLowerCase()
  const ful = (payload.fulfillment_status ?? '').toLowerCase()
  if (fin === 'refunded') return 'refunded'
  if (ful === 'fulfilled') return 'fulfilled'
  if (fin === 'paid') return 'paid'
  return 'pending'
}

/**
 * Upsert a Shopify order into the `orders` mirror table by shopify_order_id.
 * First-write-wins on identity columns (email, currency) so a later webhook
 * never overwrites a value we already trust. Status fields (financial,
 * fulfillment, totals) are always refreshed because Shopify mutates them
 * over the order lifecycle.
 */
async function upsertOrderRow(sql: SqlClient, payload: ShopifyOrderPayload, createdAt: Date): Promise<string> {
  const shopifyOrderId = String(payload.id)
  const email = (payload.email ?? '').trim().toLowerCase() || null
  const orderNumber = payload.name ?? (payload.order_number != null ? String(payload.order_number) : null)
  const status = deriveOrderStatus(payload)
  const totalPrice = toNumber(payload.total_price, 0)
  const currency = payload.currency ?? 'EUR'
  const cancelledAt = payload.cancelled_at ? new Date(payload.cancelled_at) : null
  const items = mapLineItems(payload.line_items)
  const now = new Date()

  const rows = (await sql`
    INSERT INTO orders
      (id, shopify_order_id, email, order_number, status, financial_status, fulfillment_status,
       total_price, currency, items, placed_at, cancelled_at, shopify_synced_at, created_at, updated_at)
    VALUES
      (gen_random_uuid(), ${shopifyOrderId}, ${email}, ${orderNumber}, ${status},
       ${payload.financial_status ?? null}, ${payload.fulfillment_status ?? null},
       ${totalPrice}, ${currency}, ${sql.json(items as never)}, ${createdAt}, ${cancelledAt},
       ${now}, ${now}, ${now})
    ON CONFLICT (shopify_order_id) DO UPDATE SET
      email = COALESCE(orders.email, EXCLUDED.email),
      order_number = COALESCE(orders.order_number, EXCLUDED.order_number),
      status = EXCLUDED.status,
      financial_status = EXCLUDED.financial_status,
      fulfillment_status = EXCLUDED.fulfillment_status,
      total_price = EXCLUDED.total_price,
      currency = COALESCE(orders.currency, EXCLUDED.currency),
      items = COALESCE(orders.items, EXCLUDED.items),
      placed_at = COALESCE(orders.placed_at, EXCLUDED.placed_at),
      cancelled_at = EXCLUDED.cancelled_at,
      shopify_synced_at = EXCLUDED.shopify_synced_at,
      updated_at = EXCLUDED.updated_at
    RETURNING id`) as Array<{ id: string }>
  return rows[0]?.id ?? ''
}

// Populate the cart_order pivot table (defineLink). Manta does not auto-fill
// link tables — call sites are responsible for inserting pivot rows.
async function linkCartOrder(sql: SqlClient, cartId: string, orderId: string): Promise<void> {
  if (!cartId || !orderId) return
  await sql`
    INSERT INTO cart_order (id, cart_id, order_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${cartId}, ${orderId}, NOW(), NOW())
    ON CONFLICT DO NOTHING`
}

// Populate the order_contact pivot. Looks up the Contact by lowercased email
// and inserts the link if it doesn't exist.
async function linkOrderContactByEmail(sql: SqlClient, orderId: string, email: string | null): Promise<void> {
  if (!orderId || !email) return
  const lower = email.trim().toLowerCase()
  if (!lower) return
  const rows = (await sql`SELECT id::text AS id FROM contacts WHERE LOWER(email) = ${lower} LIMIT 1`) as Array<{
    id: string
  }>
  const contactId = rows[0]?.id
  if (!contactId) return
  await sql`
    INSERT INTO order_contact (id, order_id, contact_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${orderId}, ${contactId}, NOW(), NOW())
    ON CONFLICT DO NOTHING`
}

/**
 * Upsert a single Shopify paid order into `carts`. See module header for the
 * matching strategy. Returns an outcome describing what happened so callers
 * can log counters.
 */
export async function upsertShopifyOrder(
  sql: SqlClient,
  order: ShopifyOrderPayload,
  opts: UpsertOptions = {},
): Promise<UpsertOutcome> {
  const dryRun = opts.dryRun === true
  const shopifyOrderId = String(order.id)
  const cartTokenNorm = normalizeCartToken(order.cart_token)
  const checkoutToken = order.checkout_token ?? null
  const email = (order.email ?? '').trim() || null
  const createdAt = new Date(order.created_at)
  const totalPrice = toNumber(order.total_price, 0)
  const subtotalPrice = order.subtotal_price != null ? toNumber(order.subtotal_price, 0) : null
  const currency = order.currency ?? 'EUR'
  const lineItems = mapLineItems(order.line_items)

  let cart: CartRow | null = null
  let matchedVia: 'cart_token' | 'email' | 'shopify_order_id' | null = null

  // Highest precedence: shopify_order_id direct match. Catches synthetic rows
  // we inserted on a previous run for POS/admin orders with no Shopify
  // cart_token — we'd otherwise loop into the INSERT branch and hit the
  // UNIQUE constraint on cart_token.
  cart = await findCartByShopifyOrderId(sql, shopifyOrderId)
  if (cart) matchedVia = 'shopify_order_id'

  if (!cart && cartTokenNorm) {
    cart = await findCartByToken(sql, cartTokenNorm)
    if (cart) matchedVia = 'cart_token'
  }
  if (!cart && email) {
    cart = await findCartByEmailRecent(sql, email, createdAt)
    if (cart) matchedVia = 'email'
  }

  if (cart) {
    // Idempotence: Shopify may retry a delivered webhook. If the row is
    // already complete with the same order id, we still refresh the orders
    // mirror because Shopify mutates status fields (fulfilled, refunded)
    // independently of the cart.
    if (cart.shopify_order_id === shopifyOrderId && cart.highest_stage === 'completed') {
      if (!dryRun) {
        const orderId = await upsertOrderRow(sql, order, createdAt)
        await linkCartOrder(sql, cart.id, orderId)
        await linkOrderContactByEmail(sql, orderId, email)
      }
      return { matched_via: 'noop', cart_id: cart.id, already_completed: true }
    }
    if (dryRun) {
      return { matched_via: matchedVia ?? 'noop', cart_id: cart.id, already_completed: false }
    }
    // First-write-wins on email/items/currency: don't overwrite values the
    // cart already carries (matches applyEvent merge semantics).
    const nextEmail = cart.email ?? email
    const nextItems = cart.items ?? lineItems
    const nextCurrency = cart.currency ?? currency
    await sql`
      UPDATE carts
         SET status = 'completed',
             highest_stage = 'completed',
             last_action = 'checkout:completed',
             last_action_at = ${createdAt},
             completed_at = ${createdAt},
             shopify_order_id = ${shopifyOrderId},
             checkout_token = COALESCE(checkout_token, ${checkoutToken}),
             total_price = ${totalPrice},
             subtotal_price = COALESCE(subtotal_price, ${subtotalPrice}),
             email = ${nextEmail},
             items = ${sql.json(nextItems as never)},
             currency = ${nextCurrency},
             updated_at = NOW()
       WHERE id = ${cart.id}`
    const orderIdMatched = await upsertOrderRow(sql, order, createdAt)
    await linkCartOrder(sql, cart.id, orderIdMatched)
    await linkOrderContactByEmail(sql, orderIdMatched, email)
    return { matched_via: matchedVia ?? 'noop', cart_id: cart.id, already_completed: false }
  }

  // No cart row at all — likely a POS / admin order that never touched the
  // pixel. Insert a synthetic completed row so analytics + anti-relance
  // guards still see it.
  if (dryRun) {
    return { matched_via: 'inserted', cart_id: null, already_completed: false }
  }
  const syntheticToken = cartTokenNorm ?? `shopify-order-${shopifyOrderId}`
  const inserted = (await sql`
    INSERT INTO carts
      (id, cart_token, checkout_token, email, items, total_price, subtotal_price, currency,
       last_action, last_action_at, completed_at, highest_stage, status, shopify_order_id,
       item_count, created_at, updated_at)
    VALUES
      (gen_random_uuid(), ${syntheticToken}, ${checkoutToken}, ${email},
       ${sql.json(lineItems as never)}, ${totalPrice}, ${subtotalPrice}, ${currency},
       'checkout:completed', ${createdAt}, ${createdAt}, 'completed', 'completed',
       ${shopifyOrderId}, ${lineItems.length}, NOW(), NOW())
    RETURNING id`) as Array<{ id: string }>
  const orderIdInserted = await upsertOrderRow(sql, order, createdAt)
  if (inserted[0]?.id) await linkCartOrder(sql, inserted[0].id, orderIdInserted)
  await linkOrderContactByEmail(sql, orderIdInserted, email)
  return { matched_via: 'inserted', cart_id: inserted[0]?.id ?? null, already_completed: false }
}
