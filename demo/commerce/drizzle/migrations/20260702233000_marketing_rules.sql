CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "marketing_rules" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "title" TEXT NOT NULL,
  "rule_type" TEXT NOT NULL CHECK ("rule_type" IN ('order_discount', 'first_order_discount', 'gift_threshold', 'shipping_threshold')),
  "status" TEXT NOT NULL DEFAULT 'active' CHECK ("status" IN ('draft', 'active', 'paused')),
  "starts_at" TIMESTAMPTZ NOT NULL,
  "ends_at" TIMESTAMPTZ,
  "execution_kind" TEXT NOT NULL CHECK ("execution_kind" IN ('shopify_discount', 'local_cart_rule', 'shipping_profile')),
  "sync_status" TEXT NOT NULL DEFAULT 'local_only' CHECK ("sync_status" IN ('local_only', 'synced', 'pending', 'error')),
  "shopify_id" TEXT,
  "sync_error" TEXT,
  "market_key" TEXT,
  "currency_code" TEXT,
  "value_type" TEXT CHECK ("value_type" IN ('percentage', 'fixed_amount')),
  "value" DOUBLE PRECISION,
  "code" TEXT,
  "threshold" DOUBLE PRECISION,
  "gift_product_id" TEXT,
  "gift_title" TEXT,
  "paid_rate" DOUBLE PRECISION,
  "payload" JSONB,
  "created_by" TEXT,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW(),
  "deleted_at" TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS "marketing_rules_rule_type_idx" ON "marketing_rules" ("rule_type");
CREATE INDEX IF NOT EXISTS "marketing_rules_status_idx" ON "marketing_rules" ("status");
CREATE INDEX IF NOT EXISTS "marketing_rules_starts_at_idx" ON "marketing_rules" ("starts_at");
CREATE INDEX IF NOT EXISTS "marketing_rules_ends_at_idx" ON "marketing_rules" ("ends_at");
CREATE INDEX IF NOT EXISTS "marketing_rules_execution_kind_idx" ON "marketing_rules" ("execution_kind");
CREATE INDEX IF NOT EXISTS "marketing_rules_sync_status_idx" ON "marketing_rules" ("sync_status");
CREATE INDEX IF NOT EXISTS "marketing_rules_shopify_id_idx" ON "marketing_rules" ("shopify_id");
CREATE INDEX IF NOT EXISTS "marketing_rules_market_key_idx" ON "marketing_rules" ("market_key");
CREATE INDEX IF NOT EXISTS "marketing_rules_code_idx" ON "marketing_rules" ("code");
