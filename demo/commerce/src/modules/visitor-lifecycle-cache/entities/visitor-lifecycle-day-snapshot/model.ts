// VisitorLifecycleDaySnapshot — coverage marker for actor daily facts.
//
// A day is safe to read from `visitor_lifecycle_actor_daily_facts` only when
// a matching marker exists here. Without this, a day with zero facts could mean
// either "no traffic" or "not computed yet".

export default defineModel('VisitorLifecycleDaySnapshot', {
  day: field.text().unique(),
  status: field.enum(['ready', 'failed']).default('ready').index(),
  sessions_count: field.number().default(0),
  facts_count: field.number().default(0),
  computed_at: field.dateTime().index(),
  source_max_last_event_at: field.dateTime().nullable(),
  error_message: field.text().nullable(),
})
