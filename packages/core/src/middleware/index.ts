// SPEC-039 — defineMiddlewares() for HTTP pipeline configuration

import type { MantaErrorType } from '../errors/manta-error'

/**
 * A single middleware configuration entry.
 */
export interface MiddlewareConfig {
  matcher: string | RegExp | ((req: unknown) => boolean)
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
  bodyParser?: { type: 'json' | 'multipart' | 'text' | 'urlencoded' }
  validators?: {
    body?: unknown // Zod schema
    query?: unknown // Zod schema
  }
  rateLimit?: {
    maxRequests: number
    windowMs: number
  }
  middlewares?: Array<(req: unknown, res: unknown, next: () => void) => Promise<void> | void>
  errorHandler?: (err: unknown, req: unknown, res: unknown, next: () => void) => void
  RBAC?: { policies?: string[] }
  AUTHENTICATE?: false // opt-out of auth for this route
}

/**
 * defineMiddlewares() — declares middleware pipeline configuration for routes.
 *
 * Returns the configurations for the IHttpPort adapter to apply
 * as part of the 12-step pipeline.
 *
 * Usage:
 *   export default defineMiddlewares([
 *     {
 *       matcher: '/admin/products',
 *       method: 'POST',
 *       validators: { body: CreateProductSchema },
 *     },
 *     {
 *       matcher: '/store/*',
 *       rateLimit: { maxRequests: 200, windowMs: 60_000 },
 *     },
 *   ])
 */
export function defineMiddlewares(configs: MiddlewareConfig[]): MiddlewareConfig[] {
  return configs
}

/**
 * Error-to-HTTP-status mapping per SPEC-041.
 */
export const ERROR_STATUS_MAP: Record<string, number> = {
  NOT_FOUND: 404,
  INVALID_DATA: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  DUPLICATE_ERROR: 422,
  CONFLICT: 409,
  NOT_ALLOWED: 400,
  DB_ERROR: 500,
  UNEXPECTED_STATE: 500,
  INVALID_STATE: 500,
  UNKNOWN_MODULES: 500,
  NOT_IMPLEMENTED: 501,
  RESOURCE_EXHAUSTED: 429,
}

/**
 * Map a MantaError type to an HTTP status code.
 */
export function mapErrorToStatus(errorType: MantaErrorType | string): number {
  return ERROR_STATUS_MAP[errorType] ?? 500
}
