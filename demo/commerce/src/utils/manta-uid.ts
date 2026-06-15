// Manta-issued contact identification token. Opaque, no Klaviyo dependency.
//
// Wire format:  v2.<iv>.<ciphertext>.<auth_tag>
// Payload:      { e: <lowercased email>, i: <issued_at_unix_seconds>, v: 1 }
// Secret:       process.env.MANTA_UID_SECRET
// TTL:          90 days, enforced at verify.
//
// The token is opaque to clients but symmetric on the server —
// any Manta runtime knowing MANTA_UID_SECRET can both sign and verify it.
// Used to identify a returning visitor across devices/sessions without
// piggy-backing on Klaviyo's $exchange_id.

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const TOKEN_VERSION = 1
const TTL_SECONDS = 90 * 24 * 60 * 60

interface TokenPayload {
  e: string
  i: number
  v: number
}

function getSecret(): string {
  const secret = process.env.MANTA_UID_SECRET
  if (!secret || secret.length === 0) {
    if (process.env.NODE_ENV === 'test') return 'test-secret-do-not-use-in-prod'
    throw new MantaError(
      'INVALID_STATE',
      'MANTA_UID_SECRET is not set. Generate one with: openssl rand -hex 32 and add it to .env.local',
    )
  }
  return secret
}

function encryptionKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest()
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(str: string): Buffer | null {
  // Reject anything that isn't strict base64url (no padding, no '+' or '/').
  if (!/^[A-Za-z0-9_-]+$/.test(str)) return null
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4))
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad
  try {
    return Buffer.from(b64, 'base64')
  } catch {
    return null
  }
}

function sign(body: string, secret: string): string {
  const mac = createHmac('sha256', secret).update(body).digest()
  return base64UrlEncode(mac)
}

export function signContactToken(email: string, opts?: { now?: number }): string {
  const secret = getSecret()
  const issuedAt = Math.floor((opts?.now ?? Date.now()) / 1000)
  const payload: TokenPayload = {
    e: email.trim().toLowerCase(),
    i: issuedAt,
    v: TOKEN_VERSION,
  }
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v2.${base64UrlEncode(iv)}.${base64UrlEncode(ciphertext)}.${base64UrlEncode(tag)}`
}

export function stableMuidForEmail(email: string): string {
  const normalized = email.trim().toLowerCase()
  const digest = createHmac('sha256', getSecret()).update(`muid:${normalized}`).digest('hex')
  return `muid_${digest.slice(0, 32)}`
}

export function verifyContactToken(token: string, opts?: { now?: number }): { email: string } | null {
  if (typeof token !== 'string' || token.length === 0) return null
  const parts = token.split('.')
  if (parts.length === 4 && parts[0] === 'v2') return verifyV2Token(parts, opts)
  return verifyLegacyToken(parts, opts)
}

function verifyV2Token(parts: string[], opts?: { now?: number }): { email: string } | null {
  const [, ivRaw, ciphertextRaw, tagRaw] = parts
  if (!ivRaw || !ciphertextRaw || !tagRaw) return null
  const iv = base64UrlDecode(ivRaw)
  const ciphertext = base64UrlDecode(ciphertextRaw)
  const tag = base64UrlDecode(tagRaw)
  if (!iv || !ciphertext || !tag) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(getSecret()), iv)
    decipher.setAuthTag(tag)
    const decoded = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    return validatePayload(JSON.parse(decoded) as TokenPayload, opts)
  } catch {
    return null
  }
}

function verifyLegacyToken(parts: string[], opts?: { now?: number }): { email: string } | null {
  if (parts.length !== 2) return null
  const [body, sig] = parts
  if (!body || !sig) return null

  const secret = getSecret()
  const expectedSig = sign(body, secret)
  const sigBuf = Buffer.from(sig, 'utf8')
  const expectedBuf = Buffer.from(expectedSig, 'utf8')
  if (sigBuf.length !== expectedBuf.length) return null
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null

  const decoded = base64UrlDecode(body)
  if (!decoded) return null
  let payload: TokenPayload
  try {
    payload = JSON.parse(decoded.toString('utf8')) as TokenPayload
  } catch {
    return null
  }
  return validatePayload(payload, opts)
}

function validatePayload(payload: TokenPayload, opts?: { now?: number }): { email: string } | null {
  if (!payload || typeof payload !== 'object') return null
  if (payload.v !== TOKEN_VERSION) return null
  if (typeof payload.e !== 'string' || payload.e.length === 0) return null
  if (typeof payload.i !== 'number' || !Number.isFinite(payload.i)) return null

  const nowSec = Math.floor((opts?.now ?? Date.now()) / 1000)
  if (nowSec - payload.i > TTL_SECONDS) return null
  // Reject negative skews larger than 60s (clock weirdness).
  if (payload.i - nowSec > 60) return null

  return { email: payload.e }
}
