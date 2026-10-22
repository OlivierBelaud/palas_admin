// VisitorLifecycleActorDailyFact — one row per `(day, actor_key)`.
//
// This is a performance cache for /admin/visitor-lifecycle. It preserves
// visitor-level granularity so 7d/30d unique visitor metrics remain correct
// without rescanning every raw visitor_session on each page load.

export default defineModel('VisitorLifecycleActorDailyFact', {
  day: field.text().index(),
  actor_key: field.text().index(),
  first_started_at: field.dateTime().index(),
  segment_at_day_start: field.enum(['unknown', 'known_no_purchase', 'returning_customer']).index(),

  sessions: field.number().default(0),
  cart_viewed: field.boolean().default(false),
  cart_initiated: field.boolean().default(false),
  cart_updated: field.boolean().default(false),
  converted: field.boolean().default(false),
  converted_sessions: field.number().default(0),
  became_known: field.boolean().default(false),
  became_customer: field.boolean().default(false),
  known_without_contact: field.boolean().default(false),
  converted_without_order_id: field.boolean().default(false),
  became_customer_without_contact: field.boolean().default(false),
  order_ids: field.json<string[]>().nullable(),

  computed_at: field.dateTime().index(),
  source_last_event_at: field.dateTime().nullable(),
})
