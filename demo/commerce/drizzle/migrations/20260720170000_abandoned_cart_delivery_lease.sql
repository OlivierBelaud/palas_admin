ALTER TABLE "abandoned_cart_messages"
  ADD COLUMN IF NOT EXISTS "provider_status" TEXT
    CHECK ("provider_status" IS NULL OR "provider_status" IN ('SUCCESS', 'FAILURE', 'PENDING')),
  ADD COLUMN IF NOT EXISTS "provider_error" TEXT,
  ADD COLUMN IF NOT EXISTS "provider_observed_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "delivery_claim_token" TEXT,
  ADD COLUMN IF NOT EXISTS "delivery_claimed_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "delivery_attempt_count" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "abandoned_cart_messages_provider_status_idx"
  ON "abandoned_cart_messages" ("provider_status");
CREATE INDEX IF NOT EXISTS "abandoned_cart_messages_provider_observed_at_idx"
  ON "abandoned_cart_messages" ("provider_observed_at");
CREATE INDEX IF NOT EXISTS "abandoned_cart_messages_delivery_claim_token_idx"
  ON "abandoned_cart_messages" ("delivery_claim_token");
CREATE INDEX IF NOT EXISTS "abandoned_cart_messages_delivery_claimed_at_idx"
  ON "abandoned_cart_messages" ("delivery_claimed_at");
