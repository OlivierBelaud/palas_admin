// SPEC-V2 — defineQuery() + QueryRegistry
// CQRS read side. Parallels defineCommand but for GET endpoints.

import type { z } from 'zod'
import type { AuthContext } from '../auth/types'
import { MantaError } from '../errors/manta-error'
import type { ILoggerPort } from '../ports/logger'
import type { QueryService } from './index'

/**
 * Query handler context — what the developer receives in the handler.
 */
export interface QueryHandlerContext {
  /** QueryService for cross-module graph queries. */
  query: QueryService
  /** Structured logger. */
  log: ILoggerPort
  /** Authenticated user context (null if public route). */
  auth: AuthContext | null
  /** Raw request headers. */
  headers: Record<string, string | undefined>
}

/**
 * What the developer writes — a query config with a handler.
 */
export interface QueryConfig<TInput = unknown, TOutput = unknown> {
  name: string
  description: string
  input: z.ZodType<TInput>
  handler: (input: TInput, context: QueryHandlerContext) => Promise<TOutput>
}

/**
 * Internal query definition — handler receives raw context. Used by bootstrap/registry.
 */
export interface QueryDefinition<TInput = unknown, TOutput = unknown> {
  name: string
  description: string
  input: z.ZodType<TInput>
  handler: (input: TInput, context: QueryHandlerContext) => Promise<TOutput>
  __type: 'query'
}

/**
 * Define a query (CQRS read side).
 *
 * Queries are read-only, side-effect-free operations exposed as GET endpoints.
 * They receive the QueryService for cross-module graph queries, or can access
 * module services directly through the app.
 *
 * @example
 * ```typescript
 * // src/queries/admin/list-products.ts
 * import { defineQuery } from '@manta/core'
 * import { z } from 'zod'
 *
 * export default defineQuery({
 *   name: 'list-products',
 *   description: 'List products with filtering and pagination',
 *   input: z.object({
 *     status: z.enum(['draft', 'active', 'archived']).optional(),
 *     limit: z.number().default(20),
 *     offset: z.number().default(0),
 *   }),
 *   handler: async (input, { query }) => {
 *     return query.graph({
 *       entity: 'product',
 *       filters: input.status ? { status: input.status } : undefined,
 *       pagination: { limit: input.limit, offset: input.offset },
 *     })
 *   },
 * })
 * ```
 */
export function defineQuery<TInput, TOutput>(config: QueryConfig<TInput, TOutput>): QueryDefinition<TInput, TOutput> {
  if (!config.name) {
    throw new MantaError(
      'INVALID_DATA',
      'Query name is required. Usage: defineQuery({ name: "list-products", description: "...", input: z.object({...}), handler: async (input, { query }) => {...} })',
    )
  }
  if (!config.description) {
    throw new MantaError('INVALID_DATA', `Query "${config.name}" requires a description.`)
  }
  if (!config.input) {
    throw new MantaError(
      'INVALID_DATA',
      `Query "${config.name}" requires an input Zod schema. Use z.object({}) for queries with no parameters.`,
    )
  }
  if (typeof config.handler !== 'function') {
    throw new MantaError(
      'INVALID_DATA',
      `Query "${config.name}" handler must be an async function: handler: async (input, { query }) => {...}`,
    )
  }

  return {
    name: config.name,
    description: config.description,
    input: config.input,
    handler: config.handler,
    __type: 'query',
  }
}

/**
 * Registry for query definitions — analogous to CommandRegistry.
 */
export class QueryRegistry {
  private _entries = new Map<string, QueryDefinition>()

  register(def: QueryDefinition): void {
    if (this._entries.has(def.name)) {
      throw new MantaError('DUPLICATE_ERROR', `Query "${def.name}" is already registered`)
    }
    this._entries.set(def.name, def)
  }

  get(name: string): QueryDefinition | undefined {
    return this._entries.get(name)
  }

  list(): QueryDefinition[] {
    return [...this._entries.values()]
  }

  _reset(): void {
    this._entries.clear()
  }
}
