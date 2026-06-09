-- Event Hub destination dispatch log.
--
-- One compact operational row per canonical event/destination. This is not
-- the analytics warehouse; it is the retry/debug ledger used by Tracking
-- Health to prove whether GA4/Meta/Ads delivery happened.

CREATE TABLE IF NOT EXISTS "dispatch_logs" (
  "id" TEXT PRIMARY KEY,
  "event_destination_key" TEXT NOT NULL UNIQUE,
  "event_id" TEXT NOT NULL,
  "canonical_event_name" TEXT NOT NULL,
  "source_event_name" TEXT,
  "destination" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "event_received_at" TIMESTAMPTZ NOT NULL,
  "first_attempt_at" TIMESTAMPTZ,
  "last_attempt_at" TIMESTAMPTZ,
  "next_attempt_at" TIMESTAMPTZ,
  "sent_at" TIMESTAMPTZ,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "http_status" INTEGER,
  "error_code" TEXT,
  "error_message" TEXT,
  "request_payload" JSONB,
  "response_payload" JSONB,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW(),
  "deleted_at" TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS "dispatch_logs_event_id_idx" ON "dispatch_logs" ("event_id");
CREATE INDEX IF NOT EXISTS "dispatch_logs_canonical_event_name_idx" ON "dispatch_logs" ("canonical_event_name");
CREATE INDEX IF NOT EXISTS "dispatch_logs_source_event_name_idx" ON "dispatch_logs" ("source_event_name");
CREATE INDEX IF NOT EXISTS "dispatch_logs_destination_idx" ON "dispatch_logs" ("destination");
CREATE INDEX IF NOT EXISTS "dispatch_logs_status_idx" ON "dispatch_logs" ("status");
CREATE INDEX IF NOT EXISTS "dispatch_logs_event_received_at_idx" ON "dispatch_logs" ("event_received_at");
CREATE INDEX IF NOT EXISTS "dispatch_logs_first_attempt_at_idx" ON "dispatch_logs" ("first_attempt_at");
CREATE INDEX IF NOT EXISTS "dispatch_logs_last_attempt_at_idx" ON "dispatch_logs" ("last_attempt_at");
CREATE INDEX IF NOT EXISTS "dispatch_logs_next_attempt_at_idx" ON "dispatch_logs" ("next_attempt_at");
CREATE INDEX IF NOT EXISTS "dispatch_logs_sent_at_idx" ON "dispatch_logs" ("sent_at");
CREATE INDEX IF NOT EXISTS "dispatch_logs_error_code_idx" ON "dispatch_logs" ("error_code");
CREATE INDEX IF NOT EXISTS "dispatch_logs_destination_status_next_attempt_idx"
  ON "dispatch_logs" ("destination", "status", "next_attempt_at");
CREATE INDEX IF NOT EXISTS "dispatch_logs_destination_received_at_idx"
  ON "dispatch_logs" ("destination", "event_received_at" DESC);
