// defineQueryGraph — Expose the query graph for a context with row-level scoping.
//
// Three modes:
//   defineQueryGraph('*')                              → wildcard, full access (admin/AI)
//   defineQueryGraph({ product: true, order: (auth) => ({ customer_id: auth.id }) })
//                                                      → scoped per entity
//   No defineQueryGraph = no graph query access         → useGraphQuery errors in SDK
//
// Usage:
//   // src/queries/admin/graph.ts — full access
//   export default defineQueryGraph('*')
//
//   // src/queries/store/graph.ts — scoped access with row-level filters
//   export default defineQueryGraph({
//     product: true,
//     category: true,
//     order: (auth) => ({ customer_id: auth.id }),
//     customer: (auth) => ({ id: auth.id }),
//   })

import type { AuthContext } from '../auth/types'
import { MantaError } from '../errors/manta-error'

/**
 * Entity name for graph access — autocompletes from codegen.
 */
type EntityNameArg = keyof MantaGeneratedEntities | (string & {})

/**
 * Per-entity access rule:
 * - `true` — all rows, no filter
 * - `(auth) => filters` — row-level filter based on authenticated user
 */
export type EntityAccessRule = true | ((auth: AuthContext) => Record<string, unknown>)

/**
 * Entity access map — defines which entities are accessible and how rows are scoped.
 */
export type EntityAccessMap = Record<string, EntityAccessRule>

/**
 * Query graph definition — controls entity + row-level access for graph queries.
 */
export interface QueryGraphDefinition {
  __type: 'query-graph'
  /** '*' = wildcard (all entities, all rows). Otherwise per-entity rules. */
  access: '*' | EntityAccessMap
}

/**
 * Define query graph access for a context.
 *
 * @example
 * ```typescript
 * // src/queries/admin/graph.ts — full access (admin/AI)
 * export default defineQueryGraph('*')
 *
 * // src/queries/store/graph.ts — scoped access
 * export default defineQueryGraph({
 *   product: true,                                        // all products
 *   category: true,                                       // all categories
 *   order: (auth) => ({ customer_id: auth.id }),    // only MY orders
 *   customer: (auth) => ({ id: auth.id }),          // only MY profile
 * })
 * ```
 */
export function defineQueryGraph(access: '*'): QueryGraphDefinition
export function defineQueryGraph(access: Record<EntityNameArg, EntityAccessRule>): QueryGraphDefinition
export function defineQueryGraph(access: '*' | Record<EntityNameArg, EntityAccessRule>): QueryGraphDefinition {
  if (access !== '*' && (typeof access !== 'object' || access === null)) {
    throw new MantaError('INVALID_DATA', 'defineQueryGraph() requires "*" or an entity access map')
  }
  if (typeof access === 'object' && Object.keys(access).length === 0) {
    throw new MantaError('INVALID_DATA', 'defineQueryGraph() entity map cannot be empty. Use "*" for full access.')
  }

  return {
    __type: 'query-graph',
    access,
  }
}

/**
 * Check if an entity is allowed by the query graph definition.
 */
export function isEntityAllowed(def: QueryGraphDefinition, entity: string): boolean {
  if (def.access === '*') return true
  return entity in def.access
}

/**
 * Get the row-level filter for an entity, given the auth context.
 * Returns undefined if no filter (wildcard or `true` rule).
 * Returns the filter record if a scope function is defined.
 * Returns null if entity is not allowed.
 */
export function getEntityFilter(
  def: QueryGraphDefinition,
  entity: string,
  auth: AuthContext | null,
): Record<string, unknown> | undefined | null {
  if (def.access === '*') return undefined // no filter
  const rule = def.access[entity]
  if (rule === undefined) return null // not allowed
  if (rule === true) return undefined // all rows
  if (!auth) return null // scoped entity but no auth → blocked
  return rule(auth)
}
