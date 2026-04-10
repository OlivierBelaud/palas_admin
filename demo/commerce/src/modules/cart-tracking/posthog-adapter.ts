// Pure helpers that map PostHog SDK event payloads to ingestCartEvent input.
// Kept out of the subscriber file so unit tests can import them without
// triggering the top-level `defineSubscriber(...)` global call.

import { CART_EVENT_NAMES, isCartEventName } from './events'

export type PosthogEvent = {
  event?: string
  distinct_id?: string
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
 * Normalize a PostHog event payload into the ingestCartEvent command input shape.
 * Returns null if the event is missing a cart_token or is not a cart/checkout event.
 */
export function toIngestInput(evt: PosthogEvent): Record<string, unknown> | null {
  const eventName = evt.event
  if (!eventName || !isCartEventName(eventName)) return null

  const props = evt.properties ?? {}
  const $set = (props.$set as Record<string, unknown> | undefined) ?? {}
  const cart = (props.cart as Record<string, unknown> | undefined) ?? {}

  const cartToken = (props.cart_token ?? cart.cart_token) as string | undefined
  if (!cartToken) return null

  const distinctId = evt.distinct_id ?? (props.distinct_id as string | undefined) ?? null
  const items = ((cart.items ?? props.items) as unknown[] | undefined) ?? []
  const changedItems = (props.changed_items as unknown[] | null | undefined) ?? null
  const email = ($set.email ?? props.email ?? null) as string | null
  const firstName = ($set.first_name ?? null) as string | null
  const lastName = ($set.last_name ?? null) as string | null
  const phone = ($set.phone ?? null) as string | null
  const city = ($set.city ?? null) as string | null
  const countryCode = ($set.country ?? null) as string | null
  const shopifyCustomerId = props.shopify_customer_id != null ? String(props.shopify_customer_id) : null
  const totalPrice = Number(cart.total_price ?? props.total_price ?? 0)
  const currency = (cart.currency ?? props.currency ?? 'EUR') as string
  const occurredAt = evt.timestamp ?? new Date().toISOString()

  return {
    cart_token: cartToken,
    action: eventName,
    occurred_at: occurredAt,
    distinct_id: distinctId,
    email,
    first_name: firstName,
    last_name: lastName,
    phone,
    city,
    country_code: countryCode,
    shopify_customer_id: shopifyCustomerId,
    items,
    changed_items: changedItems,
    total_price: totalPrice,
    currency,
    order_id: null,
    shopify_order_id: (props.shopify_order_id as string | null | undefined) ?? null,
    is_first_order: (props.is_first_order as boolean | null | undefined) ?? null,
    shipping_method: (props.shipping_method as string | null | undefined) ?? null,
    shipping_price: props.shipping_price != null ? Number(props.shipping_price) : null,
    discounts_amount: props.discounts_amount != null ? Number(props.discounts_amount) : null,
    discounts: (props.discounts as unknown[] | null | undefined) ?? null,
    subtotal_price: props.subtotal_price != null ? Number(props.subtotal_price) : null,
    total_tax: props.total_tax != null ? Number(props.total_tax) : null,
    raw_properties: props,
  }
}

// Re-export for convenience
export { CART_EVENT_NAMES }
