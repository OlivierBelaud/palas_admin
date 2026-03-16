// SQL migrations for Neon adapters — run at bootstrap
import type postgres from "postgres"

export async function runMigrations(sql: postgres.Sql): Promise<void> {
  // Workflow checkpoints
  await sql`
    CREATE TABLE IF NOT EXISTS workflow_checkpoints (
      id SERIAL PRIMARY KEY,
      transaction_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      data JSONB DEFAULT '{}',
      error TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(transaction_id, step_id)
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_wf_checkpoints_tx ON workflow_checkpoints(transaction_id)`

  // Workflow executions (top-level tracking)
  await sql`
    CREATE TABLE IF NOT EXISTS workflow_executions (
      transaction_id TEXT PRIMARY KEY,
      workflow_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      input JSONB DEFAULT '{}',
      result JSONB,
      error TEXT,
      started_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )
  `

  // Events (persistent event bus)
  await sql`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      event_name TEXT NOT NULL,
      data JSONB DEFAULT '{}',
      metadata JSONB DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3,
      last_error TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_events_status ON events(status)`
  await sql`CREATE INDEX IF NOT EXISTS idx_events_name ON events(event_name)`

  // Job executions
  await sql`
    CREATE TABLE IF NOT EXISTS job_executions (
      id SERIAL PRIMARY KEY,
      job_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      result JSONB,
      error TEXT,
      duration_ms INTEGER,
      started_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_job_executions_name ON job_executions(job_name)`
}
