// SPEC-011b — IRelationalQueryPort for native SQL JOINs via Drizzle relations

/**
 * Configuration for relational queries with native JOINs.
 */
export interface RelationalQueryConfig {
  entity: string
  fields?: string[]
  filters?: Record<string, unknown>
  sort?: Record<string, 'asc' | 'desc'>
  pagination?: { limit?: number; offset?: number }
  relPagination?: Record<string, { limit?: number; offset?: number }>
  withDeleted?: boolean
}

/**
 * IRelationalQueryPort — ORM-agnostic port for relational queries with native JOINs.
 *
 * When available, Query.graph() delegates to this port instead of N+1 entity resolvers.
 * The Drizzle adapter uses `db.query.*.findMany()` for eager loading and explicit JOINs
 * for cross-relation filtering.
 */
export interface IRelationalQueryPort {
  /**
   * Find entities with their relations using native SQL JOINs.
   * Returns nested objects matching the requested fields.
   */
  findWithRelations(config: RelationalQueryConfig): Promise<Record<string, unknown>[]>

  /**
   * Find entities with relations and return total count for pagination.
   */
  findAndCountWithRelations(config: RelationalQueryConfig): Promise<[Record<string, unknown>[], number]>
}
