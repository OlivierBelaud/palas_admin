// Single source of truth for cart-tracking event names.
// Used by:
//  - cart and cart-event entity enums (modules/cart-tracking/entities/*/model.ts)
//  - ingestCartEvent command (src/commands/admin/ingest-cart-event.ts)
//  - posthog-cart-tracker subscriber (src/subscribers/posthog-cart-tracker.ts)
//  - admin cart detail page (src/spa/admin/pages/paniers/[id]/page.ts)
//
// IMPORTANT: keep these names in sync with what the PostHog JS SDK actually
// emits from the storefront — any drift means events get silently dropped.

export const CART_EVENT_NAMES = [
  'cart:product_added',
  'cart:product_removed',
  'cart:updated',
  'cart:cleared',
  'cart:viewed',
  'cart:closed',
  'cart:discount_applied',
  'checkout:started',
  'checkout:contact_info_submitted',
  'checkout:address_info_submitted',
  'checkout:shipping_info_submitted',
  'checkout:payment_info_submitted',
  'checkout:completed',
] as const

export type CartEventName = (typeof CART_EVENT_NAMES)[number]

export function isCartEventName(name: unknown): name is CartEventName {
  return typeof name === 'string' && (CART_EVENT_NAMES as readonly string[]).includes(name)
}
