// SPEC-126 — DrizzleRepository implements IRepository

import { MantaError } from '@manta/core/errors'
import type { IRepository, TransactionOptions } from '@manta/core/ports'
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { isPgError, mapPgError } from './error-mapper'

export interface DrizzleRepositoryOptions {
  db: PostgresJsDatabase
  table: PgTable
  entityName: string
  idPrefix?: string
}

type DbOrTx = PostgresJsDatabase

/**
 * DrizzleRepository — real PG-backed repository implementing IRepository.
 *
 * Uses Drizzle ORM for type-safe query building.
 * All reads auto-filter WHERE deleted_at IS NULL unless withDeleted:true.
 */
export class DrizzleRepository implements IRepository<Record<string, unknown>> {
  private _db: DbOrTx
  private _table: PgTable
  private _entityName: string
  private _idPrefix: string
  private _columns: Record<string, PgColumn>

  constructor(options: DrizzleRepositoryOptions) {
    this._db = options.db
    this._table = options.table
    this._entityName = options.entityName
    this._idPrefix = options.idPrefix ?? ''
    // Extract columns from table definition
    this._columns = Object.fromEntries(
      Object.entries(this._table).filter(([_, v]) => v && typeof v === 'object' && 'notNull' in v),
    ) as Record<string, PgColumn>
  }

  async find(options?: {
    where?: Record<string, unknown>
    withDeleted?: boolean
    limit?: number
    offset?: number
    order?: Record<string, 'ASC' | 'DESC'>
    cursor?: { cursor?: string; after?: string; before?: string; limit?: number; direction?: string }
  }): Promise<Record<string, unknown>[]> {
    try {
      const conditions = this.buildWhereConditions(options?.where, options?.withDeleted)

      // Cursor pagination
      if (options?.cursor) {
        const afterId = options.cursor.after ?? options.cursor.cursor
        if (afterId) {
          const idCol = this.getColumn('id')
          if (idCol) {
            conditions.push(gt(idCol, afterId))
          }
        }
      }

      let query = this._db
        .select()
        .from(this._table)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .$dynamic()

      // Ordering
      if (options?.order) {
        const orderClauses = Object.entries(options.order).map(([field, dir]) => {
          const col = this.getColumn(field)
          if (!col) throw new MantaError('INVALID_DATA', `Unknown column: ${field}`)
          return dir === 'DESC' ? desc(col) : asc(col)
        })
        query = query.orderBy(...orderClauses)
      } else {
        // Default order by id for cursor pagination consistency
        const idCol = this.getColumn('id')
        if (idCol) {
          query = query.orderBy(asc(idCol))
        }
      }

      // Pagination
      const limit = options?.limit ?? options?.cursor?.limit
      if (limit !== undefined) {
        query = query.limit(limit)
      }

      if (options?.offset && !options?.cursor) {
        query = query.offset(options.offset)
      }

      return (await query) as Record<string, unknown>[]
    } catch (error) {
      if (isPgError(error)) throw mapPgError(error)
      if (MantaError.is(error)) throw error
      throw error
    }
  }

  async findAndCount(options?: Record<string, unknown>): Promise<[Record<string, unknown>[], number]> {
    const findOpts = options as Parameters<typeof this.find>[0]
    const results = await this.find(findOpts)

    // Count without pagination
    const conditions = this.buildWhereConditions(findOpts?.where, findOpts?.withDeleted)

    const countResult = await this._db
      .select({ count: sql<number>`count(*)::int` })
      .from(this._table)
      .where(conditions.length > 0 ? and(...conditions) : undefined)

    const total = countResult[0]?.count ?? 0
    return [results, total]
  }

  async create(
    data: Record<string, unknown> | Record<string, unknown>[],
  ): Promise<Record<string, unknown> | Record<string, unknown>[]> {
    try {
      const items = Array.isArray(data) ? data : [data]
      const now = new Date()

      const prepared = items.map((item) => ({
        ...item,
        id: (item.id as string) ?? this.generateId(),
        created_at: now,
        updated_at: now,
        deleted_at: null,
      }))

      const result = await this._db
        .insert(this._table)
        .values(prepared as Record<string, unknown>[])
        .returning()

      return Array.isArray(data) ? result : result[0]
    } catch (error) {
      if (isPgError(error)) throw mapPgError(error)
      throw error
    }
  }

  async update(
    data: Record<string, unknown> | Record<string, unknown>[],
  ): Promise<Record<string, unknown> | Record<string, unknown>[]> {
    try {
      const items = Array.isArray(data) ? data : [data]
      const results: Record<string, unknown>[] = []

      for (const item of items) {
        const id = item.id as string
        if (!id) throw new MantaError('INVALID_DATA', 'Update requires an id')

        const { id: _, ...updateData } = item
        const idCol = this.getColumn('id')
        if (!idCol) throw new MantaError('INVALID_STATE', 'Table has no id column')

        const result = await this._db
          .update(this._table)
          .set({ ...updateData, updated_at: new Date() })
          .where(eq(idCol, id))
          .returning()

        if (result.length === 0) {
          throw new MantaError('NOT_FOUND', `Entity "${id}" not found`)
        }
        results.push(result[0])
      }

      return Array.isArray(data) ? results : results[0]
    } catch (error) {
      if (isPgError(error)) throw mapPgError(error)
      if (MantaError.is(error)) throw error
      throw error
    }
  }

  async delete(ids: string | string[]): Promise<void> {
    try {
      const idArray = Array.isArray(ids) ? ids : [ids]
      const idCol = this.getColumn('id')
      if (!idCol) throw new MantaError('INVALID_STATE', 'Table has no id column')

      await this._db.delete(this._table).where(inArray(idCol, idArray))
    } catch (error) {
      if (isPgError(error)) throw mapPgError(error)
      throw error
    }
  }

  async softDelete(ids: string | string[]): Promise<Record<string, string[]>> {
    try {
      const idArray = Array.isArray(ids) ? ids : [ids]
      const idCol = this.getColumn('id')
      if (!idCol) throw new MantaError('INVALID_STATE', 'Table has no id column')

      const result = await this._db
        .update(this._table)
        .set({ deleted_at: new Date(), updated_at: new Date() } as Record<string, unknown>)
        .where(inArray(idCol, idArray))
        .returning()

      const deletedIds = result.map((r: Record<string, unknown>) => r.id as string)
      return deletedIds.length > 0 ? { [this._entityName]: deletedIds } : {}
    } catch (error) {
      if (isPgError(error)) throw mapPgError(error)
      throw error
    }
  }

  async restore(ids: string | string[]): Promise<void> {
    try {
      const idArray = Array.isArray(ids) ? ids : [ids]
      const idCol = this.getColumn('id')
      if (!idCol) throw new MantaError('INVALID_STATE', 'Table has no id column')

      await this._db
        .update(this._table)
        .set({ deleted_at: null, updated_at: new Date() } as Record<string, unknown>)
        .where(inArray(idCol, idArray))
    } catch (error) {
      if (isPgError(error)) throw mapPgError(error)
      throw error
    }
  }

  async serialize(data: unknown, _options?: unknown): Promise<unknown> {
    return JSON.parse(JSON.stringify(data))
  }

  async upsertWithReplace(
    data: Record<string, unknown>[],
    replaceFields?: string[],
    conflictTarget?: string[],
  ): Promise<Record<string, unknown>[]> {
    try {
      const now = new Date()
      const prepared = data.map((item) => ({
        ...item,
        id: (item.id as string) ?? this.generateId(),
        created_at: now,
        updated_at: now,
        deleted_at: null,
      }))

      // Build the ON CONFLICT update set
      const updateSet: Record<string, unknown> = { updated_at: sql`now()` }
      if (replaceFields && replaceFields.length > 0) {
        for (const field of replaceFields) {
          const col = this.getColumn(field)
          if (col) {
            updateSet[field] = sql`excluded.${sql.raw(field)}`
          }
        }
      } else {
        // Replace all fields except id and created_at
        for (const item of data) {
          for (const key of Object.keys(item)) {
            if (key !== 'id' && key !== 'created_at') {
              updateSet[key] = sql`excluded.${sql.raw(key)}`
            }
          }
        }
      }

      // Determine conflict target
      const target = conflictTarget
        ? conflictTarget.map((c) => this.getColumn(c)).filter(Boolean)
        : [this.getColumn('id')].filter(Boolean)

      if (target.length === 0) {
        throw new MantaError('INVALID_DATA', 'No conflict target columns found')
      }

      const result = await this._db
        .insert(this._table)
        .values(prepared as Record<string, unknown>[])
        .onConflictDoUpdate({
          target: target as PgColumn[],
          set: updateSet as Record<string, unknown>,
        })
        .returning()

      return result as Record<string, unknown>[]
    } catch (error) {
      if (isPgError(error)) throw mapPgError(error)
      if (MantaError.is(error)) throw error
      throw error
    }
  }

  async transaction<TManager = unknown>(
    task: (transactionManager: TManager) => Promise<unknown>,
    options?: TransactionOptions,
  ): Promise<unknown> {
    try {
      return await (this._db as PostgresJsDatabase).transaction(
        async (tx) => {
          return await task(tx as TManager)
        },
        {
          isolationLevel: this.mapIsolationLevel(options?.isolationLevel),
        },
      )
    } catch (error) {
      if (isPgError(error)) throw mapPgError(error)
      throw error
    }
  }

  private buildWhereConditions(where?: Record<string, unknown>, withDeleted?: boolean) {
    const conditions: ReturnType<typeof eq>[] = []

    // Auto-filter soft-deleted
    if (!withDeleted) {
      const deletedAtCol = this.getColumn('deleted_at')
      if (deletedAtCol) {
        conditions.push(isNull(deletedAtCol))
      }
    }

    // Apply where filters
    if (where) {
      for (const [key, value] of Object.entries(where)) {
        const col = this.getColumn(key)
        if (!col) continue
        if (value === null) {
          conditions.push(isNull(col))
        } else {
          conditions.push(eq(col, value))
        }
      }
    }

    return conditions
  }

  private getColumn(name: string): PgColumn | undefined {
    return this._columns[name] ?? ((this._table as unknown as Record<string, unknown>)[name] as PgColumn | undefined)
  }

  private generateId(): string {
    const uuid = crypto.randomUUID()
    return this._idPrefix ? `${this._idPrefix}_${uuid}` : uuid
  }

  private mapIsolationLevel(
    level?: string,
  ): 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable' | undefined {
    if (!level) return undefined
    switch (level) {
      case 'READ UNCOMMITTED':
        return 'read uncommitted'
      case 'READ COMMITTED':
        return 'read committed'
      case 'REPEATABLE READ':
        return 'repeatable read'
      case 'SERIALIZABLE':
        return 'serializable'
      default:
        return undefined
    }
  }
}
