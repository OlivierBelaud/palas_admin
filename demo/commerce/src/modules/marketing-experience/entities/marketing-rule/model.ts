export default defineModel('MarketingRule', {
  title: field.text().index(),
  rule_type: field.enum(['order_discount', 'gift_threshold', 'shipping_threshold']).index(),
  status: field.enum(['draft', 'active', 'paused']).default('active').index(),
  starts_at: field.dateTime().index(),
  ends_at: field.dateTime().nullable().index(),

  execution_kind: field.enum(['shopify_discount', 'local_cart_rule', 'shipping_profile']).index(),
  sync_status: field.enum(['local_only', 'synced', 'pending', 'error']).default('local_only').index(),
  shopify_id: field.text().nullable().index(),
  sync_error: field.text().nullable(),

  market_key: field.text().nullable().index(),
  currency_code: field.text().nullable(),
  value_type: field.enum(['percentage', 'fixed_amount']).nullable(),
  value: field.float().nullable(),
  code: field.text().nullable().index(),

  threshold: field.float().nullable(),
  gift_product_id: field.text().nullable(),
  gift_title: field.text().nullable(),
  paid_rate: field.float().nullable(),

  payload: field.json<Record<string, unknown>>().nullable(),
  created_by: field.text().nullable(),
})
