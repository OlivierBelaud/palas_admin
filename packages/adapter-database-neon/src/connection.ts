// Neon connection — copied from @manta/adapter-neon for self-contained package

import { neon, neonConfig, Pool } from '@neondatabase/serverless'
import { drizzle as drizzleNeonWs } from 'drizzle-orm/neon-serverless'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

export interface NeonDatabaseOptions {
  /** Connection string (postgresql://...) */
  url: string
}

export interface NeonDatabase {
  /** Drizzle db instance — use this for all queries */
  db: PostgresJsDatabase | ReturnType<typeof drizzleNeonWs>
  /** Raw SQL function for DDL (CREATE TABLE etc.) */
  rawSql: (query: string, params?: unknown[]) => Promise<unknown>
  /** Close connections */
  close: () => Promise<void>
}

/**
 * Create a Drizzle database instance optimized for the environment.
 *
 * - On Vercel / serverless + Neon: uses WebSocket Pool (connection reuse, ~20ms/query)
 * - On local dev: uses postgres.js (TCP connection)
 */
export function createNeonDatabase(options: NeonDatabaseOptions): NeonDatabase {
  const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME
  const isNeon = options.url.includes('neon.tech') || options.url.includes('neon.')

  // Serverless + Neon → use WebSocket Pool for ORM queries, HTTP driver for raw DDL
  if (isServerless && isNeon) {
    neonConfig.webSocketConstructor = globalThis.WebSocket

    const pool = new Pool({ connectionString: options.url, max: 3 })
    const db = drizzleNeonWs(pool)

    // Use the stateless HTTP driver (neon()) for raw SQL / DDL operations.
    // The Pool's pool.query() has a known bug with frozen objects after the first
    // query ("Cannot add property callback, object is not extensible"). The HTTP
    // driver is stateless and doesn't have connection management issues — perfect
    // for CREATE TABLE / INSERT one-off statements during bootstrap.
    const httpSql = neon(options.url)

    return {
      db: db as unknown as PostgresJsDatabase,
      rawSql: async (query: string, params?: unknown[]) => {
        const result = await httpSql(query, params ?? [])
        return result
      },
      close: async () => {
        await pool.end()
      },
    }
  }

  // Local dev or non-Neon → use postgres.js TCP driver
  const pgSql = postgres(options.url, {
    ssl: isNeon ? 'require' : undefined,
    max: isServerless ? 1 : 5,
    idle_timeout: isServerless ? 0 : 30,
    connect_timeout: 5,
  })
  const db = drizzlePg(pgSql)

  return {
    db,
    rawSql: async (query: string, params?: unknown[]) => pgSql.unsafe(query, (params ?? []) as never[]),
    close: () => pgSql.end(),
  }
}
