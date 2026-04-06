// SPEC-056 — IDatabasePort interface

import type { DatabaseConfig } from './types'

/**
 * Database port contract.
 * Adapters: DrizzlePgAdapter (dev/prod).
 */
export interface IDatabasePort {
  /**
   * Initialize the database connection.
   * @param config - Database connection configuration
   */
  initialize(config: DatabaseConfig): Promise<void>

  /**
   * Dispose the database connection and pool.
   */
  dispose(): Promise<void>

  /**
   * Check if the database is healthy and reachable.
   * @returns True if healthy
   */
  healthCheck(): Promise<boolean>

  /**
   * Get the underlying Drizzle client instance.
   * @returns The database client
   */
  getClient(): unknown

  /**
   * Get the underlying connection pool.
   * @returns The connection pool
   */
  getPool(): unknown

  /**
   * Optional: introspect the database schema.
   * Used by manta db:diff for schema comparison.
   * @returns Schema introspection result
   */
  introspect?(): Promise<unknown>
}
