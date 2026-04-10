// Emailpass auth provider — ISO Medusa's @medusajs/auth-emailpass
// Handles email/password registration and authentication.

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { AuthenticationInput, AuthenticationResponse, IAuthIdentityProviderService, IAuthProvider } from './types'

/**
 * Hash a password using scrypt (no bcrypt dependency needed).
 * Format: salt:hash (both hex-encoded).
 */
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

/**
 * Compare a password against a stored hash.
 */
async function comparePassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, hash] = storedHash.split(':')
  if (!salt || !hash) return false
  const derived = scryptSync(password, salt, 64).toString('hex')
  // Timing-safe comparison
  const hashBuffer = Buffer.from(hash, 'hex')
  const derivedBuffer = Buffer.from(derived, 'hex')
  if (hashBuffer.length !== derivedBuffer.length) return false
  return timingSafeEqual(hashBuffer, derivedBuffer)
}

export class EmailpassAuthProvider implements IAuthProvider {
  async register(
    data: AuthenticationInput,
    authIdentityService: IAuthIdentityProviderService,
  ): Promise<AuthenticationResponse> {
    const { email, password } = data.body as { email?: string; password?: string }

    if (!email || !password) {
      return { success: false, error: 'Email and password are required' }
    }

    // Check if already registered
    const existing = await authIdentityService.retrieve(email, 'emailpass')
    if (existing) {
      return { success: false, error: 'Identity already exists for this email' }
    }

    // Hash password
    const hashedPassword = await hashPassword(password)

    // Create auth identity + provider identity
    const authIdentity = await authIdentityService.create({
      entity_id: email,
      provider: 'emailpass',
      provider_metadata: { password: hashedPassword },
      user_metadata: { email },
    })

    return { success: true, authIdentity }
  }

  async authenticate(
    data: AuthenticationInput,
    authIdentityService: IAuthIdentityProviderService,
  ): Promise<AuthenticationResponse> {
    const { email, password } = data.body as { email?: string; password?: string }

    if (!email || !password) {
      return { success: false, error: 'Email and password are required' }
    }

    // Find provider identity
    const providerIdentity = await authIdentityService.retrieve(email, 'emailpass')
    if (!providerIdentity) {
      return { success: false, error: 'Invalid email or password' }
    }

    // Compare password
    const storedHash = (providerIdentity.provider_metadata as Record<string, string>)?.password
    if (!storedHash) {
      return { success: false, error: 'Invalid email or password' }
    }

    const isValid = await comparePassword(password, storedHash)
    if (!isValid) {
      return { success: false, error: 'Invalid email or password' }
    }

    return {
      success: true,
      authIdentity: providerIdentity.auth_identity,
    }
  }
}
