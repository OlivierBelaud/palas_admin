// authenticate() middleware — ISO Medusa V2
// Extracts auth context from JWT (Bearer) or session (cookie), sets req.auth_context.

import { MantaError } from '../errors/manta-error'
import type { AuthModuleService } from './auth-module-service'
import type { AuthContext } from './types'

export interface AuthenticateOptions {
  allowUnregistered?: boolean
  allowUnauthenticated?: boolean
  logger?: { warn: (msg: string) => void }
}

/**
 * Extract auth context from a request.
 * Checks Bearer token first, then session cookie.
 *
 * @param actorType - Expected actor type ("user", "customer", "*" for any)
 * @param authTypes - Allowed auth methods: "bearer", "session", or array
 * @param options - Allow unregistered/unauthenticated access
 */
export function extractAuthContext(
  headers: Record<string, string | undefined>,
  sessionId: string | undefined,
  authService: AuthModuleService,
  jwtSecret: string,
  actorType: string,
  authTypes: string | string[] = ['bearer', 'session'],
  options?: AuthenticateOptions,
): Promise<AuthContext | null> {
  const types = Array.isArray(authTypes) ? authTypes : [authTypes]
  return _extractAuthContext(headers, sessionId, authService, jwtSecret, actorType, types, options)
}

async function _extractAuthContext(
  headers: Record<string, string | undefined>,
  sessionId: string | undefined,
  authService: AuthModuleService,
  jwtSecret: string,
  actorType: string,
  authTypes: string[],
  options?: AuthenticateOptions,
): Promise<AuthContext | null> {
  let authContext: AuthContext | null = null

  // 1. Try Bearer token
  if (authTypes.includes('bearer')) {
    const authHeader = headers.authorization || headers.Authorization
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      try {
        const payload = await authService.verifyToken(token, jwtSecret)
        authContext = {
          id: payload.id as string,
          type: payload.type as AuthContext['type'],
          auth_identity_id: payload.auth_identity_id as string,
          metadata: payload.metadata as Record<string, unknown>,
        }
      } catch (err) {
        options?.logger?.warn(`[auth] Bearer token verification failed: ${(err as Error).message}`)
      }
    }
  }

  // 2. Try session
  if (!authContext && authTypes.includes('session') && sessionId) {
    const sessionData = await authService.verifySession(sessionId)
    if (sessionData) {
      authContext = sessionData as unknown as AuthContext
    }
  }

  // 3. Decide
  if (authContext?.id) {
    // Fully authenticated
    if (actorType !== '*' && authContext.type !== actorType) {
      throw new MantaError('UNAUTHORIZED', `Actor type "${authContext.type}" not allowed for "${actorType}"`)
    }
    return authContext
  }

  if (authContext?.auth_identity_id && options?.allowUnregistered) {
    // Has auth identity but no id yet (registered with provider, not linked to user)
    return authContext
  }

  if (options?.allowUnauthenticated) {
    return null
  }

  throw new MantaError('UNAUTHORIZED', 'Authentication required')
}
