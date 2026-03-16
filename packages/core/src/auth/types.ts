// SPEC-049/050 — Auth types

/**
 * Authentication context attached to a request scope.
 * Propagated through the entire request lifecycle.
 */
export interface AuthContext {
  actor_type: 'user' | 'customer' | 'system'
  actor_id: string
  auth_identity_id?: string
  scope?: 'admin' | 'store'
  session_id?: string
  app_metadata?: Record<string, unknown>
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
