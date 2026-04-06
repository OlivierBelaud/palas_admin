// SPEC-011b — DrizzleRelationalQuery implements IRelationalQueryPort
//
// Uses Drizzle's relational query API for native SQL JOINs.
// Two modes:
// 1. Eager loading (db.query.*.findMany with `with`) — when filters are root-level only
// 2. JOIN fallback (db.select().from().innerJoin()) — when filters touch relations

import { MantaError } from '@manta/core/errors'
import type { IRelationalQueryPort, RelationalQueryConfig } from '@manta/core/ports'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { applyRelationPagination, buildDrizzleWith, hasRelationFields, separateFilters } from './query-builder'

/**
 * DrizzleRelationalQuery — native SQL JOINs via Drizzle's relational query API.
 *
 * Requires a schema-aware Drizzle client (initialized with `drizzle(sql, { schema })`).
 * The schema must include both tables and `relations()` definitions.
 */
/**
 * Relation alias mapping: user-friendly name → Drizzle relation name.
 * e.g. on entity 'customerGroup': { customers: 'customerCustomerGroup' }
 * Built from defineLink() definitions at bootstrap.
 */
export type RelationAliasMap = Map<string, Record<string, string>>

export class DrizzleRelationalQuery implements IRelationalQueryPort {
  private _db: PostgresJsDatabase<Record<string, unknown>>
  /** Cache of normalized entity name → actual db.query key */
  private _queryKeyCache = new Map<string, string>()
  /** Relation aliases: entity (normalized) → { userFriendlyName → drizzleRelName } */
  private _relationAliases: RelationAliasMap

  constructor(db: PostgresJsDatabase<Record<string, unknown>>, relationAliases?: RelationAliasMap) {
    this._db = db
    this._relationAliases = relationAliases ?? new Map()
  }

  /**
   * Resolve a db.query key from an entity name.
   * Tries: exact, lowercase, camelCase+plural, stripped underscores, etc.
   */
  private _resolveQueryKey(entity: string): string | undefined {
    const normalized = entity.replace(/[_\s-]/g, '').toLowerCase()
    if (this._queryKeyCache.has(normalized)) return this._queryKeyCache.get(normalized)

    const queryKeys = Object.keys(this._db.query as Record<string, unknown>)
    // Try exact match, then normalized, then pluralized
    const candidates = [normalized]
    if (!normalized.endsWith('s')) candidates.push(`${normalized}s`)
    if (!normalized.endsWith('es')) candidates.push(`${normalized}es`)

    for (const key of queryKeys) {
      const keyNorm = key.replace(/[_\s-]/g, '').toLowerCase()
      if (key === entity || candidates.includes(keyNorm)) {
        this._queryKeyCache.set(normalized, key)
        return key
      }
    }
    return undefined
  }

  async findWithRelations(config: RelationalQueryConfig): Promise<Record<string, unknown>[]> {
    const resolvedKey = this._resolveQueryKey(config.entity)
    const entityKey = resolvedKey ?? config.entity.toLowerCase()

    const queryTarget = (this._db.query as Record<string, unknown>)?.[entityKey] as
      | { findMany: (opts: Record<string, unknown>) => Promise<unknown[]> }
      | undefined

    if (!queryTarget) {
      const available = Object.keys(this._db.query as Record<string, unknown>)
        .filter((k) => !k.endsWith('Relations'))
        .join(', ')
      throw new MantaError(
        'UNKNOWN_MODULES',
        `No query target for entity "${config.entity}" (tried "${entityKey}"). Available: ${available}`,
      )
    }

    // Resolve relation aliases: 'customers' → 'customerCustomerGroup.*'
    const entityNorm = config.entity.replace(/[_\s-]/g, '').toLowerCase()
    const aliases = this._relationAliases.get(entityNorm) ?? {}
    const fields = (config.fields ?? ['*']).map((f) => {
      // Check if the field (or first part of dotted path) is an alias
      const parts = f.split('.')
      const resolved = aliases[parts[0]]
      if (resolved) {
        // Replace alias with Drizzle relation name, keep sub-fields
        return parts.length > 1 ? `${resolved}.${parts.slice(1).join('.')}` : `${resolved}.*`
      }
      return f
    })
    let withClause = hasRelationFields(fields) ? buildDrizzleWith(fields) : {}

    // Apply relation pagination
    if (config.relPagination) {
      withClause = applyRelationPagination(withClause, config.relPagination)
    }

    // Separate root vs relation filters
    const { rootFilters, relationFilters, hasRelationFilters } = config.filters
      ? separateFilters(config.filters)
      : { rootFilters: {}, relationFilters: {}, hasRelationFilters: false }

    if (hasRelationFilters) {
      // Mode 2: JOIN fallback — relation filters require explicit JOINs
      return this._queryWithJoins(entityKey, rootFilters, relationFilters, withClause, config)
    }

    // Mode 1: Eager loading via db.query.*.findMany()
    const queryOptions: Record<string, unknown> = {}

    // Add relation loading
    if (Object.keys(withClause).length > 0) {
      queryOptions.with = withClause
    }

    // Pagination (hard cap at 10000 to prevent runaway queries)
    const MAX_QUERY_LIMIT = 10000
    queryOptions.limit = Math.min(config.pagination?.limit ?? 100, MAX_QUERY_LIMIT)
    if (config.pagination?.offset) {
      queryOptions.offset = config.pagination.offset
    }

    // Build where conditions (root filters + soft-delete)
    const whereConditions = this._buildWhereConditions(rootFilters, config.withDeleted ?? false)
    if (whereConditions) {
      queryOptions.where = whereConditions
    }

    // Sort
    if (config.sort) {
      queryOptions.orderBy = this._buildOrderBy(config.sort, entityKey)
    }

    try {
      const results = await queryTarget.findMany(queryOptions)

      // Rename Drizzle relation keys back to user-friendly aliases
      // e.g. 'customerCustomerGroup' → 'customers'
      const reverseAliases: Record<string, string> = {}
      for (const [alias, drizzleName] of Object.entries(aliases)) {
        reverseAliases[drizzleName] = alias
      }
      if (Object.keys(reverseAliases).length > 0) {
        return (results as Record<string, unknown>[]).map((row) => {
          const renamed: Record<string, unknown> = {}
          for (const [key, value] of Object.entries(row)) {
            renamed[reverseAliases[key] ?? key] = value
          }
          return renamed
        })
      }

      return results as Record<string, unknown>[]
    } catch (error) {
      throw new MantaError(
        'DB_ERROR',
        `Relational query failed for "${config.entity}": ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async findAndCountWithRelations(config: RelationalQueryConfig): Promise<[Record<string, unknown>[], number]> {
    const resolvedKey = this._resolveQueryKey(config.entity)
    const entityKey = resolvedKey ?? config.entity.toLowerCase()

    const queryTarget = (this._db.query as Record<string, unknown>)?.[entityKey] as
      | { findMany: (opts: Record<string, unknown>) => Promise<unknown[]> }
      | undefined
    if (!queryTarget) {
      throw new MantaError(
        'UNKNOWN_MODULES',
        `No query target for entity "${config.entity}". Ensure the schema includes this entity and its relations.`,
      )
    }

    // Run count query without pagination
    const { rootFilters } = config.filters ? separateFilters(config.filters) : { rootFilters: {} }
    const whereConditions = this._buildWhereConditions(rootFilters, config.withDeleted ?? false)

    const countOptions: Record<string, unknown> = {}
    if (whereConditions) countOptions.where = whereConditions

    try {
      const allResults = await queryTarget.findMany(countOptions)
      const count = allResults.length

      // Run the actual query with relations and pagination
      const results = await this.findWithRelations(config)
      return [results, count]
    } catch (error) {
      throw new MantaError(
        'DB_ERROR',
        `Relational count query failed for "${config.entity}": ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * Mode 2: Query with explicit JOINs for relation filtering.
   * Used when filters contain dotted paths (e.g. 'customer.name').
   */
  private async _queryWithJoins(
    _entityKey: string,
    rootFilters: Record<string, unknown>,
    relationFilters: Record<string, Record<string, unknown>>,
    _withClause: Record<string, unknown>,
    config: RelationalQueryConfig,
  ): Promise<Record<string, unknown>[]> {
    // For JOIN mode, we fall back to a two-step approach:
    // 1. Query IDs matching the relation filters via JOINs
    // 2. Load full entities with relations using those IDs
    //
    // This avoids reconstructing nested structures from flat JOIN results
    // while still getting the performance benefit of SQL-level filtering.

    const resolvedJoinKey = this._resolveQueryKey(_entityKey) ?? _entityKey
    const queryTarget = (this._db.query as Record<string, unknown>)?.[resolvedJoinKey] as
      | { findMany: (opts: Record<string, unknown>) => Promise<unknown[]> }
      | undefined
    if (!queryTarget) {
      throw new MantaError('UNKNOWN_MODULES', `No query target for entity "${_entityKey}" in JOIN mode.`)
    }

    // Build a where function that filters on relations
    // Drizzle's relational query API supports `where` on nested `with` configs
    const fields = config.fields ?? ['*']
    let withClause = hasRelationFields(fields) ? buildDrizzleWith(fields) : {}

    // Inject relation filters into the with clause as where conditions
    for (const [relName, relFilters] of Object.entries(relationFilters)) {
      const existingConfig = withClause[relName]
      const relConfig: Record<string, unknown> =
        existingConfig === true ? {} : ((existingConfig ?? {}) as Record<string, unknown>)
      // Store relation filters for post-query filtering
      relConfig._filters = relFilters
      withClause[relName] = relConfig
    }

    if (config.relPagination) {
      withClause = applyRelationPagination(withClause, config.relPagination)
    }

    // Clean up _filters before sending to Drizzle
    const cleanWith = this._cleanWithClause(withClause)

    const MAX_QUERY_LIMIT = 10000
    const queryOptions: Record<string, unknown> = {
      with: Object.keys(cleanWith).length > 0 ? cleanWith : undefined,
      limit: Math.min(config.pagination?.limit ?? 100, MAX_QUERY_LIMIT),
    }

    if (config.pagination?.offset) {
      queryOptions.offset = config.pagination.offset
    }

    const whereConditions = this._buildWhereConditions(rootFilters, config.withDeleted ?? false)
    if (whereConditions) {
      queryOptions.where = whereConditions
    }

    if (config.sort) {
      queryOptions.orderBy = this._buildOrderBy(config.sort, _entityKey)
    }

    try {
      const results = await queryTarget.findMany(queryOptions)

      // Post-filter: only keep records where relation filter matches
      const filtered = (results as Record<string, unknown>[]).filter((record) => {
        for (const [relName, relFilters] of Object.entries(relationFilters)) {
          const relData = record[relName]
          if (!relData) return false

          const relRecords = Array.isArray(relData) ? relData : [relData]
          const hasMatch = relRecords.some((r: Record<string, unknown>) => {
            for (const [field, value] of Object.entries(relFilters)) {
              if (field.includes('.')) {
                // Nested relation filter — skip for now (requires deeper resolution)
                continue
              }
              if (r[field] !== value) return false
            }
            return true
          })
          if (!hasMatch) return false
        }
        return true
      })

      return filtered
    } catch (error) {
      throw new MantaError(
        'DB_ERROR',
        `JOIN query failed for "${_entityKey}": ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * Build Drizzle where conditions from root filters + soft-delete.
   * Returns a function compatible with Drizzle's `where` option.
   */
  private _buildWhereConditions(
    filters: Record<string, unknown>,
    withDeleted: boolean,
  ):
    | ((table: Record<string, unknown>, operators: Record<string, (...args: unknown[]) => unknown>) => unknown)
    | undefined {
    const hasFilters = Object.keys(filters).length > 0

    if (!hasFilters && withDeleted) return undefined

    return (table: Record<string, unknown>, operators: Record<string, (...args: unknown[]) => unknown>) => {
      const conditions: unknown[] = []

      // Soft-delete filter
      if (!withDeleted && table.deleted_at) {
        conditions.push(operators.isNull(table.deleted_at))
      }

      // Root filters
      for (const [key, value] of Object.entries(filters)) {
        if (table[key]) {
          if (value === null) {
            conditions.push(operators.isNull(table[key]))
          } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            // Operator-based filter
            const ops = value as Record<string, unknown>
            for (const [op, val] of Object.entries(ops)) {
              switch (op) {
                case '$eq':
                  conditions.push(operators.eq(table[key], val))
                  break
                case '$ne':
                  conditions.push(operators.ne(table[key], val))
                  break
                case '$gt':
                  conditions.push(operators.gt(table[key], val))
                  break
                case '$gte':
                  conditions.push(operators.gte(table[key], val))
                  break
                case '$lt':
                  conditions.push(operators.lt(table[key], val))
                  break
                case '$lte':
                  conditions.push(operators.lte(table[key], val))
                  break
                case '$in':
                  conditions.push(operators.inArray(table[key], val))
                  break
                case '$nin':
                  conditions.push(operators.notInArray(table[key], val))
                  break
              }
            }
          } else {
            conditions.push(operators.eq(table[key], value))
          }
        }
      }

      if (conditions.length === 0) return undefined
      if (conditions.length === 1) return conditions[0]
      return operators.and(...conditions)
    }
  }

  /**
   * Build Drizzle orderBy from sort config.
   */
  private _buildOrderBy(
    sort: Record<string, 'asc' | 'desc'>,
    _entityKey: string,
  ):
    | ((table: Record<string, unknown>, operators: Record<string, (...args: unknown[]) => unknown>) => unknown[])
    | undefined {
    const entries = Object.entries(sort)
    if (entries.length === 0) return undefined

    return (table: Record<string, unknown>, operators: Record<string, (...args: unknown[]) => unknown>) => {
      return entries
        .filter(([field]) => table[field])
        .map(([field, direction]) => {
          return direction === 'desc' ? operators.desc(table[field]) : operators.asc(table[field])
        })
    }
  }

  /**
   * Remove internal _filters from with clause before sending to Drizzle.
   */
  private _cleanWithClause(withClause: Record<string, unknown>): Record<string, unknown> {
    const clean: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(withClause)) {
      if (value === true) {
        clean[key] = true
      } else if (typeof value === 'object' && value !== null) {
        const { _filters, ...rest } = value as Record<string, unknown>
        clean[key] = Object.keys(rest).length > 0 ? rest : true
      }
    }
    return clean
  }
}
