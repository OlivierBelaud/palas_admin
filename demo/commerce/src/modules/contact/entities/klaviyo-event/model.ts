// Local mirror of Klaviyo "abandonment-related" events. Populated by the
// sync-klaviyo-events cron (hourly) so the abandoned-carts query reads
// from Postgres instead of hitting the slow PostHog DW HogQL synchronously.
//
// Scope: only abandonment-flow metrics (Shopify_Checkout_Abandonned, our
// custom Checkout/Ops Cart Abandoned, plus Received Email subjects matching
// the recovery flow). Not a generic event mirror — extend the cron filter
// when adding new attribution sources.

export default defineModel('KlaviyoEvent', {
  // Klaviyo event id (unique upstream)
  klaviyo_event_id: field.text().unique(),
  // Lower-cased to match contacts.email
  email: field.text().index(),
  // Klaviyo metric name ("Shopify_Checkout_Abandonned", "Received Email", …)
  metric: field.text().index(),
  // Email subject (only set for Received Email events)
  subject: field.text().nullable(),
  // Shopify checkout token extracted from event_properties.checkout_url when
  // present — the precise attribution lever for the abandoned-carts query
  checkout_token: field.text().nullable().index(),
  // When the event happened (Klaviyo datetime)
  occurred_at: field.dateTime().index(),
  // Bookkeeping
  synced_at: field.dateTime(),
})
