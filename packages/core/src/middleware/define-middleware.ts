// SPEC-V2 — defineMiddleware() (singular)
// Per-context middleware override. Used in src/middleware/{context}.ts

import { MantaError } from '../errors/manta-error'

/**
 * Middleware request object — minimal interface for the handler.
 */
export interface MiddlewareRequest {
  method: string
  url: string
  headers: Record<string, string | string[] | undefined>
  /** Verify auth for a given context. Returns the auth entity or null. */
  verifyAuth: (
    contextName: string,
  ) => Promise<{ entity: Record<string, unknown>; actorType: string; actorId: string } | null>
  /** Parsed body (if POST/PUT/PATCH). */
  body?: unknown
  /** Parsed query parameters. */
  query?: Record<string, unknown>
}

/**
 * What defineMiddleware() returns — a per-context middleware definition.
 */
export interface MiddlewareDefinition {
  handler: (req: MiddlewareRequest, next: () => Promise<unknown>) => Promise<unknown>
  __type: 'middleware'
}

/**
 * Define a per-context middleware override.
 *
 * Place the file in `src/middleware/{context}.ts` to override the auto-generated
 * middleware for that context. The auto-generated middleware (from defineUser)
 * handles JWT verification and actor_type checking. Use defineMiddleware to add
 * custom logic on top (RBAC, rate limiting, etc.).
 *
 * @example
 * ```typescript
 * // src/middleware/admin.ts
 * import { defineMiddleware, MantaError } from '@manta/core'
 *
 * export default defineMiddleware(async (req, next) => {
 *   const auth = await req.verifyAuth('admin')
 *   if (!auth) throw new MantaError('UNAUTHORIZED')
 *
 *   // Custom RBAC logic
 *   const user = auth.entity
 *   if (user.role === 'viewer' && req.method !== 'GET') {
 *     throw new MantaError('FORBIDDEN', 'Viewers have read-only access')
 *   }
 *
 *   return next()
 * })
 * ```
 */
export function defineMiddleware(
  handler: (req: MiddlewareRequest, next: () => Promise<unknown>) => Promise<unknown>,
): MiddlewareDefinition {
  if (typeof handler !== 'function') {
    throw new MantaError('INVALID_DATA', 'defineMiddleware() requires a handler function')
  }
  return {
    handler,
    __type: 'middleware',
  }
}
