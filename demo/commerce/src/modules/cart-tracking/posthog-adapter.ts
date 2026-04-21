// Pure helpers that map PostHog event payloads to ingestCartEvent input.
// Kept out of the subscriber file so unit tests can import them without
// triggering the top-level `defineSubscriber(...)` global call.
//
// ──────────────────────────────────────────────────────────────────────
// Supports TWO schemas at read-time:
//
//   v2 (unified — current):
//     properties.cart     = CartPayload         // all cart state nested
//     properties.checkout = CheckoutPayload     // checkout-only state nested
//     properties.changed_items / source / discount_code at root
//
//   v1 (legacy — pre-unification):
//     properties.cart_token, properties.items, properties.total_price, etc. at root
//     properties.shopify_order_id, properties.shipping_price, etc. at root
//
// Any line tagged `@legacy-schema-v1` below is fallback for v1 events still
// sitting in PostHog storage. Safe to delete once PostHog retention rolls
// past the v2 switch-over date.
// → BACKLOG.md: "Remove PostHog legacy schema v1"
// ──────────────────────────────────────────────────────────────────────

import { CART_EVENT_NAMES, isCartEventName } from './events'

export type PosthogEvent = {
  event?: string
  distinct_id?: string | null
  timestamp?: string
  properties?: Record<string, unknown>
}

/**
 * Extract the list of events from a PostHog batch body.
 * Handles three shapes: a single event object, an array, or `{ batch: [...] }`.
 */
export function extractPosthogEvents(body: unknown): PosthogEvent[] {
  if (!body) return []
  if (Array.isArray(body)) return body as PosthogEvent[]
  const obj = body as Record<string, unknown>
  if (Array.isArray(obj.batch)) return obj.batch as PosthogEvent[]
  return [obj as PosthogEvent]
}

/**
 * Canonical shape of an event after normalization. All downstream writers
 * (ingestCartEvent, rebuild-carts) MUST read through this, never inspect
 * raw properties directly — that's what keeps the two code paths in sync.
 */
export interface NormalizedCartEvent {
  event: string
  cart_token: string
  distinct_id: string | null
  occurred_at: string

  // Identity
  email: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  city: string | null
  country_code: string | null
  shopify_customer_id: string | null

  // Cart snapshot (from properties.cart)
  items: unknown[]
  total_price: number
  subtotal_price: number | null
  currency: string
  item_count: number
  cart_has_payload: boolean
  total_discount: number | null
  cart_level_discounts: unknown[] | null

  // Checkout snapshot (from properties.checkout)
  checkout_token: string | null
  shopify_order_id: string | null
  is_first_order: boolean | null
  shipping_method: string | null
  shipping_price: number | null
  discounts_amount: number | null
  discounts: unknown[] | null
  total_tax: number | null

  // Event-specific (root of properties)
  changed_items: unknown[] | null
  source: string | null
  discount_code: string | null

  // Full original payload — the source of truth for replay + debugging.
  raw_properties: Record<string, unknown>
}

/**
 * Normalize a PostHog event into the canonical shape the DB cares about.
 * Returns null if the event is not a cart/checkout event or has no cart token.
 */
export function normalizeCartEvent(evt: PosthogEvent): NormalizedCartEvent | null {
  const eventName = evt.event
  if (!eventName || !isCartEventName(eventName)) return null

  const props = evt.properties ?? {}
  const cart = (props.cart as Record<string, unknown> | undefined) ?? undefined
  const checkout = (props.checkout as Record<string, unknown> | undefined) ?? undefined
  const $set = (props.$set as Record<string, unknown> | undefined) ?? {}

  // ── cart_token ────────────────────────────────────────────────────
  // v2 → properties.cart.token (the Shopify cart token, shared across
  // cart + checkout events via the `posthog_cart_token` cart attribute).
  const cartToken =
    (cart?.token as string | undefined) ??
    // @legacy-schema-v1 — v1 used properties.cart_token at root
    (props.cart_token as string | undefined) ??
    (cart?.cart_token as string | undefined)
  if (!cartToken) return null

  // ── Cart payload (items, totals, currency, discounts) ─────────────
  const cartItems = (cart?.items as unknown[] | undefined) ?? undefined
  const cartTotalPrice = num(cart?.total_price)
  const cartSubtotalPrice = num(cart?.subtotal_price)
  const cartCurrency = cart?.currency as string | undefined
  const cartTotalDiscount = num(cart?.total_discount)
  const cartLevelDiscounts = (cart?.cart_level_discounts as unknown[] | undefined) ?? null

  // @legacy-schema-v1 — v1 had items/total_price/currency at root of properties
  const legacyItems = (props.items as unknown[] | undefined) ?? undefined
  const legacyTotalPrice = num(props.total_price)
  const legacySubtotalPrice = num(props.subtotal_price)
  const legacyCurrency = props.currency as string | undefined

  // ── Checkout payload ──────────────────────────────────────────────
  const checkoutItems = (checkout?.items as unknown[] | undefined) ?? undefined
  const checkoutTotalPrice = num(checkout?.total_price)
  const checkoutSubtotalPrice = num(checkout?.subtotal_price)
  const checkoutCurrency = checkout?.currency as string | undefined
  const checkoutEmail = (checkout?.email as string | null | undefined) ?? null
  const checkoutPhone = (checkout?.phone as string | null | undefined) ?? null
  const checkoutToken = (checkout?.token as string | null | undefined) ?? null

  // Fields that live ONLY under checkout in v2, but were at root in v1.
  // Each `?? (props.* @legacy-schema-v1)` line is a legacy fallback.
  const shippingMethod =
    (checkout?.shipping_method as string | null | undefined) ??
    (props.shipping_method as string | null | undefined) ?? // @legacy-schema-v1
    null
  const shippingPrice = num(checkout?.shipping_price) ?? num(props.shipping_price) // @legacy-schema-v1
  const discountsAmount = num(checkout?.discounts_amount) ?? num(props.discounts_amount) // @legacy-schema-v1
  const discounts =
    (checkout?.discounts as unknown[] | null | undefined) ??
    (props.discounts as unknown[] | null | undefined) ?? // @legacy-schema-v1
    null
  const totalTax = num(checkout?.total_tax) ?? num(props.total_tax) // @legacy-schema-v1
  const shopifyOrderId =
    (checkout?.shopify_order_id as string | null | undefined) ??
    (props.shopify_order_id as string | null | undefined) ?? // @legacy-schema-v1
    null
  const shopifyCustomerId =
    (checkout?.shopify_customer_id != null ? String(checkout.shopify_customer_id) : null) ??
    // @legacy-schema-v1 — v1 put shopify_customer_id at root of properties
    (props.shopify_customer_id != null ? String(props.shopify_customer_id) : null)
  const isFirstOrder =
    (checkout?.is_first_order as boolean | null | undefined) ??
    (props.is_first_order as boolean | null | undefined) ?? // @legacy-schema-v1
    null

  // ── Resolution for fields that can come from cart OR checkout ─────
  // - items: cart preferred (richer — discounts/urls), then checkout.items
  // - total_price: checkout wins on checkout events (includes shipping+taxes)
  // - currency: cart preferred (always populated on cart events)
  const items = cartItems ?? checkoutItems ?? legacyItems ?? []
  const totalPrice = checkoutTotalPrice ?? cartTotalPrice ?? legacyTotalPrice ?? 0
  const subtotalPrice = checkoutSubtotalPrice ?? cartSubtotalPrice ?? legacySubtotalPrice
  const currency = cartCurrency ?? checkoutCurrency ?? legacyCurrency ?? 'EUR'

  // A cart payload is "present" when we have items or a non-zero total
  // somewhere. Downstream writers use this to decide whether to preserve
  // the existing snapshot (checkout events can come through without
  // re-embedding cart state).
  const cartHasPayload =
    cartItems != null ||
    cartTotalPrice != null ||
    checkoutItems != null ||
    checkoutTotalPrice != null ||
    // @legacy-schema-v1
    legacyItems != null ||
    legacyTotalPrice != null

  // ── Identity ──────────────────────────────────────────────────────
  // $set is the canonical place for person properties (all schemas).
  // checkout.email is the first available email on checkout:contact_info_submitted.
  const email =
    ($set.email as string | null | undefined) ??
    checkoutEmail ??
    // @legacy-schema-v1 — some v1 pixel events put email at root
    (props.email as string | null | undefined) ??
    null
  const phone = ($set.phone as string | null | undefined) ?? checkoutPhone ?? null

  return {
    event: eventName,
    cart_token: cartToken,
    distinct_id: evt.distinct_id ?? (props.distinct_id as string | undefined) ?? null,
    occurred_at: evt.timestamp ?? new Date().toISOString(),

    email,
    first_name: ($set.first_name as string | null | undefined) ?? null,
    last_name: ($set.last_name as string | null | undefined) ?? null,
    phone,
    city: ($set.city as string | null | undefined) ?? null,
    country_code: ($set.country as string | null | undefined) ?? null,
    shopify_customer_id: shopifyCustomerId,

    items,
    total_price: totalPrice,
    subtotal_price: subtotalPrice,
    currency,
    item_count: items.length,
    cart_has_payload: cartHasPayload,
    total_discount: cartTotalDiscount,
    cart_level_discounts: cartLevelDiscounts,

    checkout_token: checkoutToken,
    shopify_order_id: shopifyOrderId,
    is_first_order: isFirstOrder,
    shipping_method: shippingMethod,
    shipping_price: shippingPrice,
    discounts_amount: discountsAmount,
    discounts,
    total_tax: totalTax,

    changed_items: (props.changed_items as unknown[] | null | undefined) ?? null,
    source: (props.source as string | null | undefined) ?? null,
    discount_code: (props.discount_code as string | null | undefined) ?? null,

    raw_properties: props,
  }
}

/**
 * Map a normalized event to the ingestCartEvent command input shape.
 * Thin wrapper — all reading logic lives in `normalizeCartEvent`.
 */
export function toIngestInput(evt: PosthogEvent): Record<string, unknown> | null {
  const n = normalizeCartEvent(evt)
  if (!n) return null
  return {
    cart_token: n.cart_token,
    action: n.event,
    occurred_at: n.occurred_at,
    distinct_id: n.distinct_id,
    email: n.email,
    first_name: n.first_name,
    last_name: n.last_name,
    phone: n.phone,
    city: n.city,
    country_code: n.country_code,
    shopify_customer_id: n.shopify_customer_id,
    items: n.items,
    changed_items: n.changed_items,
    total_price: n.total_price,
    subtotal_price: n.subtotal_price,
    currency: n.currency,
    checkout_token: n.checkout_token,
    order_id: null,
    shopify_order_id: n.shopify_order_id,
    is_first_order: n.is_first_order,
    shipping_method: n.shipping_method,
    shipping_price: n.shipping_price,
    discounts_amount: n.discounts_amount,
    discounts: n.discounts,
    total_tax: n.total_tax,
    total_discount: n.total_discount,
    cart_level_discounts: n.cart_level_discounts,
    raw_properties: n.raw_properties,
  }
}

function num(v: unknown): number | null {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Re-export for convenience
export { CART_EVENT_NAMES }
