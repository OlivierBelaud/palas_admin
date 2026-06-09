DROP INDEX IF EXISTS "abandoned_cart_messages_discount_code_idx";

ALTER TABLE "abandoned_cart_messages"
  DROP COLUMN IF EXISTS "discount_shopify_id",
  DROP COLUMN IF EXISTS "discount_source",
  DROP COLUMN IF EXISTS "discount_code";
