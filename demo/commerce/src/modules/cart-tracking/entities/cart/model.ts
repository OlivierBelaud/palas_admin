import { CART_EVENT_NAMES } from '../../events'

export default defineModel('Cart', {
  // ── Identity ──────────────────────────────────────────────────────
  cart_token: field.text().unique(),
  distinct_id: field.text().nullable().index(),
  email: field.text().nullable().index(),
  first_name: field.text().nullable(),
  last_name: field.text().nullable(),
  phone: field.text().nullable(),
  city: field.text().nullable(),
  country_code: field.text().nullable(),
  shopify_customer_id: field.text().nullable().index(),

  // ── Current cart state (snapshot, overwritten on every event) ──────
  items: field.json<CartItem[]>().nullable(),
  total_price: field.float().default(0),
  item_count: field.number().default(0),
  currency: field.text().default('EUR'),

  // ── Funnel tracking ───────────────────────────────────────────────
  last_action: field.enum(CART_EVENT_NAMES),
  last_action_at: field.dateTime(),

  // Plus haute étape jamais atteinte (ne redescend jamais)
  //
  // cart                → joue avec le panier (add/remove/view)
  // checkout_started    → a cliqué "Commander" (vérifie prix, promos)
  // checkout_engaged    → a commencé à remplir des infos (contact, adresse, shipping)
  // payment_attempted   → a cliqué "Payer" (intent to pay, pas encore confirmé)
  // completed           → paiement réussi, page "Merci"
  highest_stage: field
    .enum(['cart', 'checkout_started', 'checkout_engaged', 'payment_attempted', 'completed'])
    .default('cart'),

  // Statut du panier — seulement 2 états persistés :
  //   active    → panier en cours (toutes les variantes d'abandon sont dérivées
  //               à la lecture depuis last_action_at + highest_stage, cf.
  //               docs/cart-abandonment-rules.md)
  //   completed → paiement réussi
  //
  // Les anciennes valeurs (cart_abandoned, checkout_abandoned, payment_abandoned)
  // ne sont plus écrites. Les lignes existantes en DB peuvent encore les porter
  // — les queries n'utilisent pas `status` pour discriminer les abandons, elles
  // dérivent tout de highest_stage + last_action_at.
  status: field.enum(['active', 'completed']).default('active'),

  // ── Tokens (three distinct Shopify identifiers) ────────────────────
  // cart_token is already the unique key above
  checkout_token: field.text().nullable(),
  shopify_order_id: field.text().nullable(),

  // ── Checkout details (filled progressively) ───────────────────────
  is_first_order: field.boolean().nullable(),
  shipping_method: field.text().nullable(),
  shipping_price: field.float().nullable(),
  discounts_amount: field.float().nullable(),
  discounts: field.json<CheckoutDiscount[]>().nullable(),
  subtotal_price: field.float().nullable(),
  total_tax: field.float().nullable(),

  // ── Relance idempotence (set by detect-abandoned-carts job) ───────
  abandon_notified_at: field.dateTime().nullable(),
  abandon_notified_count: field.number().default(0),
})

interface ItemDiscount {
  title: string
  amount: number
}

interface CartItem {
  id: string
  product_id: string
  sku?: string
  title: string
  variant_title?: string
  quantity: number
  price: number
  original_price?: number
  line_price?: number
  total_discount?: number
  discounts?: ItemDiscount[]
  image_url?: string
  url?: string
}

interface CheckoutDiscount {
  title: string
  type: string
  value: number | null
  allocation_method?: string
  target_selection?: string
  target_type?: string
}
