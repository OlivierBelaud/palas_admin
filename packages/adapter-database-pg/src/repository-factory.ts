// SPEC-126 — DrizzleRepositoryFactory implements IRepositoryFactory

import { MantaError } from '@manta/core/errors'
import type { IDatabasePort, IRepository, IRepositoryFactory } from '@manta/core/ports'
import type { PgTable } from 'drizzle-orm/pg-core'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { DrizzleRepository } from './repository'

export interface DrizzleRepositoryFactoryOptions {
  /** The database port — factory calls getClient() internally when creating repos. */
  db: IDatabasePort
  /** Initial table map (optional, tables can be registered progressively). */
  tables?: Record<string, PgTable>
}

/**
 * Factory that creates DrizzleRepository instances for specific entities.
 * Receives IDatabasePort and calls getClient() lazily at each createRepository() call.
 * This ensures repos always use the current Drizzle client (important after setSchema()).
 */
export class DrizzleRepositoryFactory implements IRepositoryFactory {
  private _dbPort: IDatabasePort
  private _tables: Record<string, PgTable>
  private _cache = new Map<string, IRepository<unknown>>()

  constructor(options: DrizzleRepositoryFactoryOptions) {
    this._dbPort = options.db
    this._tables = options.tables ?? {}
  }

  registerTable(entityName: string, table: PgTable): void {
    this._tables[entityName] = table
  }

  createRepository<T = unknown>(entityName: string, options?: Record<string, unknown>): IRepository<T> {
    const cached = this._cache.get(entityName)
    if (cached) return cached as IRepository<T>

    const table = this._tables[entityName]
    if (!table) {
      throw new MantaError(
        'UNKNOWN_MODULES',
        `No table registered for entity "${entityName}". Available: ${Object.keys(this._tables).join(', ')}`,
      )
    }

    // Call getClient() lazily — not cached — so repos always use the current Drizzle instance
    const repo: IRepository<unknown> = new DrizzleRepository({
      db: this._dbPort.getClient() as PostgresJsDatabase,
      table,
      entityName,
      idPrefix: options?.idPrefix as string | undefined,
    })

    this._cache.set(entityName, repo)
    return repo as IRepository<T>
  }
}
