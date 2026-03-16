// SPEC-056 — IDatabasePort interface

import type { DatabaseConfig, TransactionOptions } from './types'

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
   * Execute a function within a database transaction.
   * @param fn - The function to execute, receiving the transaction object
   * @param options - Transaction isolation level and nesting options
   * @returns The result of the function
   */
  transaction<T>(fn: (tx: unknown) => Promise<T>, options?: TransactionOptions): Promise<T>

  /**
   * Optional: introspect the database schema.
   * Used by manta db:diff for schema comparison.
   * @returns Schema introspection result
   */
  introspect?(): Promise<unknown>
}
