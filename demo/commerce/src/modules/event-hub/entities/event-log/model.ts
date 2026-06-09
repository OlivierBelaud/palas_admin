// Short-lived hot log for the Palas server-side Event Hub.
// PostHog remains the cold/rich event store; this table is for live debugging,
// filtering, and retention-bounded tracking health in the admin.

export default defineModel('EventLog', {
  event_id: field.text().unique(),
  event_name: field.text().index(),
  source: field.text().index(),
  received_at: field.dateTime().index(),

  page_type: field.text().nullable().index(),
  market: field.text().nullable().index(),

  identity_muid: field.text().nullable().index(),
  identity_email_sha256: field.text().nullable().index(),
  distinct_id: field.text().nullable().index(),

  valid: field.boolean().default(true),
  validation_errors: field.json<string[]>().nullable(),

  // Deliberately summarized. Do not use this table as a raw event warehouse.
  payload_normalized: field.json<Record<string, unknown>>().nullable(),
})
