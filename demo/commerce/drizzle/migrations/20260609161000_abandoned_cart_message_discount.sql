ALTER TABLE "abandoned_cart_messages"
  ADD COLUMN IF NOT EXISTS "discount_code" TEXT,
  ADD COLUMN IF NOT EXISTS "discount_source" TEXT CHECK (
    "discount_source" IS NULL OR "discount_source" IN ('klaviyo_welcome', 'shopify_generated')
  ),
  ADD COLUMN IF NOT EXISTS "discount_shopify_id" TEXT;

CREATE INDEX IF NOT EXISTS "abandoned_cart_messages_discount_code_idx"
  ON "abandoned_cart_messages" ("discount_code");
