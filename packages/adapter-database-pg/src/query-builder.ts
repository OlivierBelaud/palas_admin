// Query builder utilities for Drizzle relational queries
//
// Converts the Manta query format (fields, filters, sort) into
// Drizzle relational query API format (with, where, orderBy, limit).

/**
 * Drizzle `with` clause — nested relation loading config.
 *
 * `{ variants: true }` — load all variant fields
 * `{ variants: { columns: { sku: true } } }` — load specific fields
 * `{ variants: { with: { options: true } } }` — nested relation
 */
export type DrizzleWithClause = Record<string, true | DrizzleWithConfig>

export interface DrizzleWithConfig {
  columns?: Record<string, true>
  with?: DrizzleWithClause
  where?: unknown
  limit?: number
  offset?: number
}

/**
 * Build a Drizzle `with` clause from Manta fields array.
 *
 * @example
 * buildDrizzleWith(['*']) → {}
 * buildDrizzleWith(['*', 'variants.*']) → { variants: true }
 * buildDrizzleWith(['*', 'variants.options.*']) → { variants: { with: { options: true } } }
 * buildDrizzleWith(['id', 'variants.sku']) → { variants: { columns: { sku: true } } }
 */
export function buildDrizzleWith(fields: string[]): DrizzleWithClause {
  const result: DrizzleWithClause = {}

  for (const field of fields) {
    if (!field.includes('.')) continue

    const parts = field.split('.')
    const relName = parts[0]
    const rest = parts.slice(1).join('.')

    if (rest === '*') {
      // Load all fields of this relation
      if (!result[relName]) {
        result[relName] = true
      }
    } else if (rest.includes('.')) {
      // Nested relation: variants.options.* or variants.options.name
      const nestedParts = rest.split('.')
      const nestedRel = nestedParts[0]
      const nestedRest = nestedParts.slice(1).join('.')

      // Ensure parent is a config object
      if (result[relName] === true || !result[relName]) {
        result[relName] = { with: {} }
      }
      const config = result[relName] as DrizzleWithConfig
      if (!config.with) config.with = {}

      if (nestedRest === '*') {
        config.with[nestedRel] = true
      } else {
        if (!config.with[nestedRel] || config.with[nestedRel] === true) {
          config.with[nestedRel] = { columns: {} }
        }
        const nestedConfig = config.with[nestedRel] as DrizzleWithConfig
        if (!nestedConfig.columns) nestedConfig.columns = {}
        nestedConfig.columns[nestedRest] = true
      }
    } else {
      // Specific field on relation: variants.sku
      if (result[relName] === true) continue // already loading all
      if (!result[relName]) {
        result[relName] = { columns: {} }
      }
      const config = result[relName] as DrizzleWithConfig
      if (!config.columns) config.columns = {}
      config.columns[rest] = true
    }
  }

  return result
}

/**
 * Result of separating root vs relation filters.
 */
export interface SeparatedFilters {
  rootFilters: Record<string, unknown>
  relationFilters: Record<string, Record<string, unknown>>
  hasRelationFilters: boolean
}

/**
 * Separate root-level filters from relation filters (dotted paths).
 *
 * @example
 * separateFilters({ status: 'active', 'customer.name': 'Acme' })
 * → { rootFilters: { status: 'active' }, relationFilters: { customer: { name: 'Acme' } }, hasRelationFilters: true }
 */
export function separateFilters(filters: Record<string, unknown>): SeparatedFilters {
  const rootFilters: Record<string, unknown> = {}
  const relationFilters: Record<string, Record<string, unknown>> = {}
  let hasRelationFilters = false

  for (const [key, value] of Object.entries(filters)) {
    if (key.includes('.')) {
      hasRelationFilters = true
      const parts = key.split('.')
      const relName = parts[0]
      const relField = parts.slice(1).join('.')
      if (!relationFilters[relName]) relationFilters[relName] = {}
      relationFilters[relName][relField] = value
    } else {
      rootFilters[key] = value
    }
  }

  return { rootFilters, relationFilters, hasRelationFilters }
}

/**
 * Apply relation pagination to a Drizzle `with` clause.
 */
export function applyRelationPagination(
  withClause: DrizzleWithClause,
  relPagination: Record<string, { limit?: number; offset?: number }>,
): DrizzleWithClause {
  const result = { ...withClause }

  for (const [relName, pag] of Object.entries(relPagination)) {
    if (result[relName] === true) {
      result[relName] = { limit: pag.limit, offset: pag.offset }
    } else if (result[relName] && typeof result[relName] === 'object') {
      const config = result[relName] as DrizzleWithConfig
      result[relName] = { ...config, limit: pag.limit, offset: pag.offset }
    } else {
      // Relation not in fields but has pagination — add it
      result[relName] = { limit: pag.limit, offset: pag.offset }
    }
  }

  return result
}

/**
 * Check if any of the requested fields include relations (contain a dot).
 */
export function hasRelationFields(fields?: string[]): boolean {
  if (!fields || fields.length === 0) return false
  return fields.some((f) => f.includes('.'))
}

/**
 * Drizzle operators passed into `where` callbacks by the relational query API
 * and by raw `db.select()` builders. We only need a structural subset — the
 * runtime value is whatever Drizzle gives us, so we rely on `unknown[]` return
 * shapes.
 */
export type DrizzleOperators = {
  and: (...args: unknown[]) => unknown
  eq: (...args: unknown[]) => unknown
  ne: (...args: unknown[]) => unknown
  gt: (...args: unknown[]) => unknown
  gte: (...args: unknown[]) => unknown
  lt: (...args: unknown[]) => unknown
  lte: (...args: unknown[]) => unknown
  inArray: (...args: unknown[]) => unknown
  notInArray: (...args: unknown[]) => unknown
  isNull: (...args: unknown[]) => unknown
  isNotNull?: (...args: unknown[]) => unknown
  exists?: (...args: unknown[]) => unknown
}

/**
 * Supported field-level operator syntax (Mongo-style) for relational queries.
 * Re-exported for documentation only — logic lives inline.
 */
export const SUPPORTED_FIELD_OPERATORS = [
  '$eq',
  '$ne',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$in',
  '$nin',
  '$null',
  '$notnull',
] as const

/**
 * Build an array of Drizzle SQL predicates from a flat `{ field: value | opObj }` map
 * against a specific table (either a relational-query `fields` object or a drizzle
 * table with `getTableColumns`-style column accessors).
 *
 * Shared by both root-level filters and relation-level filters inside EXISTS
 * subqueries so that the operator semantics do not diverge between the two
 * paths (closes BC-F31 by construction).
 *
 * - Unknown fields are silently skipped (same behaviour as the legacy
 *   `_buildWhereConditions`). Callers that need strict validation should check
 *   upstream.
 * - `null` value emits `IS NULL`.
 * - An object value is treated as an operator bag (`{ $eq, $in, … }`).
 * - A plain scalar is treated as equality.
 */
export function buildFieldPredicates(
  table: Record<string, unknown>,
  operators: DrizzleOperators,
  filters: Record<string, unknown>,
): unknown[] {
  const conditions: unknown[] = []

  const dbg =
    process.env.MANTA_DEBUG_FILTERS_CAPTURE === '1'
      ? ((globalThis as unknown as { __mantaDebugLogs?: string[] }).__mantaDebugLogs ?? null)
      : null

  if (dbg) {
    dbg.push(`tableKeys=${JSON.stringify(Object.keys(table).slice(0, 30))}`)
    dbg.push(`operatorsKeys=${JSON.stringify(Object.keys(operators))}`)
    dbg.push(`filters=${JSON.stringify(filters)}`)
  }

  for (const [key, value] of Object.entries(filters)) {
    const column = table[key]
    if (dbg) {
      const colInfo = column ? `FOUND(${typeof column})` : 'MISSING'
      dbg.push(
        `key=${key} column=${colInfo} value=${JSON.stringify(value)} typeof=${typeof value} isArr=${Array.isArray(value)}`,
      )
    }
    if (!column) continue

    if (value === null) {
      conditions.push(operators.isNull(column))
      continue
    }

    // Plain array value → `column IN (...)`. Covers multi-select UI filters
    // where the URL serializer sends `filter_field=a,b,c` as `field: ['a','b','c']`.
    if (Array.isArray(value)) {
      if (value.length === 0) continue
      conditions.push(operators.inArray(column, value))
      continue
    }

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const ops = value as Record<string, unknown>
      for (const [op, val] of Object.entries(ops)) {
        switch (op) {
          case '$eq':
            conditions.push(operators.eq(column, val))
            break
          case '$ne':
            conditions.push(operators.ne(column, val))
            break
          case '$gt':
            conditions.push(operators.gt(column, val))
            break
          case '$gte':
            conditions.push(operators.gte(column, val))
            break
          case '$lt':
            conditions.push(operators.lt(column, val))
            break
          case '$lte':
            conditions.push(operators.lte(column, val))
            break
          case '$in':
            conditions.push(operators.inArray(column, val))
            break
          case '$nin':
            conditions.push(operators.notInArray(column, val))
            break
          case '$null':
            // `{ $null: true }` → IS NULL; `{ $null: false }` → IS NOT NULL.
            if (val === true) conditions.push(operators.isNull(column))
            else if (val === false && operators.isNotNull) conditions.push(operators.isNotNull(column))
            break
          case '$notnull':
            // `{ $notnull: true }` → IS NOT NULL; `{ $notnull: false }` → IS NULL.
            if (val === true && operators.isNotNull) conditions.push(operators.isNotNull(column))
            else if (val === false) conditions.push(operators.isNull(column))
            break
          // unknown operator keys are ignored on purpose — keeps behaviour
          // compatible with pre-F31 root filters.
        }
      }
      continue
    }

    conditions.push(operators.eq(column, value))
  }

  if (dbg) dbg.push(`conditions.length=${conditions.length}`)
  return conditions
}
