// Per-destination delivery log for canonical Event Hub events.
//
// This is the operational trace used by Tracking Health: one row per
// event/destination, with retry state and the compact request/response
// metadata needed to debug GA4/Meta/Ads delivery.

export default defineModel('DispatchLog', {
  event_destination_key: field.text().unique(),
  event_id: field.text().index(),
  canonical_event_name: field.text().index(),
  source_event_name: field.text().nullable().index(),
  destination: field.enum(['ga4']).index(),
  status: field.enum(['pending', 'sending', 'sent', 'invalid', 'error', 'retry', 'not_configured']).index(),

  event_received_at: field.dateTime().index(),
  first_attempt_at: field.dateTime().nullable().index(),
  last_attempt_at: field.dateTime().nullable().index(),
  next_attempt_at: field.dateTime().nullable().index(),
  sent_at: field.dateTime().nullable().index(),
  attempt_count: field.number().default(0),

  http_status: field.number().nullable(),
  error_code: field.text().nullable().index(),
  error_message: field.text().nullable(),

  request_payload: field.json<Record<string, unknown>>().nullable(),
  response_payload: field.json<Record<string, unknown>>().nullable(),
  metadata: field.json<Record<string, unknown>>().nullable(),
})
