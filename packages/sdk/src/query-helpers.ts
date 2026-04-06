// Query input helpers — reusable Zod fragments for common query patterns
// Not part of the React hooks — used in defineQuery() backend code.
// Re-exported from @manta/sdk for convenience.

import { z } from 'zod'

/**
 * Standard list params: limit, offset, sort, search.
 * Spread into your defineQuery input schema.
 *
 * @example
 * ```typescript
 * export default defineQuery({
 *   name: 'list-products',
 *   input: z.object({
 *     status: z.string().optional(),
 *     ...listParams(),
 *   }),
 *   handler: async (input, { query }) => { ... },
 * })
 * ```
 */
export function listParams(defaults?: { limit?: number; maxLimit?: number }) {
  const maxLimit = defaults?.maxLimit ?? 100
  return {
    limit: z
      .number()
      .int()
      .min(1)
      .max(maxLimit)
      .default(defaults?.limit ?? 20),
    offset: z.number().int().min(0).default(0),
    sort: z.string().optional(),
    order: z.enum(['asc', 'desc']).default('desc'),
    search: z.string().optional(),
  }
}

/**
 * Standard retrieve params: id + optional fields.
 *
 * @example
 * ```typescript
 * export default defineQuery({
 *   name: 'get-product',
 *   input: z.object({ ...retrieveParams() }),
 *   handler: async (input, { query }) => { ... },
 * })
 * ```
 */
export function retrieveParams() {
  return {
    id: z.string(),
    fields: z.array(z.string()).optional(),
  }
}
