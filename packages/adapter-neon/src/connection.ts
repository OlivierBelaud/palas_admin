// Neon connection adapter — creates a Drizzle db instance for Neon PostgreSQL
// Handles SSL, pool sizing for serverless, connection timeouts.

import postgres from "postgres"
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js"

export interface NeonDatabaseOptions {
  /** Neon connection string (postgresql://...) */
  url: string
  /** Max connections (default: 1 for serverless) */
  maxConnections?: number
  /** Idle timeout in seconds (default: 0 for serverless) */
  idleTimeout?: number
  /** Connection timeout in seconds (default: 5) */
  connectTimeout?: number
}

export interface NeonDatabase {
  /** Drizzle db instance — use this for all queries */
  db: PostgresJsDatabase
  /** Raw postgres.js SQL instance — for advisory locks and raw SQL when needed */
  sql: postgres.Sql
  /** Close all connections */
  close: () => Promise<void>
}

/**
 * Create a Drizzle database instance configured for Neon serverless.
 *
 * Usage:
 * ```ts
 * const { db, close } = createNeonDatabase({ url: process.env.DATABASE_URL! })
 * const products = await db.select().from(productsTable).where(...)
 * ```
 */
export function createNeonDatabase(options: NeonDatabaseOptions): NeonDatabase {
  const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME

  const sql = postgres(options.url, {
    ssl: "require",
    max: options.maxConnections ?? (isServerless ? 1 : 5),
    idle_timeout: options.idleTimeout ?? (isServerless ? 0 : 30),
    connect_timeout: options.connectTimeout ?? 5,
  })

  const db = drizzle(sql)

  return {
    db,
    sql,
    close: () => sql.end(),
  }
}
