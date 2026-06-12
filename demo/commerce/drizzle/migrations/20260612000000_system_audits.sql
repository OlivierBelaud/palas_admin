CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "system_audit_runs" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "trigger" TEXT NOT NULL CHECK ("trigger" IN ('nightly', 'manual')),
  "status" TEXT NOT NULL CHECK ("status" IN ('running', 'completed', 'failed')),
  "overall_status" TEXT NOT NULL DEFAULT 'unknown' CHECK ("overall_status" IN ('ok', 'warning', 'critical', 'unknown')),
  "started_at" TIMESTAMPTZ NOT NULL,
  "finished_at" TIMESTAMPTZ,
  "summary" JSONB,
  "error_message" TEXT,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW(),
  "deleted_at" TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS "system_audit_runs_trigger_idx" ON "system_audit_runs" ("trigger");
CREATE INDEX IF NOT EXISTS "system_audit_runs_status_idx" ON "system_audit_runs" ("status");
CREATE INDEX IF NOT EXISTS "system_audit_runs_overall_status_idx" ON "system_audit_runs" ("overall_status");
CREATE INDEX IF NOT EXISTS "system_audit_runs_started_at_idx" ON "system_audit_runs" ("started_at");
CREATE INDEX IF NOT EXISTS "system_audit_runs_finished_at_idx" ON "system_audit_runs" ("finished_at");

CREATE TABLE IF NOT EXISTS "system_audit_findings" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "run_id" TEXT NOT NULL,
  "source" TEXT NOT NULL CHECK ("source" IN ('shopify', 'posthog', 'klaviyo', 'event_hub', 'abandoned_cart_emails', 'system')),
  "key" TEXT NOT NULL,
  "severity" TEXT NOT NULL CHECK ("severity" IN ('critical', 'warning', 'info')),
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "href" TEXT,
  "details" JSONB,
  "observed_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW(),
  "deleted_at" TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS "system_audit_findings_run_id_idx" ON "system_audit_findings" ("run_id");
CREATE INDEX IF NOT EXISTS "system_audit_findings_source_idx" ON "system_audit_findings" ("source");
CREATE INDEX IF NOT EXISTS "system_audit_findings_key_idx" ON "system_audit_findings" ("key");
CREATE INDEX IF NOT EXISTS "system_audit_findings_severity_idx" ON "system_audit_findings" ("severity");
CREATE INDEX IF NOT EXISTS "system_audit_findings_observed_at_idx" ON "system_audit_findings" ("observed_at");
CREATE INDEX IF NOT EXISTS "system_audit_findings_run_severity_idx"
  ON "system_audit_findings" ("run_id", "severity");
