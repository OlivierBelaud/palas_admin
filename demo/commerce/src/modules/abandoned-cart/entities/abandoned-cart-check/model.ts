export default defineModel('AbandonedCartCheck', {
  case_id: field.text().index(),
  message_id: field.text().nullable().index(),
  check_type: field.enum(['shopify_order', 'klaviyo_email', 'opt_out']).index(),
  status: field.enum(['passed', 'blocked', 'error', 'unknown']).index(),
  raw_summary: field.text().nullable(),
  checked_at: field.dateTime().index(),
})
