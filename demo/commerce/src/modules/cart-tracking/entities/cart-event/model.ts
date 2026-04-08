
export default defineModel('CartEvent', {
  cart_id: field.text().index(),

  action: field.enum([
    'cart:product_added',
    'cart:product_removed',
    'cart:updated',
    'cart:cleared',
    'cart:viewed',
    'cart:closed',
    'checkout:started',
    'checkout:contact_info_submitted',
    'checkout:address_info_submitted',
    'checkout:shipping_info_submitted',
    'checkout:payment_info_submitted',
    'checkout:completed',
  ]),

  // ── Full cart snapshot at this moment ──────────────────────────────
  items_snapshot: field.json<CartItem[]>(),
  total_price: field.float(),
  item_count: field.number(),
  currency: field.text().default('EUR'),

  // ── What changed (for cart:product_added/removed/updated) ─────────
  changed_items: field.json<ChangedItem[]>().nullable(),

  // ── Context ───────────────────────────────────────────────────────
  occurred_at: field.dateTime(),
  distinct_id: field.text().nullable(),
  email: field.text().nullable(),

  // ── Checkout-specific fields (null for cart events) ───────────────
  order_id: field.text().nullable(),
  shipping_method: field.text().nullable(),
  shipping_price: field.float().nullable(),
  discounts_amount: field.float().nullable(),
  discounts: field.json<CheckoutDiscount[]>().nullable(),

  // ── Raw event for debugging ───────────────────────────────────────
  raw_properties: field.json().nullable(),
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
  quantity: number
  price: number
  original_price?: number
  line_price?: number
  total_discount?: number
  discounts?: ItemDiscount[]
  image_url?: string
}

interface ChangedItem extends CartItem {
  quantity_change: number
}

interface CheckoutDiscount {
  title: string
  type: string
  value: number | null
}
