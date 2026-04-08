
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
  last_action: field.enum([
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
  ]),
  last_action_at: field.dateTime(),

  // Plus haute étape jamais atteinte (ne redescend jamais)
  //
  // cart                → joue avec le panier (add/remove/view)
  // checkout_started    → a cliqué "Commander" (vérifie prix, promos)
  // checkout_engaged    → a commencé à remplir des infos (contact, adresse, shipping)
  // payment_attempted   → a cliqué "Payer" (intent to pay, pas encore confirmé)
  // completed           → paiement réussi, page "Merci"
  highest_stage: field.enum([
    'cart',
    'checkout_started',
    'checkout_engaged',
    'payment_attempted',
    'completed',
  ]).default('cart'),

  // Statut du panier — reflète OÙ l'abandon a eu lieu
  //
  // active              → panier en cours, pas encore abandonné
  // cart_abandoned       → a joué avec le panier mais jamais checkout
  // checkout_abandoned   → a démarré le checkout mais n'a pas payé
  // payment_abandoned    → a cliqué "Payer" mais paiement échoué/abandonné
  // completed            → paiement réussi
  status: field.enum([
    'active',
    'cart_abandoned',
    'checkout_abandoned',
    'payment_abandoned',
    'completed',
  ]).default('active'),

  // ── Checkout details (filled progressively) ───────────────────────
  order_id: field.text().nullable(),
  shopify_order_id: field.text().nullable(),
  is_first_order: field.boolean().nullable(),
  shipping_method: field.text().nullable(),
  shipping_price: field.float().nullable(),
  discounts_amount: field.float().nullable(),
  discounts: field.json<CheckoutDiscount[]>().nullable(),
  subtotal_price: field.float().nullable(),
  total_tax: field.float().nullable(),
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
