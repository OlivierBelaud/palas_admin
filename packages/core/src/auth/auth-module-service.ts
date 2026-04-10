// AuthModuleService — manages auth identities, provider identities, and delegates to providers.
// ISO Medusa V2's AuthModuleService interface.

import { MantaError } from '../errors/manta-error'
import type { IRepository } from '../ports/repository'
import type {
  AuthenticationInput,
  AuthenticationResponse,
  IAuthIdentityProviderService,
  IAuthProvider,
} from './providers/types'
import type { AuthContext, SessionOptions } from './types'

export interface AuthModuleServiceDeps {
  baseRepository: IRepository
  authIdentityRepository: IRepository
  providerIdentityRepository: IRepository
  cache?: {
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown, ttl?: number) => Promise<void>
    invalidate: (key: string) => Promise<void>
  }
}

interface AuthIdentityDTO {
  id: string
  app_metadata: Record<string, unknown> | null
  provider_identities?: ProviderIdentityDTO[]
}

interface ProviderIdentityDTO {
  id: string
  entity_id: string
  provider: string
  auth_identity_id: string
  user_metadata: Record<string, unknown> | null
  provider_metadata: Record<string, unknown> | null
}

export class AuthModuleService {
  private authIdentityRepo: IRepository
  private providerIdentityRepo: IRepository
  private providers = new Map<string, IAuthProvider>()
  private cache?: AuthModuleServiceDeps['cache']

  constructor(deps: AuthModuleServiceDeps) {
    this.authIdentityRepo = deps.authIdentityRepository
    this.providerIdentityRepo = deps.providerIdentityRepository
    this.cache = deps.cache
  }

  // --- Provider management ---

  registerProvider(id: string, provider: IAuthProvider): void {
    this.providers.set(id, provider)
  }

  getProvider(id: string): IAuthProvider {
    const provider = this.providers.get(id)
    if (!provider) throw new MantaError('NOT_FOUND', `Auth provider "${id}" not registered`)
    return provider
  }

  // --- Authentication ---

  async authenticate(provider: string, data: AuthenticationInput): Promise<AuthenticationResponse> {
    const authProvider = this.getProvider(provider)
    return authProvider.authenticate(data, this.createProviderService(provider))
  }

  async register(provider: string, data: AuthenticationInput): Promise<AuthenticationResponse> {
    const authProvider = this.getProvider(provider)
    return authProvider.register(data, this.createProviderService(provider))
  }

  async validateCallback(provider: string, data: AuthenticationInput): Promise<AuthenticationResponse> {
    const authProvider = this.getProvider(provider)
    if (!authProvider.validateCallback) {
      return { success: false, error: `Provider "${provider}" does not support callbacks` }
    }
    return authProvider.validateCallback(data, this.createProviderService(provider))
  }

  // --- AuthIdentity CRUD ---

  async createAuthIdentity(data: { app_metadata?: Record<string, unknown> }): Promise<AuthIdentityDTO> {
    const [created] = (await this.authIdentityRepo.create([
      {
        app_metadata: data.app_metadata ?? {},
      },
    ])) as AuthIdentityDTO[]
    return created
  }

  async retrieveAuthIdentity(id: string): Promise<AuthIdentityDTO> {
    const results = (await this.authIdentityRepo.find({ where: { id } })) as AuthIdentityDTO[]
    if (results.length === 0) throw new MantaError('NOT_FOUND', `AuthIdentity "${id}" not found`)
    // Load provider identities
    const providerIdentities = (await this.providerIdentityRepo.find({
      where: { auth_identity_id: id },
    })) as ProviderIdentityDTO[]
    return { ...results[0], provider_identities: providerIdentities }
  }

  async updateAuthIdentity(
    id: string,
    data: {
      app_metadata?: Record<string, unknown>
    },
  ): Promise<AuthIdentityDTO> {
    const [updated] = (await this.authIdentityRepo.update([{ id, ...data }])) as AuthIdentityDTO[]
    return updated
  }

  // --- JWT ---

  async generateToken(
    payload: {
      id: string
      type: string
      auth_identity_id: string
      app_metadata?: Record<string, unknown>
    },
    secret: string,
    expiresIn = '7d',
  ): Promise<string> {
    // Simple JWT: header.payload.signature
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
    const now = Math.floor(Date.now() / 1000)
    const exp = now + parseExpiry(expiresIn)
    const body = Buffer.from(
      JSON.stringify({
        ...payload,
        iat: now,
        exp,
      }),
    ).toString('base64url')

    const { createHmac } = await import('node:crypto')
    const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')

    return `${header}.${body}.${signature}`
  }

  async verifyToken(token: string, secret: string): Promise<Record<string, unknown>> {
    const parts = token.split('.')
    if (parts.length !== 3) throw new MantaError('UNAUTHORIZED', 'Invalid token format')

    const [header, body, signature] = parts

    // Verify signature
    const { createHmac, timingSafeEqual } = await import('node:crypto')
    const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')

    const sigBuffer = Buffer.from(signature, 'base64url')
    const expectedBuffer = Buffer.from(expected, 'base64url')
    if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
      throw new MantaError('UNAUTHORIZED', 'Invalid token signature')
    }

    // Decode payload
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString())

    // Check expiry
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      throw new MantaError('UNAUTHORIZED', 'Token expired')
    }

    return payload
  }

  // --- Session management via ICachePort ---

  async createSession(
    authContext: AuthContext,
    options?: SessionOptions,
  ): Promise<{ sessionId: string; expiresAt: Date }> {
    if (!this.cache) throw new MantaError('INVALID_STATE', 'Cache not configured for sessions')
    const sessionId = crypto.randomUUID()
    const ttl = options?.ttl ?? 86400
    const expiresAt = new Date(Date.now() + ttl * 1000)
    await this.cache.set(`session:${sessionId}`, authContext, ttl)
    return { sessionId, expiresAt }
  }

  async verifySession(sessionId: string): Promise<AuthContext | null> {
    if (!this.cache) return null
    const data = await this.cache.get(`session:${sessionId}`)
    return (data as AuthContext) ?? null
  }

  async destroySession(sessionId: string): Promise<void> {
    if (!this.cache) return
    await this.cache.invalidate(`session:${sessionId}`)
  }

  // --- Internal: create provider service for delegation ---

  private createProviderService(_provider: string): IAuthIdentityProviderService {
    const self = this
    return {
      async create(data) {
        // Create AuthIdentity + ProviderIdentity
        const authIdentity = await self.createAuthIdentity({})
        await self.providerIdentityRepo.create([
          {
            entity_id: data.entity_id,
            provider: data.provider,
            auth_identity_id: authIdentity.id,
            user_metadata: data.user_metadata ?? {},
            provider_metadata: data.provider_metadata ?? {},
          },
        ])
        return authIdentity as { id: string; app_metadata?: Record<string, unknown> }
      },

      async update(entity_id, provider, data) {
        const existing = await this.retrieve(entity_id, provider)
        if (!existing) throw new MantaError('NOT_FOUND', `ProviderIdentity not found`)
        await self.providerIdentityRepo.update([
          {
            id: existing.id,
            ...data,
          },
        ])
        return existing.auth_identity as { id: string; app_metadata?: Record<string, unknown> }
      },

      async retrieve(entity_id, provider) {
        const results = (await self.providerIdentityRepo.find({
          where: { entity_id, provider },
        })) as ProviderIdentityDTO[]
        if (results.length === 0) return null
        const pi = results[0]
        const ai = (await self.authIdentityRepo.find({ where: { id: pi.auth_identity_id } })) as AuthIdentityDTO[]
        const identity = ai[0] ?? { id: pi.auth_identity_id }
        return {
          id: pi.id,
          provider_metadata: pi.provider_metadata as Record<string, unknown> | undefined,
          auth_identity: {
            id: identity.id,
            app_metadata: (identity as unknown as Record<string, unknown>).app_metadata as
              | Record<string, unknown>
              | undefined,
          },
        }
      },

      async setState(key, value) {
        if (self.cache) {
          await self.cache.set(`auth_state:${key}`, value, 600) // 10 min TTL
        }
      },

      async getState(key) {
        if (!self.cache) return null
        const data = await self.cache.get(`auth_state:${key}`)
        if (data) await self.cache.invalidate(`auth_state:${key}`) // one-time use
        return data as Record<string, unknown> | null
      },
    }
  }
}

function parseExpiry(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/)
  if (!match) return 3600 // default 1h
  const [, num, unit] = match
  const n = Number.parseInt(num, 10)
  switch (unit) {
    case 's':
      return n
    case 'm':
      return n * 60
    case 'h':
      return n * 3600
    case 'd':
      return n * 86400
    default:
      return 3600
  }
}
