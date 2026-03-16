// SPEC-049/050/049b — Auth port interfaces

import type { AuthContext, AuthCredentials, SessionOptions } from '../auth/types'

/** SPEC-049 — Auth (crypto pure) */
export interface IAuthPort {
  verifyJwt(token: string): AuthContext | null
  verifyApiKey(key: string): AuthContext | null
  createJwt(payload: AuthContext, options?: { expiresIn?: string | number }): string
}

/** SPEC-050 — Auth Module Service (business logic + sessions) */
export interface IAuthModuleService {
  authenticate(data: Record<string, unknown>): Promise<AuthContext | null>
  register(data: Record<string, unknown>): Promise<{ authIdentity: unknown }>
  validateCallback(data: Record<string, unknown>): Promise<AuthContext | null>
  createSession(authContext: AuthContext, options?: SessionOptions): Promise<{ sessionId: string; expiresAt: Date }>
  destroySession(sessionId: string): Promise<void>
  verifySession(sessionId: string): Promise<AuthContext | null>
}

/** SPEC-049b — Auth Gateway */
export interface IAuthGateway {
  authenticate(credentials: AuthCredentials): Promise<AuthContext | null>
}
