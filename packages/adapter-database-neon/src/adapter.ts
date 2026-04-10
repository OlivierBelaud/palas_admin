// SPEC-056 — NeonDrizzleAdapter implements IDatabasePort
// Full Neon adapter wrapping createNeonDatabase() as a proper IDatabasePort.

import { MantaError } from '@manta/core/errors'
import type { DatabaseConfig, IDatabasePort, TransactionOptions } from '@manta/core/ports'
import type { NeonDatabase } from './connection'
import { createNeonDatabase } from './connection'

/**
 * NeonDrizzleAdapter — IDatabasePort for Neon serverless PostgreSQL.
 * Uses WebSocket Pool on Vercel, postgres.js TCP locally.
 */
export class NeonDrizzleAdapter implements IDatabasePort {
  private _neonDb: NeonDatabase | null = null
  private _disposed = false

  async initialize(config: DatabaseConfig): Promise<void> {
    if (this._disposed) {
      throw new MantaError('INVALID_STATE', 'Adapter has been disposed')
    }
    console.log(`[neon] Initializing database (url: ${config.url?.replace(/:[^@]+@/, ':***@')})`)
    this._neonDb = createNeonDatabase({ url: config.url })
    console.log('[neon] Database instance created')
  }

  async dispose(): Promise<void> {
    if (this._neonDb) {
      await this._neonDb.close()
      this._neonDb = null
    }
    this._disposed = true
  }

  async healthCheck(): Promise<boolean> {
    if (!this._neonDb || this._disposed) {
      console.error('[neon] healthCheck: db not initialized or disposed')
      return false
    }
    try {
      await Promise.race([
        this._neonDb.rawSql('SELECT 1'),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Health check timeout (5s)')), 5000)),
      ])
      return true
    } catch (err) {
      console.error(
        '[neon] healthCheck FAILED:',
        (err as Error).message,
        (err as Error).stack?.split('\n').slice(0, 3).join('\n'),
      )
      return false
    }
  }

  getClient(): unknown {
    if (!this._neonDb) {
      throw new MantaError('INVALID_STATE', 'Database not initialized. Call initialize() first.')
    }
    return this._neonDb.db
  }

  getPool(): unknown {
    if (!this._neonDb) {
      throw new MantaError('INVALID_STATE', 'Database not initialized. Call initialize() first.')
    }
    // Return an object that exposes BOTH:
    //   - .unsafe(query) — used by ensureFrameworkTables/ensureEntityTables (postgres.js interface)
    //   - direct call — used by any code that expects rawSql as a function
    // This bridges the gap between postgres.js API (used by DrizzlePgAdapter) and
    // Neon's HTTP driver (used by NeonDrizzleAdapter).
    const rawSql = this._neonDb.rawSql
    return Object.assign((query: string, params?: unknown[]) => rawSql(query, params), {
      unsafe: (query: string, params?: unknown[]) => rawSql(query, params),
    })
  }

  async transaction<T>(fn: (tx: unknown) => Promise<T>, _options?: TransactionOptions): Promise<T> {
    const db = this.getClient() as { transaction: (fn: (tx: unknown) => Promise<T>) => Promise<T> }
    return await db.transaction(async (tx) => {
      return await fn(tx)
    })
  }

  async raw<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]> {
    if (!this._neonDb) throw new MantaError('INVALID_STATE', 'NeonDrizzleAdapter: not initialized')
    return this._neonDb.rawSql(query, params) as Promise<T[]>
  }

  async introspect(): Promise<unknown> {
    if (!this._neonDb) {
      throw new MantaError('INVALID_STATE', 'Database not initialized. Call initialize() first.')
    }
    return this._neonDb.rawSql(`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `)
  }
}
