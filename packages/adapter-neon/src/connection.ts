// Neon connection adapter — uses @neondatabase/serverless for fast WebSocket connections
// Falls back to postgres.js for local dev (non-Neon databases)

import { neon } from "@neondatabase/serverless"
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http"
import postgres from "postgres"
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import type { NeonHttpDatabase } from "drizzle-orm/neon-http"

export interface NeonDatabaseOptions {
  /** Connection string (postgresql://...) */
  url: string
}

export interface NeonDatabase {
  /** Drizzle db instance — use this for all queries */
  db: NeonHttpDatabase | PostgresJsDatabase
  /** Raw SQL function for DDL (CREATE TABLE etc.) */
  rawSql: (query: string) => Promise<any>
  /** Close connections (no-op for HTTP mode) */
  close: () => Promise<void>
}

/**
 * Create a Drizzle database instance optimized for the environment.
 *
 * - On Vercel / serverless: uses @neondatabase/serverless (HTTP/WebSocket, no TCP)
 * - On local dev: uses postgres.js (TCP connection)
 */
export function createNeonDatabase(options: NeonDatabaseOptions): NeonDatabase {
  const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME
  const isNeon = options.url.includes("neon.tech") || options.url.includes("neon.")

  // Serverless + Neon → use HTTP driver (fastest cold start, no TCP handshake)
  if (isServerless && isNeon) {
    const sql = neon(options.url)
    const db = drizzleNeon(sql)

    return {
      db: db as any,
      rawSql: async (query: string) => sql(query),
      close: async () => {},
    }
  }

  // Local dev or non-Neon → use postgres.js TCP driver
  const pgSql = postgres(options.url, {
    ssl: isNeon ? "require" : undefined,
    max: isServerless ? 1 : 5,
    idle_timeout: isServerless ? 0 : 30,
    connect_timeout: 5,
  })
  const db = drizzlePg(pgSql)

  return {
    db: db as any,
    rawSql: async (query: string) => pgSql.unsafe(query),
    close: () => pgSql.end(),
  }
}
