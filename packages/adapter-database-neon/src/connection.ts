// Neon connection — copied from @manta/adapter-neon for self-contained package

import { neonConfig, Pool } from '@neondatabase/serverless'
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
  rawSql: (query: string) => Promise<unknown>
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

  // Serverless + Neon → use WebSocket Pool
  if (isServerless && isNeon) {
    neonConfig.webSocketConstructor = globalThis.WebSocket

    const pool = new Pool({ connectionString: options.url, max: 1 })
    const db = drizzleNeonWs(pool)

    return {
      db: db as unknown as PostgresJsDatabase,
      rawSql: async (query: string) => {
        const result = await pool.query(query)
        return result.rows
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
    rawSql: async (query: string) => pgSql.unsafe(query),
    close: () => pgSql.end(),
  }
}
