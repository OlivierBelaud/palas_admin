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
    this._neonDb = createNeonDatabase({ url: config.url })
  }

  async dispose(): Promise<void> {
    if (this._neonDb) {
      await this._neonDb.close()
      this._neonDb = null
    }
    this._disposed = true
  }

  async healthCheck(): Promise<boolean> {
    if (!this._neonDb || this._disposed) return false
    try {
      await Promise.race([
        this._neonDb.rawSql('SELECT 1'),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Health check timeout')), 2000)),
      ])
      return true
    } catch {
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
    // Return the rawSql function as the "pool" for DDL operations
    return this._neonDb.rawSql
  }

  async transaction<T>(fn: (tx: unknown) => Promise<T>, _options?: TransactionOptions): Promise<T> {
    const db = this.getClient() as { transaction: (fn: (tx: unknown) => Promise<T>) => Promise<T> }
    return await db.transaction(async (tx) => {
      return await fn(tx)
    })
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
