// Shadow log for the V2 identity resolver.
//
// This table is diagnostic only: it lets us compare the current V1 identity
// signals with the new V2 resolver without changing PostHog forwarding,
// cart tracking, visitor sessions, or contact mutation paths.

export default defineModel('IdentityResolutionLog', {
  event_id: field.text().nullable().index(),
  event_name: field.text().index(),
  observed_at: field.dateTime().index(),
  resolved_at: field.dateTime().index(),

  posthog_distinct_id: field.text().nullable().index(),
  session_id: field.text().nullable().index(),
  cart_token: field.text().nullable().index(),
  checkout_token: field.text().nullable().index(),

  v1_email_sha256: field.text().nullable().index(),
  v1_source: field.text().nullable().index(),
  v1_contact_id: field.text().nullable().index(),

  v2_email_sha256: field.text().nullable().index(),
  v2_source: field.text().nullable().index(),
  v2_contact_id: field.text().nullable().index(),

  resolution_status: field.enum(['anonymous', 'identified', 'diverged', 'error']).index(),
  matched_v1: field.boolean().default(false).index(),
  duration_ms: field.number().default(0),
  error_message: field.text().nullable(),

  aliases_seen: field.json<Record<string, unknown>>().nullable(),
  evidence: field.json<Record<string, unknown>>().nullable(),
})
