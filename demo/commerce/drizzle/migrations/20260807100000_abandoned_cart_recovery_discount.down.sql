ALTER TABLE "abandoned_cart_messages"
  DROP CONSTRAINT IF EXISTS "abandoned_cart_messages_discount_source_check";

ALTER TABLE "abandoned_cart_messages"
  ADD CONSTRAINT "abandoned_cart_messages_discount_source_check"
  CHECK (
    "discount_source" IS NULL
    OR "discount_source" IN ('klaviyo_welcome', 'shopify_generated')
  );
