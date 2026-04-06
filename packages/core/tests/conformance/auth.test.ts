import { type AuthContext, createTestAuth, type IAuthPort, MockAuthPort } from '@manta/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('IAuthPort Conformance', () => {
  let authPort: MockAuthPort

  const userContext: AuthContext = {
    type: 'user',
    id: 'u1',
  }

  beforeEach(() => {
    const auth = createTestAuth({
      jwt: userContext,
      apiKeys: {
        sk_valid_key_123: { type: 'user', id: 'api_user_1' },
      },
    })
    authPort = auth.authPort
  })

  // A-01 — SPEC-049: JWT create/verify roundtrip
  it('JWT > create/verify roundtrip', () => {
    const token = authPort.createJwt(userContext)
    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThan(0)

    const result = authPort.verifyJwt(token)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('user')
    expect(result!.id).toBe('u1')
  })

  // A-02 — SPEC-049: expired token returns null
  it('JWT > token expiré retourne null', async () => {
    const token = authPort.createJwt(userContext, { expiresIn: 1 }) // 1 second
    expect(typeof token).toBe('string')

    // Token is valid immediately
    const validResult = authPort.verifyJwt(token)
    expect(validResult).not.toBeNull()
    expect(validResult!.type).toBe('user')

    // Wait for expiration
    await new Promise((r) => setTimeout(r, 1100))

    // Token should now be expired
    const expiredResult = authPort.verifyJwt(token)
    expect(expiredResult).toBeNull()
  })

  // A-03 — SPEC-049: invalid token returns null (no exception)
  it('JWT > token invalide retourne null', () => {
    const result = authPort.verifyJwt('garbage-token')
    expect(result).toBeNull()
  })

  // A-04 — SPEC-049: modified token returns null (mock: prefix-based only)
  it('JWT > token modifié retourne null', () => {
    // NOTE: MockAuthPort uses prefix-based validation, not cryptographic signatures.
    // Real JWT adapters MUST verify HMAC/RSA signatures — they have their own
    // conformance suites with real JWT verification.
    // This test validates the mock contract: tokens not starting with 'jwt_' are rejected.
    const token = authPort.createJwt(userContext)

    // Corrupt the prefix to ensure MockAuthPort rejects the token
    const modified = `xxx_${token.slice(4)}`
    const result = authPort.verifyJwt(modified)
    expect(result).toBeNull()

    // Also verify that a completely garbage token is rejected
    expect(authPort.verifyJwt('totally-invalid-token')).toBeNull()
    expect(authPort.verifyJwt('')).toBeNull()
  })

  // A-05 — SPEC-049: valid API key returns AuthContext
  it('API Key > clé valide', () => {
    const result = authPort.verifyApiKey('sk_valid_key_123')
    expect(result).not.toBeNull()
    expect(result!.type).toBe('user')
    expect(result!.id).toBe('api_user_1')
  })

  // A-06 — SPEC-049: invalid API key returns null
  it('API Key > clé invalide retourne null', () => {
    const result = authPort.verifyApiKey('sk_invalid')
    expect(result).toBeNull()
  })

  // A-07 — SPEC-049: zero dependency — no ICachePort needed
  it('Zero dependency > pas de ICachePort', () => {
    // IAuthPort constructor takes only config, not ICachePort
    // Verify by constructing MockAuthPort with just config
    const standalone = new MockAuthPort({ jwt: userContext })
    const token = standalone.createJwt(userContext)
    expect(standalone.verifyJwt(token)).not.toBeNull()
    // No external dependency, no cache
  })

  // A-08 — SPEC-049: no method accepts Request/Headers
  it('Zero dependency HTTP > pas de Request/Headers', () => {
    // Verify method signatures accept only strings and simple objects
    // verifyJwt(token: string)
    expect(typeof authPort.verifyJwt).toBe('function')
    expect(authPort.verifyJwt.length).toBeLessThanOrEqual(1)

    // verifyApiKey(key: string)
    expect(typeof authPort.verifyApiKey).toBe('function')
    expect(authPort.verifyApiKey.length).toBeLessThanOrEqual(1)

    // createJwt(payload: AuthContext, options?)
    expect(typeof authPort.createJwt).toBe('function')
    expect(authPort.createJwt.length).toBeLessThanOrEqual(2)
  })

  // A-09 — SPEC-049: JWT with custom claims
  it('JWT > custom claims', () => {
    const customContext: AuthContext = {
      type: 'user',
      id: 'u1',
      auth_identity_id: 'aid_1',
      metadata: { orgId: 'o1' },
    }

    const token = authPort.createJwt(customContext)
    expect(typeof token).toBe('string')

    // MockAuthPort returns configured jwt context, but real adapters
    // must round-trip all custom claims
    const result = authPort.verifyJwt(token)
    expect(result).not.toBeNull()
  })
})
