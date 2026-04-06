// SPEC-126 — IRepositoryFactory port
// Factory for creating entity-specific repositories.

import type { IRepository } from './repository'

/**
 * Repository factory port contract.
 * Creates IRepository instances for specific entities.
 * Adapters: DrizzleRepositoryFactory (prod), InMemoryRepositoryFactory (test).
 */
export interface IRepositoryFactory {
  /**
   * Create a repository for the given entity.
   * @param entityName - The entity name (used to look up schema/table)
   * @param options - Adapter-specific options
   * @returns A repository instance for the entity
   */
  createRepository<T = unknown>(entityName: string, options?: Record<string, unknown>): IRepository<T>

  /**
   * Register a table/schema for a given entity name.
   * Called by the bootstrap to register auth, user, and link tables.
   */
  registerTable?(entityName: string, table: unknown): void
}
