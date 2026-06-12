ALTER TABLE "abandoned_cart_messages"
  DROP CONSTRAINT IF EXISTS "abandoned_cart_messages_skip_reason_check";

ALTER TABLE "abandoned_cart_messages"
  ADD CONSTRAINT "abandoned_cart_messages_skip_reason_check"
  CHECK (
    "skip_reason" IS NULL OR "skip_reason" IN (
      'shopify_order_found',
      'klaviyo_email_found',
      'opt_out',
      'missing_email',
      'no_products',
      'already_recovered',
      'shopify_check_unavailable',
      'send_error'
    )
  );

ALTER TABLE "abandoned_cart_cases"
  DROP CONSTRAINT IF EXISTS "abandoned_cart_cases_status_check";

ALTER TABLE "abandoned_cart_cases"
  ADD CONSTRAINT "abandoned_cart_cases_status_check"
  CHECK ("status" IN ('open', 'recovered', 'closed_order_found', 'closed_unsubscribed', 'expired'));
