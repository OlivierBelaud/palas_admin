// SPEC-049/050 — Auth types

/**
 * Authentication context attached to a request scope.
 * Propagated through the entire request lifecycle.
 *
 * - `id` — the authenticated user's ID (from the user table, e.g. admin_user.id)
 * - `type` — the context type (from defineUser, e.g. 'admin', 'customer')
 * - `email` — the user's email (if available in token metadata)
 */
export interface AuthContext {
  /** User ID (from the context's user table, e.g. admin_user.id). */
  id: string
  /** Context type (from defineUser, e.g. 'admin', 'customer'). */
  type: string
  /** User email (from token metadata). */
  email?: string
  /** Internal auth identity ID (for token management). */
  auth_identity_id?: string
  /** Additional metadata from the token. */
  metadata?: Record<string, unknown>
}

/**
 * Credentials extracted from a request by the HTTP adapter.
 * Passed to IAuthGateway.authenticate().
 */
export interface AuthCredentials {
  bearer?: string
  apiKey?: string
  sessionId?: string
}

/**
 * Options for session creation.
 */
export interface SessionOptions {
  ttl?: number
}
