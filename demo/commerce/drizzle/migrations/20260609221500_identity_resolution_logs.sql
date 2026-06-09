-- Shadow identity resolver logs.
--
-- Diagnostic table only: stores one compact comparison row per inbound
-- PostHog event so we can compare the current V1 identity signals against
-- the additive V2 resolver without changing production behavior.

CREATE TABLE IF NOT EXISTS "identity_resolution_logs" (
  "id" TEXT PRIMARY KEY,
  "event_id" TEXT,
  "event_name" TEXT NOT NULL,
  "observed_at" TIMESTAMPTZ NOT NULL,
  "resolved_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "posthog_distinct_id" TEXT,
  "session_id" TEXT,
  "cart_token" TEXT,
  "checkout_token" TEXT,
  "v1_email_sha256" TEXT,
  "v1_source" TEXT,
  "v1_contact_id" TEXT,
  "v2_email_sha256" TEXT,
  "v2_source" TEXT,
  "v2_contact_id" TEXT,
  "resolution_status" TEXT NOT NULL,
  "matched_v1" BOOLEAN NOT NULL DEFAULT FALSE,
  "duration_ms" INTEGER NOT NULL DEFAULT 0,
  "error_message" TEXT,
  "aliases_seen" JSONB,
  "evidence" JSONB,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW(),
  "deleted_at" TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS "identity_resolution_logs_event_id_idx"
  ON "identity_resolution_logs" ("event_id");
CREATE INDEX IF NOT EXISTS "identity_resolution_logs_event_name_idx"
  ON "identity_resolution_logs" ("event_name");
CREATE INDEX IF NOT EXISTS "identity_resolution_logs_observed_at_idx"
  ON "identity_resolution_logs" ("observed_at");
CREATE INDEX IF NOT EXISTS "identity_resolution_logs_resolved_at_idx"
  ON "identity_resolution_logs" ("resolved_at");
CREATE INDEX IF NOT EXISTS "identity_resolution_logs_posthog_distinct_id_idx"
  ON "identity_resolution_logs" ("posthog_distinct_id");
CREATE INDEX IF NOT EXISTS "identity_resolution_logs_session_id_idx"
  ON "identity_resolution_logs" ("session_id");
CREATE INDEX IF NOT EXISTS "identity_resolution_logs_cart_token_idx"
  ON "identity_resolution_logs" ("cart_token");
CREATE INDEX IF NOT EXISTS "identity_resolution_logs_checkout_token_idx"
  ON "identity_resolution_logs" ("checkout_token");
CREATE INDEX IF NOT EXISTS "identity_resolution_logs_v1_email_sha256_idx"
  ON "identity_resolution_logs" ("v1_email_sha256");
CREATE INDEX IF NOT EXISTS "identity_resolution_logs_v1_source_idx"
  ON "identity_resolution_logs" ("v1_source");
CREATE INDEX IF NOT EXISTS "identity_resolution_logs_v1_contact_id_idx"
  ON "identity_resolution_logs" ("v1_contact_id");
CREATE INDEX IF NOT EXISTS "identity_resolution_logs_v2_email_sha256_idx"
  ON "identity_resolution_logs" ("v2_email_sha256");
CREATE INDEX IF NOT EXISTS "identity_resolution_logs_v2_source_idx"
  ON "identity_resolution_logs" ("v2_source");
CREATE INDEX IF NOT EXISTS "identity_resolution_logs_v2_contact_id_idx"
  ON "identity_resolution_logs" ("v2_contact_id");
CREATE INDEX IF NOT EXISTS "identity_resolution_logs_resolution_status_idx"
  ON "identity_resolution_logs" ("resolution_status");
CREATE INDEX IF NOT EXISTS "identity_resolution_logs_matched_v1_idx"
  ON "identity_resolution_logs" ("matched_v1");
CREATE INDEX IF NOT EXISTS "identity_resolution_logs_status_observed_at_idx"
  ON "identity_resolution_logs" ("resolution_status", "observed_at" DESC);
