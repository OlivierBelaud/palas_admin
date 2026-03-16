// Drizzle schemas — the framework's database schema
// All tables used by the framework are defined here.
// Application modules can extend with their own schemas.

import { pgTable, text, integer, timestamp, jsonb, serial, index, uniqueIndex, pgEnum } from "drizzle-orm/pg-core"

// ──────────────────────────────────────────────
// Enums
// ──────────────────────────────────────────────

export const productStatusEnum = pgEnum("product_status", ["draft", "published", "archived", "active"])

// ──────────────────────────────────────────────
// Products
// ──────────────────────────────────────────────

export const products = pgTable("products", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  sku: text("sku"),
  price: integer("price").notNull().default(0),
  status: productStatusEnum("status").notNull().default("draft"),
  image_urls: text("image_urls").array().default([]),
  catalog_file_url: text("catalog_file_url"),
  metadata: jsonb("metadata").default({}),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp("deleted_at", { withTimezone: true }),
})

// ──────────────────────────────────────────────
// Inventory
// ──────────────────────────────────────────────

export const inventoryItems = pgTable("inventory_items", {
  id: text("id").primaryKey(),
  sku: text("sku").notNull(),
  quantity: integer("quantity").notNull().default(0),
  reorder_point: integer("reorder_point").notNull().default(10),
  warehouse: text("warehouse").notNull().default("default"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_inventory_sku").on(table.sku),
])

// ──────────────────────────────────────────────
// Stats (simple key-value counters)
// ──────────────────────────────────────────────

export const stats = pgTable("stats", {
  key: text("key").primaryKey(),
  value: integer("value").notNull().default(0),
})

// ──────────────────────────────────────────────
// Workflow checkpoints (for crash recovery)
// ──────────────────────────────────────────────

export const workflowCheckpoints = pgTable("workflow_checkpoints", {
  id: serial("id").primaryKey(),
  transaction_id: text("transaction_id").notNull(),
  step_id: text("step_id").notNull(),
  status: text("status").notNull().default("pending"),
  data: jsonb("data").default({}),
  error: text("error"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex("idx_wf_checkpoint_unique").on(table.transaction_id, table.step_id),
  index("idx_wf_checkpoints_tx").on(table.transaction_id),
])

// ──────────────────────────────────────────────
// Workflow executions (top-level tracking)
// ──────────────────────────────────────────────

export const workflowExecutions = pgTable("workflow_executions", {
  transaction_id: text("transaction_id").primaryKey(),
  workflow_name: text("workflow_name").notNull(),
  status: text("status").notNull().default("running"),
  input: jsonb("input").default({}),
  result: jsonb("result"),
  error: text("error"),
  started_at: timestamp("started_at", { withTimezone: true }).defaultNow(),
  completed_at: timestamp("completed_at", { withTimezone: true }),
})

// ──────────────────────────────────────────────
// Events (persistent event bus)
// ──────────────────────────────────────────────

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  event_name: text("event_name").notNull(),
  data: jsonb("data").default({}),
  metadata: jsonb("metadata").default({}),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").default(0),
  max_attempts: integer("max_attempts").default(3),
  last_error: text("last_error"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
  processed_at: timestamp("processed_at", { withTimezone: true }),
}, (table) => [
  index("idx_events_status").on(table.status),
  index("idx_events_name").on(table.event_name),
])

// ──────────────────────────────────────────────
// Job executions (cron tracking)
// ──────────────────────────────────────────────

export const jobExecutions = pgTable("job_executions", {
  id: serial("id").primaryKey(),
  job_name: text("job_name").notNull(),
  status: text("status").notNull().default("running"),
  result: jsonb("result"),
  error: text("error"),
  duration_ms: integer("duration_ms"),
  started_at: timestamp("started_at", { withTimezone: true }).defaultNow(),
  completed_at: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  index("idx_job_executions_name").on(table.job_name),
])

// ──────────────────────────────────────────────
// Cron heartbeats (proves cron runs automatically)
// ──────────────────────────────────────────────

export const cronHeartbeats = pgTable("cron_heartbeats", {
  id: serial("id").primaryKey(),
  job_name: text("job_name").notNull(),
  message: text("message"),
  executed_at: timestamp("executed_at", { withTimezone: true }).notNull().defaultNow(),
})
