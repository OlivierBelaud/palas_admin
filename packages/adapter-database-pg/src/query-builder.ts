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
