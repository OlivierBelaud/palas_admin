// Auth + User module tests — full flow coverage

import { InMemoryCacheAdapter, InMemoryRepository } from '@manta/core'
import { beforeEach, describe, expect, it } from 'vitest'
import { AuthModuleService } from '../../src/auth/auth-module-service'
import { extractAuthContext } from '../../src/auth/middleware'
import { EmailpassAuthProvider } from '../../src/auth/providers/emailpass'
import type { AuthenticationInput } from '../../src/auth/providers/types'
import { UserModuleService } from '../../src/user/user-module-service'

const JWT_SECRET = 'test-secret-key-for-jwt'

function createAuthInput(body: Record<string, unknown>): AuthenticationInput {
  return { url: '', headers: {}, query: {}, body, protocol: 'http' }
}

describe('AuthModuleService', () => {
  let authService: AuthModuleService
  let cache: InMemoryCacheAdapter

  beforeEach(() => {
    cache = new InMemoryCacheAdapter()
    authService = new AuthModuleService({
      baseRepository: new InMemoryRepository(),
      authIdentityRepository: new InMemoryRepository(),
      providerIdentityRepository: new InMemoryRepository(),
      cache,
    })
    authService.registerProvider('emailpass', new EmailpassAuthProvider())
  })

  // --- Registration ---

  it('register with emailpass creates auth identity', async () => {
    const result = await authService.register(
      'emailpass',
      createAuthInput({
        email: 'test@example.com',
        password: 'SecureP@ss1',
      }),
    )

    expect(result.success).toBe(true)
    expect(result.authIdentity).toBeDefined()
    expect(result.authIdentity!.id).toBeDefined()
  })

  it('register with existing email fails', async () => {
    await authService.register(
      'emailpass',
      createAuthInput({
        email: 'dupe@example.com',
        password: 'Pass1',
      }),
    )

    const result = await authService.register(
      'emailpass',
      createAuthInput({
        email: 'dupe@example.com',
        password: 'Pass2',
      }),
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('already exists')
  })

  it('register without email fails', async () => {
    const result = await authService.register(
      'emailpass',
      createAuthInput({
        password: 'NoEmail',
      }),
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('required')
  })

  it('register without password fails', async () => {
    const result = await authService.register(
      'emailpass',
      createAuthInput({
        email: 'test@example.com',
      }),
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('required')
  })

  // --- Authentication ---

  it('authenticate with correct credentials succeeds', async () => {
    await authService.register(
      'emailpass',
      createAuthInput({
        email: 'login@example.com',
        password: 'Correct123',
      }),
    )

    const result = await authService.authenticate(
      'emailpass',
      createAuthInput({
        email: 'login@example.com',
        password: 'Correct123',
      }),
    )

    expect(result.success).toBe(true)
    expect(result.authIdentity).toBeDefined()
  })

  it('authenticate with wrong password fails', async () => {
    await authService.register(
      'emailpass',
      createAuthInput({
        email: 'wrong@example.com',
        password: 'Correct123',
      }),
    )

    const result = await authService.authenticate(
      'emailpass',
      createAuthInput({
        email: 'wrong@example.com',
        password: 'Wrong456',
      }),
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid')
  })

  it('authenticate with unknown email fails', async () => {
    const result = await authService.authenticate(
      'emailpass',
      createAuthInput({
        email: 'ghost@example.com',
        password: 'Whatever',
      }),
    )

    expect(result.success).toBe(false)
  })

  it('authenticate with unregistered provider throws', async () => {
    await expect(authService.authenticate('nonexistent', createAuthInput({}))).rejects.toThrow('not registered')
  })

  // --- JWT ---

  it('generateToken creates valid JWT', async () => {
    const token = await authService.generateToken(
      {
        id: 'usr_123',
        type: 'user',
        auth_identity_id: 'ai_456',
      },
      JWT_SECRET,
      '1h',
    )

    expect(token).toBeDefined()
    expect(token.split('.')).toHaveLength(3)
  })

  it('verifyToken decodes valid JWT', async () => {
    const token = await authService.generateToken(
      {
        id: 'usr_123',
        type: 'user',
        auth_identity_id: 'ai_456',
        app_metadata: { user_id: 'usr_123' },
      },
      JWT_SECRET,
    )

    const payload = await authService.verifyToken(token, JWT_SECRET)

    expect(payload.id).toBe('usr_123')
    expect(payload.type).toBe('user')
    expect(payload.auth_identity_id).toBe('ai_456')
  })

  it('verifyToken rejects tampered JWT', async () => {
    const token = await authService.generateToken(
      {
        id: 'usr_123',
        type: 'user',
        auth_identity_id: 'ai_456',
      },
      JWT_SECRET,
    )

    const tampered = `${token.slice(0, -5)}XXXXX`

    await expect(authService.verifyToken(tampered, JWT_SECRET)).rejects.toThrow('Invalid token')
  })

  it('verifyToken rejects wrong secret', async () => {
    const token = await authService.generateToken(
      {
        id: 'usr_123',
        type: 'user',
        auth_identity_id: 'ai_456',
      },
      JWT_SECRET,
    )

    await expect(authService.verifyToken(token, 'wrong-secret')).rejects.toThrow()
  })

  it('verifyToken rejects expired JWT', async () => {
    // Manually create a token with exp in the past
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
    const body = Buffer.from(
      JSON.stringify({
        id: 'usr_123',
        type: 'user',
        auth_identity_id: 'ai_456',
        iat: Math.floor(Date.now() / 1000) - 100,
        exp: Math.floor(Date.now() / 1000) - 50, // expired 50 seconds ago
      }),
    ).toString('base64url')
    const { createHmac } = await import('node:crypto')
    const signature = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url')
    const token = `${header}.${body}.${signature}`

    await expect(authService.verifyToken(token, JWT_SECRET)).rejects.toThrow('expired')
  })

  // --- Sessions ---

  it('session lifecycle: create → verify → destroy', async () => {
    const authContext = { id: 'usr_1', type: 'user' as const, auth_identity_id: 'ai_1' }

    const { sessionId } = await authService.createSession(authContext)
    const retrieved = await authService.verifySession(sessionId)
    expect(retrieved).toEqual(authContext)

    await authService.destroySession(sessionId)
    const destroyed = await authService.verifySession(sessionId)
    expect(destroyed).toBeNull()
  })

  // --- Full flow: register → authenticate → token → verify ---

  it('full flow: register → login → JWT → verify', async () => {
    // 1. Register
    const reg = await authService.register(
      'emailpass',
      createAuthInput({
        email: 'flow@example.com',
        password: 'FlowPass123',
      }),
    )
    expect(reg.success).toBe(true)

    // 2. Authenticate
    const auth = await authService.authenticate(
      'emailpass',
      createAuthInput({
        email: 'flow@example.com',
        password: 'FlowPass123',
      }),
    )
    expect(auth.success).toBe(true)

    // 3. Update auth identity with user_id
    const authId = auth.authIdentity!.id
    await authService.updateAuthIdentity(authId, {
      app_metadata: { user_id: 'usr_flow_1' },
    })

    // 4. Generate JWT
    const token = await authService.generateToken(
      {
        id: 'usr_flow_1',
        type: 'user',
        auth_identity_id: authId,
        app_metadata: { user_id: 'usr_flow_1' },
      },
      JWT_SECRET,
    )

    // 5. Verify JWT
    const payload = await authService.verifyToken(token, JWT_SECRET)
    expect(payload.id).toBe('usr_flow_1')
    expect(payload.type).toBe('user')
  })
})

describe('authenticate middleware', () => {
  let authService: AuthModuleService

  beforeEach(() => {
    authService = new AuthModuleService({
      baseRepository: new InMemoryRepository(),
      authIdentityRepository: new InMemoryRepository(),
      providerIdentityRepository: new InMemoryRepository(),
      cache: new InMemoryCacheAdapter(),
    })
  })

  it('extracts auth context from Bearer token', async () => {
    const token = await authService.generateToken(
      {
        id: 'usr_1',
        type: 'user',
        auth_identity_id: 'ai_1',
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

    expect(ctx).toBeDefined()
    expect(ctx!.id).toBe('usr_1')
    expect(ctx!.type).toBe('user')
  })

  it('extracts auth context from session', async () => {
    const authContext = { id: 'usr_2', type: 'user' as const, auth_identity_id: 'ai_2' }
    const { sessionId } = await authService.createSession(authContext)

    const ctx = await extractAuthContext({}, sessionId, authService, JWT_SECRET, 'user', ['session'])

    expect(ctx).toBeDefined()
    expect(ctx!.id).toBe('usr_2')
  })

  it('rejects unauthenticated request', async () => {
    await expect(extractAuthContext({}, undefined, authService, JWT_SECRET, 'user')).rejects.toThrow(
      'Authentication required',
    )
  })

  it('allows unauthenticated with option', async () => {
    const ctx = await extractAuthContext({}, undefined, authService, JWT_SECRET, 'user', ['bearer'], {
      allowUnauthenticated: true,
    })

    expect(ctx).toBeNull()
  })

  it('rejects wrong actor type', async () => {
    const token = await authService.generateToken(
      {
        id: 'cust_1',
        type: 'customer',
        auth_identity_id: 'ai_1',
      },
      JWT_SECRET,
    )

    await expect(
      extractAuthContext(
        { authorization: `Bearer ${token}` },
        undefined,
        authService,
        JWT_SECRET,
        'user', // expects user, got customer
      ),
    ).rejects.toThrow('not allowed')
  })

  it('accepts any actor type with "*"', async () => {
    const token = await authService.generateToken(
      {
        id: 'cust_1',
        type: 'customer',
        auth_identity_id: 'ai_1',
      },
      JWT_SECRET,
    )

    const ctx = await extractAuthContext({ authorization: `Bearer ${token}` }, undefined, authService, JWT_SECRET, '*')

    expect(ctx).toBeDefined()
    expect(ctx!.type).toBe('customer')
  })
})

describe('UserModuleService', () => {
  let userService: UserModuleService
  let authService: AuthModuleService

  beforeEach(() => {
    authService = new AuthModuleService({
      baseRepository: new InMemoryRepository(),
      authIdentityRepository: new InMemoryRepository(),
      providerIdentityRepository: new InMemoryRepository(),
    })

    userService = new UserModuleService({
      baseRepository: new InMemoryRepository(),
      userRepository: new InMemoryRepository(),
      inviteRepository: new InMemoryRepository(),
      authModuleService: authService,
      jwtSecret: JWT_SECRET,
    })
  })

  it('creates a user', async () => {
    const [user] = await userService.createUsers([
      {
        email: 'admin@example.com',
        first_name: 'Admin',
        last_name: 'User',
      },
    ])

    expect(user.id).toBeDefined()
    expect(user.email).toBe('admin@example.com')
    expect(user.first_name).toBe('Admin')
  })

  it('retrieves a user by id', async () => {
    const [created] = await userService.createUsers([{ email: 'find@example.com' }])
    const found = await userService.retrieveUser(created.id)
    expect(found.email).toBe('find@example.com')
  })

  it('lists users', async () => {
    await userService.createUsers([{ email: 'a@test.com' }, { email: 'b@test.com' }])
    const users = await userService.listUsers()
    expect(users).toHaveLength(2)
  })

  it('updates a user', async () => {
    const [user] = await userService.createUsers([{ email: 'update@test.com' }])
    const [updated] = await userService.updateUsers([{ id: user.id, first_name: 'Updated' }])
    expect(updated.first_name).toBe('Updated')
  })

  it('deletes a user', async () => {
    const [user] = await userService.createUsers([{ email: 'delete@test.com' }])
    await userService.deleteUsers([user.id])
    const users = await userService.listUsers()
    expect(users).toHaveLength(0)
  })

  // --- Invites ---

  it('creates an invite with JWT token', async () => {
    const [invite] = await userService.createInvites([{ email: 'invite@test.com' }])

    expect(invite.id).toBeDefined()
    expect(invite.email).toBe('invite@test.com')
    expect(invite.token).toBeDefined()
    expect(invite.accepted).toBe(false)
    expect(invite.expires_at).toBeDefined()
  })

  it('validates a valid invite token', async () => {
    const [invite] = await userService.createInvites([{ email: 'valid@test.com' }])
    const validated = await userService.validateInviteToken(invite.token)
    expect(validated.email).toBe('valid@test.com')
  })

  it('rejects an invalid invite token', async () => {
    await expect(userService.validateInviteToken('bogus_token')).rejects.toThrow('Invalid invite token')
  })

  it('rejects an already accepted invite', async () => {
    const [invite] = await userService.createInvites([{ email: 'accepted@test.com' }])
    await userService.acceptInvite(invite.id)

    await expect(userService.validateInviteToken(invite.token)).rejects.toThrow('already accepted')
  })

  it('accepts an invite', async () => {
    const [invite] = await userService.createInvites([{ email: 'accept@test.com' }])
    const accepted = await userService.acceptInvite(invite.id)
    expect(accepted.accepted).toBe(true)
  })

  it('refreshes invite tokens', async () => {
    const [invite] = await userService.createInvites([{ email: 'refresh@test.com' }])
    const [refreshed] = await userService.refreshInviteTokens([invite.id])
    expect(refreshed.token).not.toBe(invite.token)
  })

  // --- Full flow: Register → Create User → Link Auth ---

  it('full flow: auth register → create user → link', async () => {
    authService.registerProvider('emailpass', new EmailpassAuthProvider())

    // 1. Register auth identity
    const reg = await authService.register('emailpass', {
      url: '',
      headers: {},
      query: {},
      protocol: 'http',
      body: { email: 'fullflow@test.com', password: 'Pass123!' },
    })
    expect(reg.success).toBe(true)

    // 2. Create user
    const [user] = await userService.createUsers([
      {
        email: 'fullflow@test.com',
        first_name: 'Full',
        last_name: 'Flow',
      },
    ])

    // 3. Link user to auth identity
    await authService.updateAuthIdentity(reg.authIdentity!.id, {
      app_metadata: { user_id: user.id },
    })

    // 4. Generate JWT with id
    const token = await authService.generateToken(
      {
        id: user.id,
        type: 'user',
        auth_identity_id: reg.authIdentity!.id,
        app_metadata: { user_id: user.id },
      },
      JWT_SECRET,
    )

    // 5. Verify — has user_id as id
    const payload = await authService.verifyToken(token, JWT_SECRET)
    expect(payload.id).toBe(user.id)
    expect(payload.type).toBe('user')

    // 6. Retrieve user
    const retrieved = await userService.retrieveUser(user.id)
    expect(retrieved.email).toBe('fullflow@test.com')
  })
})
