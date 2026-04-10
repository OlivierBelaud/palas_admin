import {
  type AuthContext,
  createTestAuth,
  MockAuthGateway,
  type MockAuthModuleService,
  type MockAuthPort,
} from '@manta/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('IAuthGateway Conformance', () => {
  let gateway: MockAuthGateway
  let authPort: MockAuthPort
  let authModuleService: MockAuthModuleService

  const userContext: AuthContext = {
    type: 'user',
    id: 'u1',
  }

  const apiKeyContext: AuthContext = {
    type: 'user',
    id: 'api_user_1',
  }

  let validSessionId: string

  beforeEach(async () => {
    const auth = createTestAuth({
      jwt: userContext,
      apiKeys: {
        sk_valid_123: apiKeyContext,
      },
    })
    authPort = auth.authPort
    authModuleService = auth.authModuleService
    gateway = auth.authGateway

    // Create a valid session for session tests
    const session = await authModuleService.createSession(userContext)
    validSessionId = session.sessionId
  })

  afterEach(() => {
    authModuleService._reset()
  })

  // AG-01 — SPEC-049b: valid Bearer JWT returns AuthContext
  it('Bearer > JWT valide retourne AuthContext', async () => {
    const token = authPort.createJwt(userContext)
    const result = await gateway.authenticate({ bearer: token })

    expect(result).not.toBeNull()
    expect(result!.type).toBe('user')
    expect(result!.id).toBe('u1')
  })

  // AG-02 — SPEC-049b: invalid Bearer (non-sk_) returns null, verifyApiKey NOT called
  it('Bearer > JWT invalide (non-sk_) retourne null', async () => {
    const verifyApiKeySpy = vi.spyOn(authPort, 'verifyApiKey')

    const result = await gateway.authenticate({ bearer: 'garbage' })
    expect(result).toBeNull()

    // verifyApiKey should NOT be called (bearer doesn't start with sk_)
    expect(verifyApiKeySpy).not.toHaveBeenCalled()
  })

  // AG-03 — SPEC-049b: valid API key returns AuthContext
  it('API Key > clé valide retourne AuthContext', async () => {
    const result = await gateway.authenticate({ apiKey: 'sk_valid_123' })

    expect(result).not.toBeNull()
    expect(result!.id).toBe('api_user_1')
  })

  // AG-04 — SPEC-049b: invalid API key returns null
  it('API Key > clé invalide retourne null', async () => {
    const result = await gateway.authenticate({ apiKey: 'sk_invalid' })
    expect(result).toBeNull()
  })

  // AG-05 — SPEC-049b: valid session returns AuthContext
  it('Session > sessionId valide retourne AuthContext', async () => {
    const result = await gateway.authenticate({ sessionId: validSessionId })

    expect(result).not.toBeNull()
    expect(result!.type).toBe('user')
    expect(result!.id).toBe('u1')
  })

  // AG-06 — SPEC-049b: invalid session returns null
  it('Session > sessionId invalide retourne null', async () => {
    const result = await gateway.authenticate({ sessionId: 'nonexistent' })
    expect(result).toBeNull()
  })

  // AG-07 — SPEC-049b: Bearer priority over session and API key
  it('Priority > Bearer prioritaire sur session et API key', async () => {
    const verifySessionSpy = vi.spyOn(authModuleService, 'verifySession')
    const verifyApiKeySpy = vi.spyOn(authPort, 'verifyApiKey')

    const token = authPort.createJwt(userContext)
    const result = await gateway.authenticate({
      bearer: token,
      sessionId: validSessionId,
      apiKey: 'sk_valid_123',
    })

    expect(result).not.toBeNull()
    expect(result!.id).toBe('u1')

    // Neither session nor API key verification should be called
    expect(verifySessionSpy).not.toHaveBeenCalled()
    expect(verifyApiKeySpy).not.toHaveBeenCalled()
  })

  // AG-08 — SPEC-049b: API key priority over session
  it('Priority > API Key prioritaire sur session', async () => {
    const verifySessionSpy = vi.spyOn(authModuleService, 'verifySession')

    const result = await gateway.authenticate({
      apiKey: 'sk_valid_123',
      sessionId: validSessionId,
    })

    expect(result).not.toBeNull()
    expect(result!.id).toBe('api_user_1')

    // Session verification should NOT be called
    expect(verifySessionSpy).not.toHaveBeenCalled()
  })

  // AG-09 — SPEC-049b: no credentials returns null
  it('No credentials > retourne null', async () => {
    const verifyJwtSpy = vi.spyOn(authPort, 'verifyJwt')
    const verifyApiKeySpy = vi.spyOn(authPort, 'verifyApiKey')
    const verifySessionSpy = vi.spyOn(authModuleService, 'verifySession')

    const result = await gateway.authenticate({})
    expect(result).toBeNull()

    // No auth method should be called
    expect(verifyJwtSpy).not.toHaveBeenCalled()
    expect(verifyApiKeySpy).not.toHaveBeenCalled()
    expect(verifySessionSpy).not.toHaveBeenCalled()
  })

  // AG-10 — SPEC-049b: Bearer invalid (non-sk_) + valid session → definitive rejection
  it('Bearer invalid (non-sk_) > rejet définitif avec session valide', async () => {
    const verifySessionSpy = vi.spyOn(authModuleService, 'verifySession')

    const result = await gateway.authenticate({
      bearer: 'invalid',
      sessionId: validSessionId,
    })

    // Bearer present but invalid → null (definitive rejection)
    expect(result).toBeNull()

    // verifySession should NOT be called (bearer blocks fallback)
    expect(verifySessionSpy).not.toHaveBeenCalled()
  })

  // AG-11 — SPEC-049b: constructor takes exactly IAuthPort + IAuthModuleService
  it('Dependencies > constructor prend IAuthPort + IAuthModuleService', () => {
    // Verify we can construct with exactly 2 dependencies
    const gw = new MockAuthGateway(authPort, authModuleService)
    expect(gw).toBeDefined()
    expect(typeof gw.authenticate).toBe('function')
  })

  // AG-12 — SPEC-049b: Bearer sk_ → fallback to verifyApiKey
  it('Bearer sk_ > fallback vers verifyApiKey', async () => {
    const verifyJwtSpy = vi.spyOn(authPort, 'verifyJwt')
    const verifyApiKeySpy = vi.spyOn(authPort, 'verifyApiKey')

    const result = await gateway.authenticate({ bearer: 'sk_valid_123' })

    // verifyJwt called first (returns null for sk_ prefix)
    expect(verifyJwtSpy).toHaveBeenCalledWith('sk_valid_123')

    // Then verifyApiKey called as fallback
    expect(verifyApiKeySpy).toHaveBeenCalledWith('sk_valid_123')

    // Returns AuthContext from API key
    expect(result).not.toBeNull()
    expect(result!.id).toBe('api_user_1')
  })

  // AG-13 — SPEC-049b: Bearer sk_ invalid → both methods fail
  it('Bearer sk_ invalid > fallback échoue', async () => {
    const verifyJwtSpy = vi.spyOn(authPort, 'verifyJwt')
    const verifyApiKeySpy = vi.spyOn(authPort, 'verifyApiKey')

    const result = await gateway.authenticate({ bearer: 'sk_invalid' })

    // Both methods called
    expect(verifyJwtSpy).toHaveBeenCalledWith('sk_invalid')
    expect(verifyApiKeySpy).toHaveBeenCalledWith('sk_invalid')

    // Both return null
    expect(result).toBeNull()
  })

  // AG-14 — SPEC-049b: Bearer sk_ invalid + valid session → definitive rejection
  it('Bearer sk_ invalid + session valide > rejet définitif', async () => {
    const verifySessionSpy = vi.spyOn(authModuleService, 'verifySession')

    const result = await gateway.authenticate({
      bearer: 'sk_invalid',
      sessionId: validSessionId,
    })

    // Bearer present (even sk_ that fails both JWT and API key) → no session fallback
    expect(result).toBeNull()
    expect(verifySessionSpy).not.toHaveBeenCalled()
  })
})
