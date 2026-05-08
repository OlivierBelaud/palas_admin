// Klaviyo exchange-id → email cache.
// When a marketing link arrives carrying `?k=<exchange_id>` we resolve
// it once via Klaviyo's profile-import endpoint and persist the result
// here so subsequent visits skip the round-trip. We do NOT store a
// foreign key to `contacts` — the contact may not exist yet at lookup
// time. Downstream code joins on lowercased `email`.

export default defineModel('KlaviyoExchangeResolved', {
  // The opaque value Klaviyo includes in `?k=<exchange_id>` links.
  exchange_id: field.text().unique(),

  // Resolved email (lowercased upstream). Indexed because the most
  // common query is "give me everything we know about <email>".
  email: field.text().index(),

  resolved_at: field.dateTime(),
  expires_at: field.dateTime().nullable(),
})
