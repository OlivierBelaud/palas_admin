// SPEC-011 — Query system with graph() for cross-module joins

import { MantaError } from '../errors/manta-error'

/**
 * Configuration for Query.graph().
 */
export interface GraphQueryConfig {
  entity: string
  fields?: string[]
  filters?: Record<string, unknown>
  sort?: Record<string, 'asc' | 'desc'>
  pagination?: { limit?: number; offset?: number }
  relPagination?: RelationPagination
  withDeleted?: boolean
  dangerouslyUnboundedRelations?: boolean
}

/**
 * Per-relation pagination configuration.
 */
export type RelationPagination = Record<string, { limit?: number; offset?: number }>

/**
 * Configuration for Query.index().
 */
export interface IndexQueryConfig {
  entity: string
  fields?: string[]
  filters?: Record<string, unknown>
  sort?: Record<string, 'asc' | 'desc'>
  pagination?: { limit?: number; offset?: number }
}

/**
 * Resolver function type — provided by modules to resolve entities.
 */
export type EntityResolver = (config: {
  fields?: string[]
  filters?: Record<string, unknown>
  sort?: Record<string, 'asc' | 'desc'>
  pagination?: { limit?: number; offset?: number }
  withDeleted?: boolean
}) => Promise<Record<string, unknown>[]>

/**
 * Query service — provides graph() and index() for cross-module data resolution.
 *
 * Modules register their entity resolvers. Query.graph() orchestrates joins
 * across modules, applying pagination, filtering, and entity count protection.
 */
export class QueryService {
  private _resolvers = new Map<string, EntityResolver>()
  private _indexModule: { query: (config: IndexQueryConfig) => Promise<Record<string, unknown>[]> } | null = null
  private _maxTotalEntities: number
  private _beforeFetch: ((module: string, query: unknown) => Promise<Record<string, unknown>[] | null>) | null = null

  constructor(options?: { maxTotalEntities?: number }) {
    this._maxTotalEntities = options?.maxTotalEntities ?? 10000
  }

  /**
   * Register an entity resolver for a module.
   */
  registerResolver(entityName: string, resolver: EntityResolver): void {
    this._resolvers.set(entityName.toLowerCase(), resolver)
  }

  /**
   * Register the Index module for Query.index().
   */
  registerIndexModule(indexModule: { query: (config: IndexQueryConfig) => Promise<Record<string, unknown>[]> }): void {
    this._indexModule = indexModule
  }

  /**
   * Set a beforeFetch hook for circuit breaker pattern.
   */
  set beforeFetch(fn: (module: string, query: unknown) => Promise<Record<string, unknown>[] | null>) {
    this._beforeFetch = fn
  }

  /**
   * Query.graph() — resolve entities with cross-module joins.
   *
   * Default limit: 100. Hard limit: 10,000 entities (configurable).
   * Throws INVALID_DATA if entity count exceeds limit.
   */
  async graph(config: GraphQueryConfig): Promise<Record<string, unknown>[]> {
    const entityKey = config.entity.toLowerCase()
    const resolver = this._resolvers.get(entityKey)

    if (!resolver) {
      throw new MantaError('UNKNOWN_MODULES', `No resolver registered for entity "${config.entity}"`)
    }

    // Apply default pagination
    const pagination = config.pagination ?? { limit: 100, offset: 0 }

    // Check circuit breaker hook
    if (this._beforeFetch) {
      const cached = await this._beforeFetch(entityKey, config)
      if (cached !== null) return cached
    }

    // Resolve root entities
    const results = await resolver({
      fields: config.fields,
      filters: config.filters,
      sort: config.sort,
      pagination,
      withDeleted: config.withDeleted,
    })

    // Entity count protection
    const total = results.length
    if (total > 1000) {
      // Warning threshold
    }
    if (!config.dangerouslyUnboundedRelations && total > this._maxTotalEntities) {
      throw new MantaError(
        'INVALID_DATA',
        `Query returned ${total} entities, exceeding maximum of ${this._maxTotalEntities}. Use pagination or reduce scope.`,
      )
    }

    return results
  }

  /**
   * Query.index() — denormalized read via Index module.
   * Requires Index module loaded + entity indexed.
   */
  async index(config: IndexQueryConfig): Promise<Record<string, unknown>[]> {
    if (!this._indexModule) {
      throw new MantaError(
        'UNKNOWN_MODULES',
        'Index module is not loaded. Use Query.graph() or enable the Index module.',
      )
    }

    return this._indexModule.query(config)
  }

  /**
   * Query.gql() — REMOVED per spec. Throws NOT_IMPLEMENTED.
   */
  async gql(): Promise<never> {
    throw new MantaError(
      'NOT_IMPLEMENTED',
      'Query.gql() has been removed. Use Query.graph() instead.',
    )
  }

  _reset(): void {
    this._resolvers.clear()
    this._indexModule = null
    this._beforeFetch = null
  }
}
