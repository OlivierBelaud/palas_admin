// SPEC-126 — IRepository interface

import type { CursorPagination, TransactionOptions } from './types'

/**
 * Repository port contract.
 * Provides CRUD operations with soft-delete support.
 * Adapters: DrizzleRepository (prod), InMemoryRepository (test).
 */
export interface IRepository<T = unknown> {
  /**
   * Find entities matching the given criteria.
   * Soft-deleted entities are excluded unless withDeleted is true.
   * @param options - Query options (where, pagination, ordering, cursor)
   * @returns Array of matching entities
   */
  find(options?: {
    where?: Record<string, unknown>
    withDeleted?: boolean
    limit?: number
    offset?: number
    order?: Record<string, 'ASC' | 'DESC'>
    cursor?: CursorPagination
  }): Promise<T[]>

  /**
   * Find entities and return total count.
   * @param options - Query options
   * @returns Tuple of [entities, totalCount]
   */
  findAndCount(options?: Record<string, unknown>): Promise<[T[], number]>

  /**
   * Create one or more entities.
   * @param data - Entity data or array of entity data
   * @returns The created entity or entities
   */
  create(data: Record<string, unknown> | Record<string, unknown>[]): Promise<T | T[]>

  /**
   * Update one or more entities.
   * @param data - Entity data with id(s) or array of entity data
   * @returns The updated entity or entities
   */
  update(data: Record<string, unknown> | Record<string, unknown>[]): Promise<T | T[]>

  /**
   * Hard delete entities by id.
   * @param ids - Single id or array of ids
   */
  delete(ids: string | string[]): Promise<void>

  /**
   * Soft delete entities by setting deleted_at.
   * @param ids - Single id or array of ids
   * @returns Map of entity type to affected ids
   */
  softDelete(ids: string | string[]): Promise<Record<string, string[]>>

  /**
   * Restore soft-deleted entities by clearing deleted_at.
   * @param ids - Single id or array of ids
   */
  restore(ids: string | string[]): Promise<void>

  /**
   * Serialize entity data for output.
   * @param data - Raw entity data
   * @param options - Serialization options
   * @returns Serialized data
   */
  serialize(data: unknown, options?: unknown): Promise<unknown>

  /**
   * Upsert entities with conflict resolution.
   * INSERT ON CONFLICT DO UPDATE for specified fields.
   * @param data - Array of entity data
   * @param replaceFields - Fields to update on conflict
   * @param conflictTarget - Columns to detect conflict on
   * @returns The upserted entities
   */
  upsertWithReplace(
    data: Record<string, unknown>[],
    replaceFields?: string[],
    conflictTarget?: string[]
  ): Promise<T[]>

  /**
   * Execute a function within a transaction.
   * @param task - The function receiving a transaction manager
   * @param options - Transaction options
   * @returns The result of the function
   */
  transaction<TManager = unknown>(
    task: (transactionManager: TManager) => Promise<unknown>,
    options?: TransactionOptions
  ): Promise<unknown>
}
