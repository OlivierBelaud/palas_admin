// SPEC-056 — DrizzlePgAdapter implements IDatabasePort

import { drizzle } from 'drizzle-orm/postgres-js'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import type { IDatabasePort, TransactionOptions, DatabaseConfig } from '@manta/core/ports'
import { MantaError } from '@manta/core/errors'
import { mapPgError, isPgError } from './error-mapper'

export class DrizzlePgAdapter implements IDatabasePort {
  private _sql: Sql | null = null
  private _db: PostgresJsDatabase | null = null
  private _disposed = false

  async initialize(config: DatabaseConfig): Promise<void> {
    if (this._disposed) {
      throw new MantaError('INVALID_STATE', 'Adapter has been disposed')
    }

    const poolConfig = config.pool ?? {}

    this._sql = postgres(config.url, {
      max: poolConfig.max ?? 10,
      idle_timeout: poolConfig.idleTimeout ?? 20,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    })

    this._db = drizzle(this._sql)
  }

  async dispose(): Promise<void> {
    if (this._sql) {
      await this._sql.end({ timeout: 5 })
      this._sql = null
      this._db = null
    }
    this._disposed = true
  }

  async healthCheck(): Promise<boolean> {
    if (!this._sql || this._disposed) return false
    try {
      const result = await Promise.race([
        this._sql`SELECT 1 as value`,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), 2000)
        ),
      ])
      return Array.isArray(result) && result.length > 0
    } catch {
      return false
    }
  }

  getClient(): PostgresJsDatabase {
    if (!this._db) {
      throw new MantaError('INVALID_STATE', 'Database not initialized. Call initialize() first.')
    }
    return this._db
  }

  getPool(): Sql {
    if (!this._sql) {
      throw new MantaError('INVALID_STATE', 'Database not initialized. Call initialize() first.')
    }
    return this._sql
  }

  async transaction<T>(
    fn: (tx: unknown) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    const db = this.getClient()

    try {
      const isolationLevel = this.mapIsolationLevel(options?.isolationLevel)
      const txOptions = isolationLevel ? { isolationLevel } : undefined
      return await db.transaction(async (tx) => {
        return await fn(tx)
      }, txOptions)
    } catch (error) {
      if (isPgError(error)) {
        throw mapPgError(error)
      }
      throw error
    }
  }

  async introspect(): Promise<unknown> {
    const sql = this.getPool()
    const tables = await sql`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `
    return tables
  }

  private mapIsolationLevel(
    level?: string,
  ): 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable' | undefined {
    if (!level) return undefined
    switch (level) {
      case 'READ UNCOMMITTED': return 'read uncommitted'
      case 'READ COMMITTED': return 'read committed'
      case 'REPEATABLE READ': return 'repeatable read'
      case 'SERIALIZABLE': return 'serializable'
      default: return undefined
    }
  }
}
