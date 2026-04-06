// Framework-internal tables only.
// Application tables (products, inventory, etc.) are AUTO-GENERATED from DML entities at boot.
// NEVER define application tables here.

import { index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

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
// Workflow executions (top-level tracking)
// ──────────────────────────────────────────────

export const workflowExecutions = pgTable('workflow_executions', {
  transaction_id: text('transaction_id').primaryKey(),
  workflow_name: text('workflow_name').notNull(),
  status: text('status').notNull().default('running'),
  input: jsonb('input').$type<Record<string, unknown>>().default({}),
  result: jsonb('result'),
  error: text('error'),
  started_at: timestamp('started_at', { withTimezone: true }).defaultNow(),
  completed_at: timestamp('completed_at', { withTimezone: true }),
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
