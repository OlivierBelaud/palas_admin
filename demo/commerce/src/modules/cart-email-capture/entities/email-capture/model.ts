// Email captured via the cart drawer "surprise" mini-form.
// Each row = one submission; we don't dedupe so admin can see resubmissions.

export default defineModel('EmailCapture', {
  email: field.text().index(),
  cart_token: field.text().nullable().index(),

  // How the capture happened. Today only 'cart_drawer_surprise'; leave
  // text-typed so we can add other surfaces without a migration.
  source: field.text().default('cart_drawer_surprise'),

  // Locale/market at time of capture — 'fr', 'uk', 'en', etc. Inferred
  // client-side from Shopify's `request.locale.iso_code` / market.
  market: field.text().nullable(),

  // PostHog distinct_id at submission time, so the client-side identity
  // can be merged with the identified profile when we call $identify.
  posthog_distinct_id: field.text().nullable(),

  // Set by clients running with the feature flag (`?_px=1` → header
  // `X-Palas-Test: 1`). When true, the command MUST skip Klaviyo/PostHog
  // side effects and only persist the row.
  is_test: field.boolean().default(false),

  // Side-effect tracking — null until the dispatch call succeeds.
  klaviyo_synced_at: field.dateTime().nullable(),
  posthog_synced_at: field.dateTime().nullable(),

  // User-agent + remote IP at submission — useful for spam filtering later.
  user_agent: field.text().nullable(),
  remote_ip: field.text().nullable(),
})
