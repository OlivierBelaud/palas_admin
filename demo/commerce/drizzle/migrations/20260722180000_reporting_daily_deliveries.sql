CREATE TABLE IF NOT EXISTS "reporting_daily_deliveries" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "day" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Europe/Paris',
  "recipient" TEXT NOT NULL,
  "recipient_normalized" TEXT NOT NULL,
  "revision" TEXT NOT NULL DEFAULT 'default',
  "idempotency_key" TEXT NOT NULL,
  "content_payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending'
    CHECK ("status" IN ('pending', 'claimed', 'succeeded', 'failed', 'reconciliation_required')),
  "provider_status" TEXT
    CHECK ("provider_status" IS NULL OR "provider_status" IN ('SUCCESS', 'FAILURE', 'PENDING')),
  "provider_message_id" TEXT,
  "provider_error" TEXT,
  "provider_observed_at" TIMESTAMPTZ,
  "claim_token" TEXT,
  "claimed_at" TIMESTAMPTZ,
  "claim_expires_at" TIMESTAMPTZ,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ,
  "last_attempted_at" TIMESTAMPTZ,
  "sent_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "deleted_at" TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS "reporting_daily_deliveries_key_uq"
  ON "reporting_daily_deliveries" ("idempotency_key")
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "reporting_daily_deliveries_recipient_revision_uq"
  ON "reporting_daily_deliveries" ("day", "timezone", "recipient_normalized", "revision")
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "reporting_daily_deliveries_claim_expiry_idx"
  ON "reporting_daily_deliveries" ("claim_expires_at")
  WHERE "deleted_at" IS NULL AND "status" = 'claimed';

CREATE INDEX IF NOT EXISTS "reporting_daily_deliveries_retry_due_idx"
  ON "reporting_daily_deliveries" ("next_attempt_at", "day")
  WHERE "deleted_at" IS NULL AND "status" <> 'succeeded' AND "attempt_count" < 5;
