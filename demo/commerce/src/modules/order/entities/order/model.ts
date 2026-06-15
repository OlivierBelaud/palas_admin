// Order — local mirror of a Shopify order, populated by the Shopify
// sync workers (Phase 2). Identifies the order by `shopify_order_id`
// (immutable, unique). `email` is denormalized for cheap joins with
// `contacts`; the canonical 1:N link goes through `order-contact`.

export default defineModel('Order', {
  shopify_order_id: field.text().unique(),

  // Shopify customer id attached to the order when Shopify exposes it.
  // This lets us link orders to contacts even when Shopify redacts or
  // omits the order email.
  shopify_customer_id: field.text().nullable().index(),
  shopify_source_name: field.text().nullable().index(),
  shopify_source_identifier: field.text().nullable(),
  shopify_app_name: field.text().nullable().index(),
  shopify_channel_name: field.text().nullable().index(),
  shopify_tags: field.json<string[]>().nullable(),
  sales_channel: field
    .enum(['online_store', 'pos', 'private_sale', 'wholesale', 'draft_order', 'external_app', 'unknown'])
    .default('unknown')
    .index(),
  include_in_ecommerce_analytics: field.boolean().default(false).index(),
  analytics_exclusion_reason: field.text().nullable(),

  // Email captured at order time — denormalized for fast lookup. May
  // not match `contact.email` if the Shopify customer used a different
  // address (rare but possible), so the link table remains the
  // canonical join.
  email: field.text().nullable().index(),

  // Human-friendly order number from Shopify (e.g. "#1042"). Nullable
  // because draft orders or manual imports may lack it.
  order_number: field.text().nullable(),

  // High-level lifecycle status. Mirrors the typical Shopify state
  // machine; `cancelled` and `refunded` are terminal for accounting
  // purposes.
  status: field.enum(['pending', 'paid', 'fulfilled', 'cancelled', 'refunded']),

  // Raw Shopify status fields kept verbatim so downstream queries can
  // discriminate beyond the simplified `status` above.
  financial_status: field.text().nullable(),
  fulfillment_status: field.text().nullable(),

  total_price: field.float(),
  currency: field.text().default('EUR'),

  // Shipping address snapshot from Shopify. Reporting uses this, not
  // carts.country_code, because a sold country is the final delivery country.
  shipping_country_code: field.text().nullable().index(),
  shipping_country_name: field.text().nullable(),
  shipping_city: field.text().nullable(),
  shipping_province_code: field.text().nullable(),

  // Snapshot of the line items at sync time. Schema mirrors Shopify
  // line_items; we keep it as JSON so we don't have to migrate when
  // Shopify adds fields.
  items: field.json().nullable(),

  placed_at: field.dateTime().nullable(),
  cancelled_at: field.dateTime().nullable(),
  shopify_synced_at: field.dateTime().nullable(),
})
