-- Event Hub hot log.
-- Stores only a summarized canonical envelope for live debugging and tracking
-- health. PostHog remains the rich/cold event store.

CREATE TABLE IF NOT EXISTS "event_logs" (
  "id" TEXT PRIMARY KEY,
  "event_id" TEXT NOT NULL UNIQUE,
  "event_name" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "received_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "page_type" TEXT,
  "market" TEXT,
  "identity_muid" TEXT,
  "identity_email_sha256" TEXT,
  "distinct_id" TEXT,
  "valid" BOOLEAN NOT NULL DEFAULT TRUE,
  "validation_errors" JSONB,
  "payload_normalized" JSONB,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW(),
  "deleted_at" TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS "event_logs_event_name_idx" ON "event_logs" ("event_name");
CREATE INDEX IF NOT EXISTS "event_logs_source_idx" ON "event_logs" ("source");
CREATE INDEX IF NOT EXISTS "event_logs_received_at_idx" ON "event_logs" ("received_at");
CREATE INDEX IF NOT EXISTS "event_logs_page_type_idx" ON "event_logs" ("page_type");
CREATE INDEX IF NOT EXISTS "event_logs_market_idx" ON "event_logs" ("market");
CREATE INDEX IF NOT EXISTS "event_logs_identity_muid_idx" ON "event_logs" ("identity_muid");
CREATE INDEX IF NOT EXISTS "event_logs_identity_email_sha256_idx" ON "event_logs" ("identity_email_sha256");
CREATE INDEX IF NOT EXISTS "event_logs_distinct_id_idx" ON "event_logs" ("distinct_id");
CREATE INDEX IF NOT EXISTS "event_logs_event_name_received_at_idx" ON "event_logs" ("event_name", "received_at" DESC);
