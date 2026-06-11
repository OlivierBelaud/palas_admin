export default defineModel('AbandonedCartCase', {
  cart_id: field.text().unique().index(),
  contact_id: field.text().nullable().index(),
  email: field.text().index(),
  cart_token: field.text().nullable().index(),
  checkout_token: field.text().nullable().index(),

  case_type: field.enum(['cart_abandoned', 'checkout_abandoned', 'payment_help']).index(),
  status: field
    .enum(['open', 'recovered', 'closed_order_found', 'closed_unsubscribed', 'expired'])
    .default('open')
    .index(),
  current_sequence_version: field.number().default(1).index(),
  sequence_started_at: field.dateTime().nullable().index(),
  stage_at_open: field.text().nullable(),
  last_cart_action_at: field.dateTime().index(),
  opened_at: field.dateTime().index(),

  recovered_at: field.dateTime().nullable().index(),
  recovered_order_id: field.text().nullable().index(),
  recovered_amount: field.float().nullable(),
  recovered_source_message_id: field.text().nullable().index(),
})
