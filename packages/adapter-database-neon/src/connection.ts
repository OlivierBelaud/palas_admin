// Neon connection — uses HTTP driver on Vercel (stateless, no WebSocket needed),
// postgres.js TCP driver locally.

import { neon } from '@neondatabase/serverless'
import { drizzle as drizzleNeonHttp } from 'drizzle-orm/neon-http'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

export interface NeonDatabaseOptions {
  /** Connection string (postgresql://...) */
  url: string
}

export interface NeonDatabase {
  /** Drizzle db instance — use this for all queries */
  db: PostgresJsDatabase | ReturnType<typeof drizzleNeonHttp>
  /** Raw SQL: (query, params) style — for IDatabasePort.raw() */
  rawSql: (query: string, params?: unknown[]) => Promise<unknown>
  /**
   * Tagged template SQL — for getPool() consumers that use tagged templates
   * (ensureFrameworkSchema, ensureEntityTables, NeonLockingAdapter).
   * On Neon HTTP: the neon() function itself (supports both tagged + regular).
   * On postgres.js: the postgres() instance (supports both tagged + .unsafe()).
   */
  pool: unknown
  /** Close connections */
  close: () => Promise<void>
}

/**
 * Create a Drizzle database instance optimized for the environment.
 *
 * - On Vercel / serverless + Neon: uses HTTP driver (stateless, no WebSocket needed)
 * - On local dev: uses postgres.js (TCP connection)
 */
export function createNeonDatabase(options: NeonDatabaseOptions): NeonDatabase {
  const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME
  const isNeon = options.url.includes('neon.tech') || options.url.includes('neon.')

  // Serverless + Neon → use HTTP driver for everything (no WebSocket dependency)
  if (isServerless && isNeon) {
    const httpSql = neon(options.url)
    const db = drizzleNeonHttp(httpSql)

    // httpSql supports both tagged templates (sql`...`) AND regular calls (sql(query, params)).
    // Add .unsafe() for ensureEntityTables compatibility.
    const pool = Object.assign(httpSql, {
      unsafe: (query: string, params?: unknown[]) => httpSql(query, params ?? []),
    })

    return {
      db: db as unknown as PostgresJsDatabase,
      rawSql: async (query: string, params?: unknown[]) => httpSql(query, params ?? []),
      pool,
      close: async () => {},
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
    pool: pgSql, // postgres.js supports tagged templates + .unsafe()
    close: () => pgSql.end(),
  }
}
