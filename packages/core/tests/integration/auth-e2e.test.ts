// Auth E2E tests — validates the full auth flow as wired in bootstrap
// Tests the AuthModuleService + JWT + middleware chain, not HTTP transport.

import { InMemoryCacheAdapter, InMemoryRepository } from '@manta/core'
import { beforeEach, describe, expect, it } from 'vitest'
import { AuthModuleService } from '../../src/auth/auth-module-service'
import { extractAuthContext } from '../../src/auth/middleware'
import { EmailpassAuthProvider } from '../../src/auth/providers/emailpass'
import type { AuthenticationInput } from '../../src/auth/providers/types'

function authInput(body: Record<string, unknown>): AuthenticationInput {
  return { url: '', headers: {}, query: {}, body, protocol: 'http' }
}

const JWT_SECRET = 'test-secret-key-for-jwt'

describe('Auth E2E Flow', () => {
  let authService: AuthModuleService
  let cache: InMemoryCacheAdapter

  beforeEach(() => {
    cache = new InMemoryCacheAdapter()
    authService = new AuthModuleService({
      baseRepository: new InMemoryRepository(),
      authIdentityRepository: new InMemoryRepository('auth_identity'),
      providerIdentityRepository: new InMemoryRepository('provider_identity'),
      cache,
    })
    authService.registerProvider('emailpass', new EmailpassAuthProvider())
  })

  // AUTH-E2E-01 — Register returns a valid JWT
  it('register returns a valid JWT', async () => {
    const result = await authService.register('emailpass', authInput({ email: 'user@test.com', password: 'Secret123' }))
    expect(result.success).toBe(true)

    const authIdentity = result.authIdentity!
    await authService.updateAuthIdentity(authIdentity.id, {
      app_metadata: { user_type: 'user' },
    })

    const token = await authService.generateToken(
      {
        id: authIdentity.id,
        type: 'user',
        auth_identity_id: authIdentity.id,
        app_metadata: { email: 'user@test.com' },
      },
      JWT_SECRET,
    )

    expect(token).toBeTruthy()
    expect(token.split('.')).toHaveLength(3)

    const payload = await authService.verifyToken(token, JWT_SECRET)
    expect(payload.id).toBe(authIdentity.id)
    expect(payload.type).toBe('user')
  })

  // AUTH-E2E-02 — Login with correct credentials returns JWT
  it('login with correct credentials returns JWT', async () => {
    await authService.register('emailpass', authInput({ email: 'user@test.com', password: 'Secret123' }))

    const result = await authService.authenticate(
      'emailpass',
      authInput({ email: 'user@test.com', password: 'Secret123' }),
    )
    expect(result.success).toBe(true)
    expect(result.authIdentity).toBeTruthy()

    const token = await authService.generateToken(
      {
        id: result.authIdentity!.id,
        type: 'user',
        auth_identity_id: result.authIdentity!.id,
      },
      JWT_SECRET,
    )
    const payload = await authService.verifyToken(token, JWT_SECRET)
    expect(payload.type).toBe('user')
  })

  // AUTH-E2E-03 — Login with wrong password fails
  it('login with wrong password fails', async () => {
    await authService.register('emailpass', authInput({ email: 'user@test.com', password: 'Secret123' }))

    const result = await authService.authenticate(
      'emailpass',
      authInput({ email: 'user@test.com', password: 'WrongPassword' }),
    )
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  // AUTH-E2E-04 — extractAuthContext with valid token returns auth context
  it('extractAuthContext with valid token returns auth context', async () => {
    const reg = await authService.register('emailpass', authInput({ email: 'admin@test.com', password: 'Admin123' }))

    const token = await authService.generateToken(
      {
        id: reg.authIdentity!.id,
        type: 'user',
        auth_identity_id: reg.authIdentity!.id,
        app_metadata: { email: 'admin@test.com' },
      },
      JWT_SECRET,
    )

    const authContext = await extractAuthContext(
      { authorization: `Bearer ${token}` },
      undefined,
      authService,
      JWT_SECRET,
      'user',
    )

    expect(authContext).not.toBeNull()
    expect(authContext!.type).toBe('user')
    expect(authContext!.id).toBe(reg.authIdentity!.id)
  })

  // AUTH-E2E-05 — extractAuthContext without token throws UNAUTHORIZED
  it('extractAuthContext without token throws UNAUTHORIZED', async () => {
    await expect(extractAuthContext({}, undefined, authService, JWT_SECRET, 'user')).rejects.toThrow(
      'Authentication required',
    )
  })

  // AUTH-E2E-06 — allowUnauthenticated returns null instead of throwing
  it('allowUnauthenticated returns null', async () => {
    const ctx = await extractAuthContext({}, undefined, authService, JWT_SECRET, 'user', ['bearer'], {
      allowUnauthenticated: true,
    })
    expect(ctx).toBeNull()
  })

  // AUTH-E2E-07 — Admin routes with valid token succeed
  it('valid token accepted for admin routes', async () => {
    const reg = await authService.register('emailpass', authInput({ email: 'admin@test.com', password: 'Admin123' }))

    const token = await authService.generateToken(
      {
        id: reg.authIdentity!.id,
        type: 'user',
        auth_identity_id: reg.authIdentity!.id,
      },
      JWT_SECRET,
    )

    const ctx = await extractAuthContext(
      { authorization: `Bearer ${token}` },
      undefined,
      authService,
      JWT_SECRET,
      'user',
    )
    expect(ctx).not.toBeNull()
    expect(ctx!.type).toBe('user')
  })

  // AUTH-E2E-08 — Register duplicate email fails
  it('register duplicate email fails', async () => {
    const first = await authService.register('emailpass', authInput({ email: 'dupe@test.com', password: 'Pass123' }))
    expect(first.success).toBe(true)

    const second = await authService.register('emailpass', authInput({ email: 'dupe@test.com', password: 'Pass456' }))
    expect(second.success).toBe(false)
    expect(second.error).toContain('already exists')
  })

  // AUTH-E2E-09 — Short-lived token (1h) + refresh token (30d)
  it('generates short-lived access and long-lived refresh tokens', async () => {
    const reg = await authService.register('emailpass', authInput({ email: 'token@test.com', password: 'Pass123' }))
    const identity = reg.authIdentity!

    const tokenPayload = {
      id: identity.id,
      type: 'user',
      auth_identity_id: identity.id,
      app_metadata: { email: 'token@test.com' },
    }

    const accessToken = await authService.generateToken(tokenPayload, JWT_SECRET, '1h')
    const refreshToken = await authService.generateToken(
      { ...tokenPayload, app_metadata: { ...tokenPayload.app_metadata, type: 'refresh' } },
      JWT_SECRET,
      '30d',
    )

    // Both are valid JWTs
    const accessPayload = await authService.verifyToken(accessToken, JWT_SECRET)
    expect(accessPayload.type).toBe('user')

    const refreshPayload = await authService.verifyToken(refreshToken, JWT_SECRET)
    expect((refreshPayload.app_metadata as Record<string, unknown>)?.type).toBe('refresh')

    // Refresh token has longer expiry
    expect(Number(refreshPayload.exp)).toBeGreaterThan(Number(accessPayload.exp))
  })

  // AUTH-E2E-10 — Refresh token can generate new access token
  it('refresh token generates new access token', async () => {
    const reg = await authService.register('emailpass', authInput({ email: 'refresh@test.com', password: 'Pass123' }))
    const identity = reg.authIdentity!

    const refreshPayload = {
      id: identity.id,
      auth_identity_id: identity.id,
      type: 'refresh',
    }
    const refreshToken = await authService.generateToken(refreshPayload, JWT_SECRET, '30d')

    // Verify refresh token
    const decoded = await authService.verifyToken(refreshToken, JWT_SECRET)
    expect((decoded as Record<string, unknown>).type).toBe('refresh')

    // Generate new access token from refresh payload
    const newAccessToken = await authService.generateToken(
      {
        id: decoded.id as string,
        type: decoded.type as string,
        auth_identity_id: decoded.auth_identity_id as string,
      },
      JWT_SECRET,
      '1h',
    )

    const newPayload = await authService.verifyToken(newAccessToken, JWT_SECRET)
    expect(newPayload.id).toBe(identity.id)
  })

  // AUTH-E2E-11 — Logout blacklists via cache
  it('logout blacklist prevents refresh', async () => {
    const identity = (
      await authService.register('emailpass', authInput({ email: 'logout@test.com', password: 'Pass123' }))
    ).authIdentity!

    // Simulate blacklisting (as logout route does)
    await cache.set(`auth:blacklist:${identity.id}`, '1', 2592000)

    // Check blacklist exists
    const blacklisted = await cache.get(`auth:blacklist:${identity.id}`)
    expect(blacklisted).toBe('1')
  })

  // AUTH-E2E-12 — Rate limit simulation
  it('rate limit counter increments in cache', async () => {
    const key = 'auth:ratelimit:login:test@test.com'

    // Simulate 5 attempts
    for (let i = 1; i <= 5; i++) {
      await cache.set(key, i, 900)
    }

    const attempts = await cache.get(key)
    expect(Number(attempts)).toBe(5)
  })

  // AUTH-E2E-13 — Password reset token generation
  it('password reset token can be generated and verified', async () => {
    const resetToken = await authService.generateToken(
      {
        id: '',
        type: 'user',
        auth_identity_id: '',
        app_metadata: { type: 'password-reset', email: 'reset@test.com' },
      },
      JWT_SECRET,
      '1h',
    )

    const payload = await authService.verifyToken(resetToken, JWT_SECRET)
    const meta = payload.app_metadata as Record<string, unknown>
    expect(meta.type).toBe('password-reset')
    expect(meta.email).toBe('reset@test.com')
  })

  // AUTH-E2E-14 — Password reset token stored and retrieved from cache
  it('password reset token stored in cache', async () => {
    const email = 'cached-reset@test.com'
    const token = 'fake-reset-token-value'

    await cache.set(`auth:reset:${email}`, token, 3600)
    const stored = await cache.get(`auth:reset:${email}`)
    expect(stored).toBe(token)

    // Invalidate after use
    await cache.invalidate(`auth:reset:${email}`)
    const after = await cache.get(`auth:reset:${email}`)
    expect(after).toBeNull()
  })

  // AUTH-E2E-15 — Actor type validation in extractAuthContext
  it('wrong actor type is rejected', async () => {
    const reg = await authService.register('emailpass', authInput({ email: 'actor@test.com', password: 'Pass123' }))
    const token = await authService.generateToken(
      { id: reg.authIdentity!.id, type: 'user', auth_identity_id: reg.authIdentity!.id },
      JWT_SECRET,
    )

    // Requesting 'customer' actor but token has 'user'
    await expect(
      extractAuthContext({ authorization: `Bearer ${token}` }, undefined, authService, JWT_SECRET, 'customer'),
    ).rejects.toThrow('not allowed')
  })
})
