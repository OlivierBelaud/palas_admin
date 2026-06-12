export default defineModel('SystemAuditFinding', {
  run_id: field.text().index(),
  source: field.enum(['shopify', 'posthog', 'klaviyo', 'event_hub', 'abandoned_cart_emails', 'system']).index(),
  key: field.text().index(),
  severity: field.enum(['critical', 'warning', 'info']).index(),
  title: field.text(),
  summary: field.text(),
  count: field.number().default(0),
  href: field.text().nullable(),
  details: field.json<string[]>().nullable(),
  observed_at: field.dateTime().index(),
})
