// Framework-internal tables only.
// Application tables (products, inventory, etc.) are AUTO-GENERATED from DML entities at boot.
// NEVER define application tables here.

import { bigint, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

// ──────────────────────────────────────────────
// Workflow checkpoints (for crash recovery)
// ──────────────────────────────────────────────

export const workflowCheckpoints = pgTable(
  'workflow_checkpoints',
  {
    id: serial('id').primaryKey(),
    transaction_id: text('transaction_id').notNull(),
    step_id: text('step_id').notNull(),
    status: text('status').notNull().default('pending'),
    data: jsonb('data').$type<Record<string, unknown>>().default({}),
    error: text('error'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    idx_wf_checkpoint_unique: uniqueIndex('idx_wf_checkpoint_unique').on(table.transaction_id, table.step_id),
    idx_wf_checkpoints_tx: index('idx_wf_checkpoints_tx').on(table.transaction_id),
  }),
)

// ──────────────────────────────────────────────
// Workflow runs (progress tracking — WORKFLOW_PROGRESS.md §5.1)
// ──────────────────────────────────────────────

export const workflowRuns = pgTable(
  'workflow_runs',
  {
    id: text('id').primaryKey(),
    command_name: text('command_name').notNull(),
    status: text('status').notNull().default('pending'),
    steps: jsonb('steps').notNull().default([]),
    input: jsonb('input').notNull().default({}),
    output: jsonb('output'),
    error: jsonb('error'),
    started_at: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completed_at: timestamp('completed_at', { withTimezone: true }),
    cancel_requested_at: timestamp('cancel_requested_at', { withTimezone: true }),
    // Bumped on every step lifecycle transition (updateStep). Used by the orphan
    // reaper on serverless hosts to detect runs whose host disappeared mid-flight.
    heartbeat_at: timestamp('heartbeat_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idx_workflow_runs_cmd_started: index('idx_workflow_runs_cmd_started').on(
      table.command_name,
      table.started_at.desc(),
    ),
  }),
)

// ──────────────────────────────────────────────
// Workflow progress (ephemeral liveness fallback — WORKFLOW_PROGRESS.md §9.2)
// ──────────────────────────────────────────────

/**
 * Fallback table for workflow progress when no Upstash cache is configured.
 * Writes are throttled (500ms) by the DbProgressChannel adapter. The primary
 * key on run_id makes `set()` idempotent via INSERT ... ON CONFLICT.
 */
export const workflowProgress = pgTable('workflow_progress', {
  run_id: text('run_id').primaryKey(),
  step_name: text('step_name').notNull(),
  current: integer('current').notNull(),
  total: integer('total'),
  message: text('message'),
  at_ms: bigint('at_ms', { mode: 'number' }).notNull(),
})

// ──────────────────────────────────────────────
// Events (persistent event bus)
// ──────────────────────────────────────────────

export const events = pgTable(
  'events',
  {
    id: serial('id').primaryKey(),
    event_name: text('event_name').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().default({}),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').default(0),
    max_attempts: integer('max_attempts').default(3),
    last_error: text('last_error'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
    processed_at: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => ({
    idx_events_status: index('idx_events_status').on(table.status),
    idx_events_name: index('idx_events_name').on(table.event_name),
  }),
)

// ──────────────────────────────────────────────
// Job executions (cron tracking)
// ──────────────────────────────────────────────

export const jobExecutions = pgTable(
  'job_executions',
  {
    id: serial('id').primaryKey(),
    job_name: text('job_name').notNull(),
    status: text('status').notNull().default('running'),
    result: jsonb('result'),
    error: text('error'),
    duration_ms: integer('duration_ms'),
    started_at: timestamp('started_at', { withTimezone: true }).defaultNow(),
    completed_at: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    idx_job_executions_name: index('idx_job_executions_name').on(table.job_name),
  }),
)

// ──────────────────────────────────────────────
// Cron heartbeats (proves cron runs automatically)
// ──────────────────────────────────────────────

export const cronHeartbeats = pgTable('cron_heartbeats', {
  id: serial('id').primaryKey(),
  job_name: text('job_name').notNull(),
  message: text('message'),
  executed_at: timestamp('executed_at', { withTimezone: true }).notNull().defaultNow(),
})

// ──────────────────────────────────────────────
// Stats (simple key-value counters)
// ──────────────────────────────────────────────

export const stats = pgTable('stats', {
  key: text('key').primaryKey(),
  value: integer('value').notNull().default(0),
})
