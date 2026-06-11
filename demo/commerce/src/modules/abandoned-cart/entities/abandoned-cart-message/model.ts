export default defineModel('AbandonedCartMessage', {
  case_id: field.text().index(),
  cart_id: field.text().index(),
  email: field.text().index(),

  message_type: field
    .enum(['abandoned_cart_1', 'abandoned_cart_2', 'abandoned_cart_3', 'payment_help_1', 'klaviyo_abandoned'])
    .index(),
  sequence_version: field.number().default(1).index(),
  sequence_started_at: field.dateTime().nullable().index(),
  status: field.enum(['pending', 'sent', 'skipped', 'failed']).default('pending').index(),
  scheduled_for: field.dateTime().index(),
  sent_at: field.dateTime().nullable().index(),

  provider: field.text().nullable(),
  provider_message_id: field.text().nullable(),
  template_key: field.text().nullable(),
  locale: field.text().nullable(),
  subject: field.text().nullable(),
  idempotency_key: field.text().nullable().index(),
  discount_code: field.text().nullable().index(),
  discount_source: field.enum(['klaviyo_welcome', 'shopify_generated']).nullable().index(),
  discount_shopify_id: field.text().nullable(),
  snapshot_html_key: field.text().nullable(),
  snapshot_html_url: field.text().nullable(),
  snapshot_text_key: field.text().nullable(),
  snapshot_text_url: field.text().nullable(),
  snapshot_subject: field.text().nullable(),
  snapshot_sha256: field.text().nullable().index(),
  snapshot_saved_at: field.dateTime().nullable().index(),
  snapshot_error: field.text().nullable(),
  skip_reason: field
    .enum([
      'shopify_order_found',
      'klaviyo_email_found',
      'opt_out',
      'missing_email',
      'no_products',
      'already_recovered',
      'shopify_check_unavailable',
      'send_error',
    ])
    .nullable()
    .index(),
  error_message: field.text().nullable(),
})
