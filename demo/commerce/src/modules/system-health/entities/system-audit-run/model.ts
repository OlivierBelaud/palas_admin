export default defineModel('SystemAuditRun', {
  trigger: field.enum(['nightly', 'manual']).index(),
  status: field.enum(['running', 'completed', 'failed']).index(),
  overall_status: field.enum(['ok', 'warning', 'critical', 'unknown']).default('unknown').index(),
  started_at: field.dateTime().index(),
  finished_at: field.dateTime().nullable().index(),
  summary: field.json<Record<string, unknown>>().nullable(),
  error_message: field.text().nullable(),
})
