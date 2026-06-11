const CART_EVENT_NAMES = [
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
  // Navigation language captured from the storefront: the display locale the
  // visitor browsed in if available, else the browser language
  // ($browser_language). Set on ingestion, used (with country_code) to pick the
  // abandoned-cart email language — see emails/abandoned-cart/pick-locale.ts.
  browser_locale: field.text().nullable(),
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

  // Moment exact (Shopify order.created_at) où le paiement a réussi.
  // Distinct de `last_action_at` qui peut être mis à jour par un event
  // ultérieur (refund-handling futur). Renseigné par webhook orders/paid
  // + cron de reconciliation + backfill manuel.
  completed_at: field.dateTime().nullable(),

  // Premier timestamp jamais observé pour ce cart_token (cart:* ou checkout:*).
  // IMMUABLE — figé sur le tout premier event qui crée la ligne, jamais réécrit.
  // Distinct de `created_at` (qui dérive du moment d'écriture en base) : par
  // exemple un rebuild des carts ré-écrit `created_at` mais doit préserver
  // `cart_birth_at` (= moment où le visiteur a réellement commencé son panier).
  // Utilisé par l'attribution session->cart (cohort late-update) et pour les
  // analytics de funnel.
  cart_birth_at: field.dateTime().nullable().index(),

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
  // Who sent the last abandonment-flow email for this cart:
  //   'manta'   → our Resend cron (notify-abandoned-carts)
  //   'klaviyo' → Klaviyo native flow, ingested via sync-klaviyo-events
  // Together with abandon_notified_at this is the unified "who notified, when".
  abandon_notified_source: field.enum(['manta', 'klaviyo']).nullable(),
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
