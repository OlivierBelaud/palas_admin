// SPEC-126 — InMemoryRepositoryFactory implements IRepositoryFactory

import type { IRepository } from '../ports/repository'
import type { IRepositoryFactory } from '../ports/repository-factory'
import { InMemoryRepository } from './repository-memory'

/**
 * In-memory repository factory for dev/test.
 * Creates and caches InMemoryRepository instances per entity name.
 */
export class InMemoryRepositoryFactory implements IRepositoryFactory {
  private _cache = new Map<string, InMemoryRepository>()

  registerTable(_entityName: string, _table: unknown): void {
    // No-op — InMemory repos don't need table definitions
  }

  createRepository<T = unknown>(entityName: string, _options?: Record<string, unknown>): IRepository<T> {
    const cached = this._cache.get(entityName)
    if (cached) return cached as IRepository<T>

    const repo = new InMemoryRepository(entityName)
    this._cache.set(entityName, repo)
    return repo as IRepository<T>
  }

  /** Get a previously created repository (for testing) */
  getRepository(entityName: string): InMemoryRepository | undefined {
    return this._cache.get(entityName)
  }

  /** Reset all cached repositories */
  _reset(): void {
    for (const repo of this._cache.values()) {
      repo._reset()
    }
    this._cache.clear()
  }
}
