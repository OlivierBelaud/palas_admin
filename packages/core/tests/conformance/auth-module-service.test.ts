import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  type IAuthModuleService,
  type AuthContext,
  createTestAuth,
  MockAuthModuleService,
} from '@manta/test-utils'

describe('IAuthModuleService Session Conformance', () => {
  let authModuleService: MockAuthModuleService

  const userContext: AuthContext = {
    actor_type: 'user',
    actor_id: 'u1',
  }

  beforeEach(() => {
    const auth = createTestAuth()
    authModuleService = auth.authModuleService
  })

  afterEach(() => {
    authModuleService._reset()
  })

  // AS-01 — SPEC-050: createSession/verifySession roundtrip
  it('Session > createSession roundtrip', async () => {
    const { sessionId, expiresAt } = await authModuleService.createSession(userContext)

    // sessionId is a string (UUID)
    expect(typeof sessionId).toBe('string')
    expect(sessionId.length).toBeGreaterThan(0)

    // expiresAt is a Date in the future
    expect(expiresAt).toBeInstanceOf(Date)
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now())

    // verifySession returns original AuthContext
    const result = await authModuleService.verifySession(sessionId)
    expect(result).not.toBeNull()
    expect(result!.actor_type).toBe('user')
    expect(result!.actor_id).toBe('u1')
  })

  // AS-02 — SPEC-050: destroySession removes session
  it('Session > destroySession', async () => {
    const { sessionId } = await authModuleService.createSession(userContext)

    // Session exists
    expect(await authModuleService.verifySession(sessionId)).not.toBeNull()

    // Destroy it
    await authModuleService.destroySession(sessionId)

    // Session no longer exists
    expect(await authModuleService.verifySession(sessionId)).toBeNull()
  })

  // AS-03 — SPEC-050: session TTL expiration
  it('Session > TTL expiration', async () => {
    vi.useFakeTimers()

    const { sessionId } = await authModuleService.createSession(userContext, { ttl: 1 })

    // Session exists immediately
    expect(await authModuleService.verifySession(sessionId)).not.toBeNull()

    // Advance past TTL
    vi.advanceTimersByTime(1500)

    // Session expired
    expect(await authModuleService.verifySession(sessionId)).toBeNull()

    vi.useRealTimers()
  })

  // AS-04 — SPEC-050: nonexistent session returns null
  it('Session > session inexistante', async () => {
    const result = await authModuleService.verifySession('nonexistent-id')
    expect(result).toBeNull()
  })

  // AS-05 — SPEC-050: works with InMemoryCacheAdapter (no specific adapter dependency)
  it('Session > ICachePort mock', async () => {
    // MockAuthModuleService uses internal Map (simulating ICachePort)
    // This test verifies the session lifecycle works without a specific cache adapter
    const standalone = new MockAuthModuleService()

    const { sessionId } = await standalone.createSession(userContext)
    const verified = await standalone.verifySession(sessionId)
    expect(verified).not.toBeNull()
    expect(verified!.actor_id).toBe('u1')

    await standalone.destroySession(sessionId)
    expect(await standalone.verifySession(sessionId)).toBeNull()
  })
})
