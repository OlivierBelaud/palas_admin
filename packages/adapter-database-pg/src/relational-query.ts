// SPEC-011b / BC-F29 — DrizzleRelationalQuery implements IRelationalQueryPort.
//
// One single code path:
//   db.query.<root>.findMany({
//     with: { ... },
//     where: (fields, ops) => ops.and(
//       softDelete?,
//       ...rootFieldPredicates,
//       ...relationExistsPredicates,
//     ),
//     orderBy, limit, offset,
//   })
//
// Relation filters are compiled into correlated `EXISTS (SELECT 1 FROM child
// WHERE child.fk = outer.pk AND ...)` subqueries, built inside the `where`
// callback so that `fields.<pk>` resolves to the relational-query outer alias.
// The experiment at `tests/drizzle-exists-probe.test.ts` locks this invariant
// in place (Risk #1 in the BC-F29 plan).
//
// M:N through pivots are expressed as nested EXISTS: outer EXISTS over pivot,
// inner EXISTS over the through target. Pivot extraColumn filters (e.g.
// `customers.type = 'primary'`) route to the pivot table, not the through
// target.

import { MantaError } from '@manta/core/errors'
import type { ILoggerPort, IRelationalQueryPort, RelationalQueryConfig } from '@manta/core/ports'
import { getTableColumns, normalizeRelation, and as sqlAnd } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import {
  applyRelationPagination,
  buildDrizzleWith,
  buildFieldPredicates,
  type DrizzleOperators,
  hasRelationFields,
  separateFilters,
} from './query-builder'

/**
 * Structured alias for M:N and 1:N-with-extras link relations.
 * Contains the pivot relation name + the "through" target relation on the pivot,
 * so that `fields: ['*', 'customers.*']` automatically loads through the pivot.
 */
export interface RelationAlias {
  /** Drizzle relation name on the parent entity → pivot table (e.g. 'customerCustomerGroup') */
  pivot: string
  /** Drizzle relation name on the pivot → target entity (e.g. 'customer') */
  through: string
  /** Extra columns on the pivot table to merge into target entities (e.g. ['type', 'is_default']) */
  extraColumns?: string[]
}

/**
 * Relation alias mapping: user-friendly name → Drizzle relation name or structured alias.
 * - string value: simple rename (e.g. 'address' → 'customerAddress')
 * - RelationAlias value: M:N through-pivot with automatic flattening
 * Built from defineLink() definitions at bootstrap.
 */
export type RelationAliasEntry = string | RelationAlias
export type RelationAliasMap = Map<string, Record<string, RelationAliasEntry>>

/**
 * Recommended maximum for `limit` before the adapter logs a warning.
 * There is **no hard cap** — callers that genuinely need large result sets
 * can still request them. See docs/queries-pagination.md.
 */
const RECOMMENDED_MAX_LIMIT = 10000

/**
 * Optional dependencies injected at construction time.
 */
export interface DrizzleRelationalQueryOptions {
  relationAliases?: RelationAliasMap
  logger?: ILoggerPort
}

/**
 * Minimal shape of the metadata Drizzle attaches to a schema-aware client as
 * `db._`. We intentionally redeclare it here instead of importing the internal
 * types — the internal surface is unstable across Drizzle minor versions.
 */
interface DrizzleMeta {
  schema: Record<
    string,
    {
      tsName: string
      dbName: string
      columns: Record<string, unknown>
      relations: Record<string, unknown>
    }
  >
  fullSchema: Record<string, unknown>
  tableNamesMap: Record<string, string>
}

/**
 * DrizzleRelationalQuery — native SQL JOINs via Drizzle's relational query API.
 *
 * Requires a schema-aware Drizzle client (initialized with `drizzle(sql, { schema })`).
 * The schema must include both tables and `relations()` definitions.
 */
export class DrizzleRelationalQuery implements IRelationalQueryPort {
  private _db: PostgresJsDatabase<Record<string, unknown>>
  /** Cache of normalized entity name → actual db.query key */
  private _queryKeyCache = new Map<string, string>()
  /** Relation aliases: entity (normalized) → { userFriendlyName → drizzleRelName } */
  private _relationAliases: RelationAliasMap
  /** Optional logger for non-fatal guidance (pagination, deprecated input) */
  private _logger: ILoggerPort | undefined

  constructor(
    db: PostgresJsDatabase<Record<string, unknown>>,
    relationAliasesOrOptions?: RelationAliasMap | DrizzleRelationalQueryOptions,
  ) {
    this._db = db
    // Backwards-compat overload: legacy callers pass a RelationAliasMap directly.
    if (relationAliasesOrOptions instanceof Map) {
      this._relationAliases = relationAliasesOrOptions
      this._logger = undefined
    } else {
      this._relationAliases = relationAliasesOrOptions?.relationAliases ?? new Map()
      this._logger = relationAliasesOrOptions?.logger
    }
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

  /**
   * Access the Drizzle schema metadata. Returns undefined if the client was
   * not built with `drizzle(sql, { schema })` (callers then treat relation
   * filters as a no-op).
   */
  private _meta(): DrizzleMeta | undefined {
    const meta = (this._db as unknown as { _?: DrizzleMeta })._
    if (!meta || !meta.schema) return undefined
    return meta
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

    // Resolve relation aliases: 'customers' → 'customerCustomerGroup.customer.*' (M:N through)
    // or 'variants' → 'variants.*' (simple alias)
    const entityNorm = config.entity.replace(/[_\s-]/g, '').toLowerCase()
    const aliases = this._relationAliases.get(entityNorm) ?? {}
    const fields = (config.fields ?? ['*']).map((f) => {
      const parts = f.split('.')
      const aliasEntry = aliases[parts[0]]
      if (!aliasEntry) return f

      if (typeof aliasEntry === 'string') {
        // Simple alias: replace name, keep sub-fields
        return parts.length > 1 ? `${aliasEntry}.${parts.slice(1).join('.')}` : `${aliasEntry}.*`
      }

      // RelationAlias: expand through pivot → target
      // 'customers.*' → 'customerCustomerGroup.customer.*'
      // 'customers.name' → 'customerCustomerGroup.customer.name'
      const { pivot, through } = aliasEntry
      if (parts.length > 1) {
        return `${pivot}.${through}.${parts.slice(1).join('.')}`
      }
      return `${pivot}.${through}.*`
    })
    let withClause = hasRelationFields(fields) ? buildDrizzleWith(fields) : {}

    // Apply relation pagination
    if (config.relPagination) {
      withClause = applyRelationPagination(withClause, config.relPagination)
    }

    // Separate root vs relation filters. Also rewrite user-friendly relation
    // filter keys through the alias map so that `customers.type = 'primary'`
    // lands on the pivot table (when `type` is an extraColumn) or on the
    // through target (otherwise). The rewrite must preserve grouping: the
    // alias may expand into `pivot.through.field`.
    const { rootFilters, relationFilters: rawRelationFilters } = config.filters
      ? separateFilters(config.filters)
      : { rootFilters: {}, relationFilters: {} }
    const relationFilters = this._resolveRelationFilterAliases(rawRelationFilters, aliases)

    const queryOptions: Record<string, unknown> = {}
    if (Object.keys(withClause).length > 0) {
      queryOptions.with = withClause
    }

    // Pagination — no silent cap, warn on excessive limit.
    const limit = config.pagination?.limit ?? 100
    if (limit > RECOMMENDED_MAX_LIMIT) {
      this._logger?.warn(
        `DrizzleRelationalQuery: limit=${limit} exceeds recommended maximum (${RECOMMENDED_MAX_LIMIT}) for entity '${config.entity}'. Consider cursor pagination (see docs/queries-pagination.md).`,
      )
    }
    queryOptions.limit = limit
    if (config.pagination?.offset) {
      queryOptions.offset = config.pagination.offset
    }

    // Combined where callback — root filters + soft delete + relation EXISTS.
    const whereCallback = this._buildCombinedWhere(entityKey, rootFilters, relationFilters, config.withDeleted ?? false)
    if (whereCallback) {
      queryOptions.where = whereCallback
    }

    // Sort
    if (config.sort) {
      queryOptions.orderBy = this._buildOrderBy(config.sort, entityKey)
    }

    try {
      const results = await queryTarget.findMany(queryOptions)
      return this._flattenResults(results as Record<string, unknown>[], aliases)
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

    // Resolve aliases once for both the count projection and the results call.
    const entityNorm = config.entity.replace(/[_\s-]/g, '').toLowerCase()
    const aliases = this._relationAliases.get(entityNorm) ?? {}

    const { rootFilters, relationFilters: rawRelationFilters } = config.filters
      ? separateFilters(config.filters)
      : { rootFilters: {}, relationFilters: {} }
    const relationFilters = this._resolveRelationFilterAliases(rawRelationFilters, aliases)

    try {
      // Count path — PK-only projection, same combined where callback as
      // findWithRelations, no `with` clause, no pagination. This is a single
      // SQL query regardless of how many relation filters are active.
      const countOptions: Record<string, unknown> = { columns: { id: true } }
      const whereCallback = this._buildCombinedWhere(
        entityKey,
        rootFilters,
        relationFilters,
        config.withDeleted ?? false,
      )
      if (whereCallback) countOptions.where = whereCallback

      const countRows = await queryTarget.findMany(countOptions)
      const count = countRows.length

      // Results path — delegate to findWithRelations. This emits its own query
      // with `with`, pagination, and the same combined where. Two round-trips
      // total, both using EXISTS-based filtering.
      const results = await this.findWithRelations(config)
      return [results, count]
    } catch (error) {
      throw new MantaError(
        'DB_ERROR',
        `Relational count query failed for "${config.entity}": ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  // ── Combined where callback ─────────────────────────────────────────

  /**
   * Build the combined `where` callback used by both findWithRelations and
   * findAndCountWithRelations. Returns `undefined` when there are no
   * conditions at all (no filters, `withDeleted=true`).
   */
  private _buildCombinedWhere(
    entityKey: string,
    rootFilters: Record<string, unknown>,
    relationFilters: Record<string, Record<string, unknown>>,
    withDeleted: boolean,
  ): ((table: Record<string, unknown>, operators: DrizzleOperators) => unknown) | undefined {
    const hasRoot = Object.keys(rootFilters).length > 0
    const hasRelations = Object.keys(relationFilters).length > 0
    if (!hasRoot && !hasRelations && withDeleted) return undefined

    return (table: Record<string, unknown>, operators: DrizzleOperators) => {
      const conditions: unknown[] = []

      if (!withDeleted && table.deleted_at) {
        conditions.push(operators.isNull(table.deleted_at))
      }

      conditions.push(...buildFieldPredicates(table, operators, rootFilters))

      if (hasRelations) {
        for (const [relName, relFilters] of Object.entries(relationFilters)) {
          const predicate = this._buildRelationExists(entityKey, relName, relFilters, table, operators, withDeleted)
          if (predicate !== undefined) conditions.push(predicate)
        }
      }

      if (conditions.length === 0) return undefined
      if (conditions.length === 1) return conditions[0]
      return operators.and(...conditions)
    }
  }

  /**
   * Build a correlated `EXISTS (SELECT 1 FROM rel WHERE rel.fk = outer.pk AND …)`
   * clause for a single relation filter group. Handles:
   *  - direct has-many / belongs-to (one level)
   *  - nested dotted paths (e.g. `pivot.through.field`) → recursive EXISTS
   *
   * If the relation cannot be resolved against the Drizzle schema metadata the
   * predicate is silently dropped — the legacy behaviour, preserved so that
   * clients talking to a schema-less Drizzle client still succeed (the
   * relation filter becomes a no-op rather than throwing).
   */
  private _buildRelationExists(
    entityKey: string,
    relName: string,
    relFilters: Record<string, unknown>,
    outerTable: Record<string, unknown>,
    operators: DrizzleOperators,
    withDeleted: boolean,
  ): unknown {
    if (!operators.exists) return undefined
    const meta = this._meta()
    if (!meta) return undefined

    // Resolve the outer entity's TS name in the relational config
    const outerTsName = this._findTsName(meta, entityKey)
    if (!outerTsName) return undefined

    const relation = meta.schema[outerTsName]?.relations?.[relName] as { referencedTableName: string } | undefined
    if (!relation) return undefined

    // Find the child table's TS name via the referenced physical table name
    const childTsName = meta.tableNamesMap[relation.referencedTableName]
    if (!childTsName) return undefined
    const childTable = meta.fullSchema[childTsName] as Record<string, unknown> | undefined
    if (!childTable) return undefined

    // Normalize → join columns (source columns on outer, target columns on child)
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle relation dynamic type
    const norm = normalizeRelation(meta.schema as any, meta.tableNamesMap, relation as any)

    // Access child columns via getTableColumns; fall back to the raw table object.
    const childCols = getTableColumns(childTable as never) as Record<string, unknown>

    // Split the filter map into:
    //  - nested: `{nestedRel}.{rest}` → recursive EXISTS against child
    //  - direct: `{field}` → predicate on child directly
    const nestedGroups: Record<string, Record<string, unknown>> = {}
    const directFilters: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(relFilters)) {
      if (key.includes('.')) {
        const [nestedRelName, ...rest] = key.split('.')
        const nestedField = rest.join('.')
        if (!nestedGroups[nestedRelName]) nestedGroups[nestedRelName] = {}
        nestedGroups[nestedRelName][nestedField] = value
      } else {
        directFilters[key] = value
      }
    }

    // Inner correlation: child.fk = outer.pk (possibly composite)
    const joinConditions: unknown[] = []
    for (let i = 0; i < norm.fields.length; i++) {
      // biome-ignore lint/suspicious/noExplicitAny: Column instance shape
      const outerCol = (norm.fields[i] as any).name as string
      // biome-ignore lint/suspicious/noExplicitAny: Column instance shape
      const innerCol = (norm.references[i] as any).name as string
      const outerRef = outerTable[outerCol]
      const innerRef = childCols[innerCol]
      if (!outerRef || !innerRef) return undefined
      joinConditions.push(operators.eq(innerRef, outerRef))
    }

    // Child-level soft-delete propagation
    if (!withDeleted && childCols.deleted_at) {
      joinConditions.push(operators.isNull(childCols.deleted_at))
    }

    // Direct predicates on the child table
    const directPredicates = buildFieldPredicates(childCols, operators, directFilters)
    joinConditions.push(...directPredicates)

    // Nested EXISTS: one level deeper for each nested relation filter group.
    for (const [nestedRelName, nestedFilters] of Object.entries(nestedGroups)) {
      const nestedPredicate = this._buildRelationExists(
        childTsName,
        nestedRelName,
        nestedFilters,
        childCols,
        operators,
        withDeleted,
      )
      if (nestedPredicate !== undefined) joinConditions.push(nestedPredicate)
    }

    // Combine the child predicates and wrap into `EXISTS(SELECT 1 FROM child WHERE …)`.
    const combined =
      joinConditions.length === 0
        ? undefined
        : joinConditions.length === 1
          ? (joinConditions[0] as unknown)
          : (sqlAnd(...(joinConditions as never[])) as unknown)

    // biome-ignore lint/suspicious/noExplicitAny: Drizzle select builder dynamic typing
    const inner = (this._db as any)
      .select({ one: (childCols.id as unknown) ?? Object.values(childCols)[0] })
      .from(childTable)
    if (combined !== undefined) inner.where(combined)

    return operators.exists(inner)
  }

  /**
   * Resolve the entityKey (the `db.query.<key>` shape) to the TS name used by
   * the relational config. In practice these are the same string for all
   * Drizzle integrations, but the indirection is cheap and future-proofs
   * against Drizzle versions that normalize table keys differently.
   */
  private _findTsName(meta: DrizzleMeta, entityKey: string): string | undefined {
    if (meta.schema[entityKey]) return entityKey
    // Fallback: linear scan (cheap: a handful of tables).
    for (const tsName of Object.keys(meta.schema)) {
      if (tsName.toLowerCase() === entityKey.toLowerCase()) return tsName
    }
    return undefined
  }

  /**
   * Apply relation aliases to the user-provided relation filter map.
   *
   * - Simple string alias: `{ variants: {...} }` → `{ productVariants: {...} }`
   * - RelationAlias with `extraColumns`:
   *    `{ customers: { email: 'x', type: 'primary' } }` where `type` is an
   *    extraColumn on the pivot becomes
   *    `{ customerCustomerGroup: { type: 'primary', customer: { email: 'x' } } }`
   *    — i.e. the pivot filter routes to the pivot, the target filter routes
   *    to the through target, nested as a dotted sub-path that
   *    `_buildRelationExists` will pick up and emit as a nested EXISTS.
   */
  private _resolveRelationFilterAliases(
    relationFilters: Record<string, Record<string, unknown>>,
    aliases: Record<string, RelationAliasEntry>,
  ): Record<string, Record<string, unknown>> {
    if (Object.keys(aliases).length === 0) return relationFilters

    const result: Record<string, Record<string, unknown>> = {}
    for (const [relName, filters] of Object.entries(relationFilters)) {
      const aliasEntry = aliases[relName]
      if (!aliasEntry) {
        result[relName] = { ...(result[relName] ?? {}), ...filters }
        continue
      }

      if (typeof aliasEntry === 'string') {
        // Simple rename
        result[aliasEntry] = { ...(result[aliasEntry] ?? {}), ...filters }
        continue
      }

      const { pivot, through, extraColumns } = aliasEntry
      const pivotGroup: Record<string, unknown> = { ...(result[pivot] ?? {}) }
      const throughGroup: Record<string, unknown> = { ...((pivotGroup[through] as Record<string, unknown>) ?? {}) }

      for (const [field, value] of Object.entries(filters)) {
        if (extraColumns?.includes(field)) {
          pivotGroup[field] = value
        } else {
          throughGroup[field] = value
        }
      }

      // Nest the through-target filter under the dotted key shape the
      // recursive EXISTS builder expects.
      if (Object.keys(throughGroup).length > 0) {
        for (const [k, v] of Object.entries(throughGroup)) {
          pivotGroup[`${through}.${k}`] = v
        }
      }

      result[pivot] = pivotGroup
    }

    return result
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
   * Flatten M:N through-relations and rename Drizzle keys to user-friendly aliases.
   *
   * For simple aliases (string): rename key (e.g. 'customerCustomerGroup' → 'customers')
   * For RelationAlias (through): flatten pivot arrays into target entities with extra columns merged.
   *
   * Example: pivot rows `[{ customer: { id, name }, type: 'billing' }]`
   * → flattened to `[{ id, name, type: 'billing' }]` under the alias key `customers`
   */
  private _flattenResults(
    results: Record<string, unknown>[],
    aliases: Record<string, RelationAliasEntry>,
  ): Record<string, unknown>[] {
    const hasAliases = Object.keys(aliases).length > 0
    if (!hasAliases) return results

    // Build reverse mappings
    const simpleReverse: Record<string, string> = {} // drizzleName → alias
    const throughAliases: Record<string, { alias: string; through: string; extraColumns?: string[] }> = {}

    for (const [alias, entry] of Object.entries(aliases)) {
      if (typeof entry === 'string') {
        simpleReverse[entry] = alias
      } else {
        throughAliases[entry.pivot] = { alias, through: entry.through, extraColumns: entry.extraColumns }
      }
    }

    return results.map((row) => {
      const renamed: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(row)) {
        // Check for through-alias (M:N flattening)
        const throughInfo = throughAliases[key]
        if (throughInfo) {
          const pivotRows = Array.isArray(value) ? value : []
          renamed[throughInfo.alias] = pivotRows.map((pivotRow: Record<string, unknown>) => {
            const target = (pivotRow[throughInfo.through] ?? {}) as Record<string, unknown>
            if (throughInfo.extraColumns && throughInfo.extraColumns.length > 0) {
              const extras: Record<string, unknown> = {}
              for (const col of throughInfo.extraColumns) {
                if (col in pivotRow) extras[col] = pivotRow[col]
              }
              return { ...target, ...extras }
            }
            return { ...target }
          })
          continue
        }

        // Check for simple alias rename
        renamed[simpleReverse[key] ?? key] = value
      }
      return renamed
    })
  }
}
