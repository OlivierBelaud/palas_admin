CREATE TABLE IF NOT EXISTS "klaviyo_projection_state" (
  "projection_key" TEXT PRIMARY KEY,
  "generation" BIGINT NOT NULL DEFAULT 0,
  "sync_token" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('syncing', 'succeeded', 'failed')),
  "last_attempted_at" TIMESTAMPTZ NOT NULL,
  "requested_through" TIMESTAMPTZ NOT NULL,
  "last_successful_at" TIMESTAMPTZ,
  "covered_through" TIMESTAMPTZ,
  "last_error" TEXT,
  "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "klaviyo_projection_state_singleton"
    CHECK ("projection_key" = 'abandonment_events')
);

COMMENT ON TABLE "klaviyo_projection_state" IS
  'Durable fail-closed watermark for the Klaviyo abandonment-event projection.';
