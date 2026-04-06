// SPEC-011 — Query system with graph() for cross-module joins
// SPEC-V2 — defineQuery() for CQRS read side

export type { QueryConfig, QueryDefinition, QueryHandlerContext } from './define-query'
export { defineQuery, QueryRegistry } from './define-query'
export type { EntityAccessMap, EntityAccessRule, QueryGraphDefinition } from './define-query-graph'
export { defineQueryGraph, getEntityFilter, isEntityAllowed } from './define-query-graph'
export type {
  QueryGraphExtensionContext,
  QueryGraphExtensionDefinition,
  QueryGraphExtensionResolver,
} from './extend-query-graph'
export { extendQueryGraph } from './extend-query-graph'

import { MantaError } from '../errors/manta-error'
import type { ILoggerPort } from '../ports/logger'
import type { IRelationalQueryPort } from '../ports/relational-query'
import type { QueryGraphExtensionDefinition } from './extend-query-graph'

/**
 * Entity registry — augmented by .manta/types/types.ts codegen.
 * Unlike MantaEntities (which extends Record<string, DmlEntity>),
 * this interface starts empty so keyof produces a strict union.
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmented by codegen via declare global
export interface EntityRegistry extends MantaGeneratedEntityRegistry {}

/**
 * Entity name type — derived from EntityRegistry.
 * When codegen runs, EntityName becomes a union of module names (e.g. 'catalog' | 'inventory').
 * Without codegen, falls back to string for compatibility.
 */
export type EntityName = keyof EntityRegistry extends never ? string : Extract<keyof EntityRegistry, string>

/**
 * Configuration for Query.graph().
 */
export interface GraphQueryConfig {
  entity: EntityName
  fields?: string[]
  filters?: Record<string, unknown>
  sort?: Record<string, 'asc' | 'desc'>
  pagination?: { limit?: number; offset?: number }
  relPagination?: RelationPagination
  withDeleted?: boolean
  dangerouslyUnboundedRelations?: boolean
  /** Full-text search query — searches across all searchable fields of the entity. */
  q?: string
}

/**
 * Per-relation pagination configuration.
 */
export type RelationPagination = Record<string, { limit?: number; offset?: number }>

/**
 * Configuration for Query.index().
 */
export interface IndexQueryConfig {
  entity: EntityName
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
  private _searchableFields = new Map<string, string[]>()
  private _indexModule: { query: (config: IndexQueryConfig) => Promise<Record<string, unknown>[]> } | null = null
  private _relationalQuery: IRelationalQueryPort | null = null
  private _maxTotalEntities: number
  private _beforeFetch: ((module: string, query: unknown) => Promise<Record<string, unknown>[] | null>) | null = null
  /** Query graph extensions — modules that own external entities (PostHog, Stripe, etc.) */
  private _extensions: QueryGraphExtensionDefinition[] = []
  /** MantaApp reference — passed to extension resolvers. Set by bootstrap. */
  // biome-ignore lint/suspicious/noExplicitAny: avoid circular type dep
  private _app: any = null
  /** Logger — passed to extension resolvers. Set by bootstrap. */
  private _logger: ILoggerPort | null = null

  constructor(options?: { maxTotalEntities?: number }) {
    this._maxTotalEntities = options?.maxTotalEntities ?? 10000
  }

  /**
   * Register a query graph extension — a module-level resolver for external entities.
   * Called by the bootstrap once per discovered extension.
   */
  registerExtension(extension: QueryGraphExtensionDefinition): void {
    this._extensions.push(extension)
  }

  /**
   * Provide the MantaApp + logger to extension resolvers. Called by bootstrap.
   */
  // biome-ignore lint/suspicious/noExplicitAny: avoid circular type dep
  setExtensionContext(app: any, logger: ILoggerPort): void {
    this._app = app
    this._logger = logger
  }

  /**
   * Find the extension (if any) that owns the given normalized entity key.
   */
  private _findExtensionFor(entityKey: string): QueryGraphExtensionDefinition | null {
    for (const ext of this._extensions) {
      for (const owned of ext.owns) {
        if (this._normalizeKey(owned) === entityKey) return ext
      }
    }
    return null
  }

  /**
   * Validate that a query's filters are supported by an extension.
   * Throws MantaError with a clear message if any filter is not supported.
   */
  private _validateExtensionFilters(
    ext: QueryGraphExtensionDefinition,
    entity: string,
    filters: Record<string, unknown> | undefined,
  ): void {
    if (!filters || !ext.supportedFilters) return
    const supported = ext.supportedFilters[entity]
    if (!supported) return
    const unsupported = Object.keys(filters).filter((k) => !supported.includes(k))
    if (unsupported.length > 0) {
      throw new MantaError(
        'INVALID_DATA',
        `Entity "${entity}" does not support filter(s): ${unsupported.join(', ')}. Supported filters: ${supported.join(', ')}.`,
      )
    }
  }

  /**
   * Normalize an entity name to canonical lookup key.
   * Handles: 'CustomerGroup' → 'customergroup', 'customer_group' → 'customergroup', 'customerGroup' → 'customergroup'
   * We strip all separators and lowercase for lookup so any format resolves.
   */
  private _normalizeKey(name: string): string {
    return name.replace(/[_\s-]/g, '').toLowerCase()
  }

  /**
   * Register an entity resolver for a module.
   */
  registerResolver(entityName: string, resolver: EntityResolver): void {
    this._resolvers.set(this._normalizeKey(entityName), resolver)
  }

  /**
   * Register searchable fields for an entity (used for `q` parameter in graph queries).
   */
  registerSearchableFields(entityName: string, fields: string[]): void {
    this._searchableFields.set(this._normalizeKey(entityName), fields)
  }

  /**
   * Get searchable fields for an entity.
   */
  getSearchableFields(entityName: string): string[] {
    return this._searchableFields.get(this._normalizeKey(entityName)) ?? []
  }

  /**
   * Register a relational query port for native SQL JOINs.
   * When registered, graph() delegates to this port for queries that include relations.
   */
  registerRelationalQuery(rq: IRelationalQueryPort): void {
    this._relationalQuery = rq
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
    const entityKey = this._normalizeKey(config.entity)

    // Apply default pagination
    const pagination = config.pagination ?? { limit: 100, offset: 0 }

    // Check circuit breaker hook
    if (this._beforeFetch) {
      const cached = await this._beforeFetch(entityKey, config)
      if (cached !== null) return cached
    }

    // Route to query graph extension if an external module owns this entity.
    // External entities are resolved by their module's extendQueryGraph() resolver,
    // not by Drizzle (they have no local table).
    const extension = this._findExtensionFor(entityKey)
    if (extension) {
      this._validateExtensionFilters(extension, config.entity, config.filters)
      const rows = await extension.resolve(
        { ...config, pagination },
        { app: this._app, logger: this._logger ?? (console as unknown as ILoggerPort) },
      )
      // Entity count protection
      if (!config.dangerouslyUnboundedRelations && rows.length > this._maxTotalEntities) {
        throw new MantaError(
          'INVALID_DATA',
          `Query returned ${rows.length} entities, exceeding maximum of ${this._maxTotalEntities}. Use pagination or reduce scope.`,
        )
      }
      return rows
    }

    // Delegate to IRelationalQueryPort if available
    // Always delegate when we have one — it handles alias resolution for relation fields
    // (e.g. 'customers' → M:N relation via pivot table)
    if (this._relationalQuery) {
      const results = await this._relationalQuery.findWithRelations({
        entity: config.entity,
        fields: config.fields,
        filters: config.filters,
        sort: config.sort,
        pagination,
        relPagination: config.relPagination,
        withDeleted: config.withDeleted,
      })

      // Entity count protection
      if (!config.dangerouslyUnboundedRelations && results.length > this._maxTotalEntities) {
        throw new MantaError(
          'INVALID_DATA',
          `Query returned ${results.length} entities, exceeding maximum of ${this._maxTotalEntities}. Use pagination or reduce scope.`,
        )
      }

      return this._applySearch(results, config.q, entityKey)
    }

    // Fallback to legacy resolver path
    const resolver = this._resolvers.get(entityKey)

    if (!resolver) {
      throw new MantaError('UNKNOWN_MODULES', `No resolver registered for entity "${config.entity}"`)
    }

    // Resolve root entities
    const results = await resolver({
      fields: config.fields,
      filters: config.filters,
      sort: config.sort,
      pagination,
      withDeleted: config.withDeleted,
    })

    // Apply in-memory search filter
    const filtered = this._applySearch(results, config.q, entityKey)

    // Entity count protection
    const total = filtered.length
    if (!config.dangerouslyUnboundedRelations && total > this._maxTotalEntities) {
      throw new MantaError(
        'INVALID_DATA',
        `Query returned ${total} entities, exceeding maximum of ${this._maxTotalEntities}. Use pagination or reduce scope.`,
      )
    }

    return filtered
  }

  /**
   * Apply in-memory search filter on results using searchable fields.
   * Filters rows where any searchable field contains the query string (case-insensitive).
   */
  private _applySearch(results: Record<string, unknown>[], q?: string, entityKey?: string): Record<string, unknown>[] {
    if (!q || !q.trim() || !entityKey) return results
    const searchableFields = this._searchableFields.get(entityKey)
    if (!searchableFields || searchableFields.length === 0) return results

    const needle = q.trim().toLowerCase()
    return results.filter((row) =>
      searchableFields.some((field) => {
        const value = row[field]
        return value != null && String(value).toLowerCase().includes(needle)
      }),
    )
  }

  /**
   * Check if fields include relation references (dotted paths).
   */
  private _hasRelationFields(fields?: string[]): boolean {
    if (!fields || fields.length === 0) return false
    return fields.some((f) => f.includes('.'))
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
   * Query.graphAndCount() — like graph() but also returns total count for pagination.
   * Delegates to IRelationalQueryPort.findAndCountWithRelations() when available.
   */
  async graphAndCount(config: GraphQueryConfig): Promise<[Record<string, unknown>[], number]> {
    const entityKey = this._normalizeKey(config.entity)

    // Apply default pagination
    const pagination = config.pagination ?? { limit: 100, offset: 0 }

    // Check circuit breaker hook
    if (this._beforeFetch) {
      const cached = await this._beforeFetch(entityKey, config)
      if (cached !== null) return [cached, cached.length]
    }

    // Route to query graph extension if an external module owns this entity.
    const extension = this._findExtensionFor(entityKey)
    if (extension) {
      this._validateExtensionFilters(extension, config.entity, config.filters)
      const rows = await extension.resolve(
        { ...config, pagination },
        { app: this._app, logger: this._logger ?? (console as unknown as ILoggerPort) },
      )
      if (!config.dangerouslyUnboundedRelations && rows.length > this._maxTotalEntities) {
        throw new MantaError(
          'INVALID_DATA',
          `Query returned ${rows.length} entities, exceeding maximum of ${this._maxTotalEntities}. Use pagination or reduce scope.`,
        )
      }
      // External resolvers don't provide a separate count yet — return rows.length as approximation.
      return [rows, rows.length]
    }

    if (this._relationalQuery) {
      const [results, count] = await this._relationalQuery.findAndCountWithRelations({
        entity: config.entity,
        fields: config.fields,
        filters: config.filters,
        sort: config.sort,
        pagination,
        relPagination: config.relPagination,
        withDeleted: config.withDeleted,
      })

      if (!config.dangerouslyUnboundedRelations && results.length > this._maxTotalEntities) {
        throw new MantaError(
          'INVALID_DATA',
          `Query returned ${results.length} entities, exceeding maximum of ${this._maxTotalEntities}. Use pagination or reduce scope.`,
        )
      }

      return [results, count]
    }

    // Fallback to legacy resolver path — no native count support
    const resolver = this._resolvers.get(entityKey)

    if (!resolver) {
      throw new MantaError('UNKNOWN_MODULES', `No resolver registered for entity "${config.entity}"`)
    }

    const results = await resolver({
      fields: config.fields,
      filters,
      sort: config.sort,
      pagination,
      withDeleted: config.withDeleted,
    })

    if (!config.dangerouslyUnboundedRelations && results.length > this._maxTotalEntities) {
      throw new MantaError(
        'INVALID_DATA',
        `Query returned ${results.length} entities, exceeding maximum of ${this._maxTotalEntities}. Use pagination or reduce scope.`,
      )
    }

    // Legacy resolvers don't provide count — return results.length as approximation
    return [results, results.length]
  }

  /**
   * Query.gql() — REMOVED per spec. Throws NOT_IMPLEMENTED.
   */
  async gql(): Promise<never> {
    throw new MantaError('NOT_IMPLEMENTED', 'Query.gql() has been removed. Use Query.graph() instead.')
  }

  _reset(): void {
    this._resolvers.clear()
    this._searchableFields.clear()
    this._indexModule = null
    this._relationalQuery = null
    this._beforeFetch = null
    this._extensions = []
    this._app = null
    this._logger = null
  }
}
