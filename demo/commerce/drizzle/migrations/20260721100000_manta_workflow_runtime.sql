-- Compatibility schema for @mantajs/core workflow durability.
--
-- Manta 0.2.0-beta.12 exposes and uses these tables in production, but its
-- framework bootstrap does not materialize them. Keep this idempotent so a
-- future framework migration can safely converge on the same schema.

CREATE TABLE IF NOT EXISTS "workflow_runs" (
  "id" TEXT PRIMARY KEY,
  "command_name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "steps" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "input" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "output" JSONB,
  "error" JSONB,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "completed_at" TIMESTAMPTZ,
  "cancel_requested_at" TIMESTAMPTZ,
  "heartbeat_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_workflow_runs_cmd_started"
  ON "workflow_runs" ("command_name", "started_at" DESC);

CREATE TABLE IF NOT EXISTS "workflow_progress" (
  "run_id" TEXT PRIMARY KEY,
  "step_name" TEXT NOT NULL,
  "current" INTEGER NOT NULL,
  "total" INTEGER,
  "message" TEXT,
  "at_ms" BIGINT NOT NULL
);
