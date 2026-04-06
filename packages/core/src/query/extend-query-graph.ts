// extendQueryGraph — Extend the query graph with a custom resolver for external entities.
//
// Used by modules that own entities living in an external system (PostHog, Stripe, etc.).
// The module declares which entities it owns and provides a resolver that translates
// a Manta query graph into calls to the external backend.
//
// Unlike defineQueryGraph (which controls access per-context), extendQueryGraph ADDS
// new resolution paths to the query engine itself.
//
// Example (in modules/posthog/queries/graph.ts):
//   export default extendQueryGraph({
//     owns: ['posthogEvent', 'posthogPerson', 'posthogInsight'],
//     async resolve(query, ctx) {
//       // translate query → HogQL, fetch, return normalized rows
//     },
//   })

import type { ILoggerPort } from '../ports/logger'
import type { GraphQueryConfig } from './index'

/**
 * Context passed to an extension's resolver.
 */
export interface QueryGraphExtensionContext {
  /** MantaApp instance — used to resolve plugin config and other infra */
  // biome-ignore lint/suspicious/noExplicitAny: avoid circular type dep with MantaApp
  app: any
  logger: ILoggerPort
}

/**
 * Extension resolver — receives a Manta query graph config, returns normalized rows.
 */
export type QueryGraphExtensionResolver = (
  query: GraphQueryConfig,
  ctx: QueryGraphExtensionContext,
) => Promise<Record<string, unknown>[]>

/**
 * Definition of a query graph extension — what a module exports from `query-graph.ts`.
 */
export interface QueryGraphExtensionDefinition {
  __type: 'query-extension'
  /** Entity names this extension is responsible for resolving. */
  owns: string[]
  /** Resolver function — called by the query engine when any of the owned entities are queried. */
  resolve: QueryGraphExtensionResolver
  /**
   * Optional: filters supported by entity. Filters not in this list will throw a clear error
   * so the caller (or AI) can adapt. Omit to mean "all filters accepted" (use at own risk).
   */
  supportedFilters?: Record<string, string[]>
  /** Module name that registered this extension (populated at bootstrap) */
  __module?: string
}

/**
 * Declare that a module extends the query graph with resolvers for a set of external entities.
 */
export function extendQueryGraph(config: Omit<QueryGraphExtensionDefinition, '__type'>): QueryGraphExtensionDefinition {
  if (!Array.isArray(config.owns) || config.owns.length === 0) {
    throw new Error(
      'extendQueryGraph() requires a non-empty `owns` array listing the entity names this extension resolves.',
    )
  }
  if (typeof config.resolve !== 'function') {
    throw new Error('extendQueryGraph() requires a `resolve` function: async (query, ctx) => rows[]')
  }
  return {
    __type: 'query-extension',
    owns: config.owns,
    resolve: config.resolve,
    ...(config.supportedFilters ? { supportedFilters: config.supportedFilters } : {}),
  }
}
