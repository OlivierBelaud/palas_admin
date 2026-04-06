// SPEC-049/050/049b — Mock auth implementations for dev/test

import type { AuthenticationInput, AuthenticationResponse } from '../auth/providers/types'
import type { AuthContext, AuthCredentials, SessionOptions } from '../auth/types'
import type { IAuthGateway, IAuthModuleService, IAuthPort } from '../ports/auth'

export interface TestAuthConfig {
  jwt?: AuthContext
  apiKeys?: Record<string, AuthContext>
  sessions?: Record<string, AuthContext>
}

export class MockAuthPort implements IAuthPort {
  private _config: TestAuthConfig
  private _tokenStore = new Map<string, { payload: AuthContext; expiresAt: number }>()

  constructor(config?: TestAuthConfig) {
    this._config = config ?? {}
  }

  verifyJwt(token: string): AuthContext | null {
    if (!token || !token.startsWith('jwt_')) return null

    // Check token store for expiration
    const stored = this._tokenStore.get(token)
    if (stored) {
      if (Date.now() > stored.expiresAt) {
        this._tokenStore.delete(token)
        return null
      }
      return stored.payload
    }

    return this._config.jwt ?? null
  }

  verifyApiKey(key: string): AuthContext | null {
    if (!key || !key.startsWith('sk_')) return null
    return this._config.apiKeys?.[key] ?? null
  }

  createJwt(payload: AuthContext, options?: { expiresIn?: string | number }): string {
    const token = `jwt_${payload.type}_${payload.id}_${Date.now()}`

    if (options?.expiresIn) {
      let expiresInMs: number
      if (typeof options.expiresIn === 'number') {
        expiresInMs = options.expiresIn * 1000 // seconds to ms
      } else {
        // Parse string like '1h', '30m', '60s'
        const match = options.expiresIn.match(/^(\d+)(s|m|h|d)$/)
        if (match) {
          const value = parseInt(match[1], 10)
          const unit = match[2]
          const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 }
          expiresInMs = value * multipliers[unit]
        } else {
          expiresInMs = 3600000 // default 1h
        }
      }
      this._tokenStore.set(token, { payload, expiresAt: Date.now() + expiresInMs })
    } else {
      // No expiration — store with far future
      this._tokenStore.set(token, { payload, expiresAt: Number.MAX_SAFE_INTEGER })
    }

    return token
  }

  /** Test helper: update config at runtime */
  _configure(config: TestAuthConfig) {
    this._config = { ...this._config, ...config }
  }
}

export class MockAuthModuleService implements IAuthModuleService {
  private _sessions = new Map<string, { authContext: AuthContext; expiresAt: Date }>()
  private _config: TestAuthConfig

  constructor(config?: TestAuthConfig) {
    this._config = config ?? {}
    // Pre-load configured sessions
    if (config?.sessions) {
      for (const [sid, auth] of Object.entries(config.sessions)) {
        this._sessions.set(sid, { authContext: auth, expiresAt: new Date(Date.now() + 86400000) })
      }
    }
  }

  async authenticate(_provider: string, _data: AuthenticationInput): Promise<AuthenticationResponse> {
    const ctx = this._config.jwt
    if (!ctx) return { success: false, error: 'No mock JWT configured' }
    return {
      success: true,
      authIdentity: { id: ctx.auth_identity_id ?? crypto.randomUUID(), app_metadata: ctx.metadata },
    }
  }

  async register(_provider: string, _data: AuthenticationInput): Promise<AuthenticationResponse> {
    return {
      success: true,
      authIdentity: { id: crypto.randomUUID() },
    }
  }

  async validateCallback(_provider: string, _data: AuthenticationInput): Promise<AuthenticationResponse> {
    const ctx = this._config.jwt
    if (!ctx) return { success: false, error: 'No mock JWT configured' }
    return {
      success: true,
      authIdentity: { id: ctx.auth_identity_id ?? crypto.randomUUID(), app_metadata: ctx.metadata },
    }
  }

  async createSession(
    authContext: AuthContext,
    options?: SessionOptions,
  ): Promise<{ sessionId: string; expiresAt: Date }> {
    const sessionId = crypto.randomUUID()
    const ttl = (options?.ttl ?? 86400) * 1000
    const expiresAt = new Date(Date.now() + ttl)
    this._sessions.set(sessionId, { authContext, expiresAt })

    // Handle TTL expiry (for fake timers in tests)
    if (options?.ttl) {
      setTimeout(() => this._sessions.delete(sessionId), ttl)
    }

    return { sessionId, expiresAt }
  }

  async destroySession(sessionId: string): Promise<void> {
    this._sessions.delete(sessionId)
  }

  async verifySession(sessionId: string): Promise<AuthContext | null> {
    const session = this._sessions.get(sessionId)
    if (!session) return null
    if (session.expiresAt < new Date()) {
      this._sessions.delete(sessionId)
      return null
    }
    return session.authContext
  }

  /** Test helper */
  _reset() {
    this._sessions.clear()
  }
}

/** SPEC-049b — Auth Gateway facade */
export class MockAuthGateway implements IAuthGateway {
  constructor(
    private authPort: IAuthPort,
    private authModuleService: IAuthModuleService,
  ) {}

  async authenticate(credentials: AuthCredentials): Promise<AuthContext | null> {
    // Priority 1: Bearer token
    if (credentials.bearer) {
      const jwtResult = this.authPort.verifyJwt(credentials.bearer)
      if (jwtResult) return jwtResult

      // Fallback to API key only if bearer starts with sk_
      if (credentials.bearer.startsWith('sk_')) {
        const apiKeyResult = this.authPort.verifyApiKey(credentials.bearer)
        if (apiKeyResult) return apiKeyResult
      }

      // Bearer present but invalid → definitive rejection (AG-10, AG-14)
      return null
    }

    // Priority 2: API key (without bearer)
    if (credentials.apiKey) {
      return this.authPort.verifyApiKey(credentials.apiKey)
    }

    // Priority 3: Session (without bearer or API key)
    if (credentials.sessionId) {
      return this.authModuleService.verifySession(credentials.sessionId)
    }

    // No credentials
    return null
  }
}
