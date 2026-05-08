// Contact — anyone we know an email for, regardless of purchase status.
// `customers` is just a derived filter (orders_count > 0). Backed by
// data we collect from PostHog (cart events), Shopify (customers), and
// Klaviyo (subscribed/suppressed). The contact email is the natural key
// (lowercased upstream); orders + carts join through cross-module links.

export default defineModel('Contact', {
  // ── Identity ──────────────────────────────────────────────────────
  email: field.text().unique().searchable(),
  phone: field.text().nullable(),
  // BCP-47 locale tag (e.g. 'fr-FR'). Default = 'fr-FR' since the
  // commerce store is FR-first; updated from Klaviyo profile or
  // checkout signals.
  locale: field.text().default('fr-FR'),

  first_name: field.text().nullable().searchable(),
  last_name: field.text().nullable().searchable(),
  country_code: field.text().nullable(),
  city: field.text().nullable(),

  // ── External system IDs ───────────────────────────────────────────
  shopify_customer_id: field.text().nullable().index(),
  klaviyo_profile_id: field.text().nullable().index(),
  distinct_id: field.text().nullable().index(),

  // ── E-commerce aggregates (synced from Shopify) ───────────────────
  orders_count: field.number().default(0),
  total_spent: field.float().default(0),
  first_order_at: field.dateTime().nullable(),
  last_order_at: field.dateTime().nullable(),

  // ── Klaviyo subscription state ────────────────────────────────────
  klaviyo_subscribed: field.boolean().default(false),
  klaviyo_suppressed: field.boolean().default(false),

  // ── Sync timestamps ───────────────────────────────────────────────
  shopify_synced_at: field.dateTime().nullable(),
  klaviyo_synced_at: field.dateTime().nullable(),
  last_activity_at: field.dateTime().nullable(),
})
