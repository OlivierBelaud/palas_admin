// Unsubscribe token — HMAC-signed email-only token used in marketing emails.
//
// Wire format:  base64url(JSON(payload)) + '.' + base64url(hmac)
// Payload:      { e: <lowercased email>, v: 1 }   (no `i` — no TTL on purpose)
// Secret:       process.env.UNSUBSCRIBE_SECRET (≥ 32 hex chars in production)
// TTL:          NONE — emails may be opened months later, the unsubscribe
//               link must keep working forever. The token only authenticates
//               the email; any threat from long-lived links is mitigated by
//               the fact that the only side-effect is setting an opt-out flag
//               (no PII leak, no destructive action).
//
// Distinct from `manta-uid.ts` (which carries an issued_at + 90-day TTL for
// returning-visitor tier resolution).

import { createHmac, timingSafeEqual } from 'node:crypto'

const TOKEN_VERSION = 1

interface TokenPayload {
  e: string
  v: number
}

function getSecretForSign(): string {
  const secret = process.env.UNSUBSCRIBE_SECRET
  if (!secret || secret.length === 0) {
    if (process.env.NODE_ENV === 'test') return 'test-unsubscribe-secret-do-not-use'
    throw new MantaError(
      'INVALID_STATE',
      'UNSUBSCRIBE_SECRET is not set. Generate one with: openssl rand -hex 32 and add it to .env.local',
    )
  }
  return secret
}

function getSecretForVerify(): string | null {
  const secret = process.env.UNSUBSCRIBE_SECRET
  if (!secret || secret.length === 0) {
    if (process.env.NODE_ENV === 'test') return 'test-unsubscribe-secret-do-not-use'
    // Public route must not crash on misconfiguration — degrade to "invalid token".
    return null
  }
  return secret
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(str: string): Buffer | null {
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

export function signUnsubscribeToken(email: string): string {
  const secret = getSecretForSign()
  const payload: TokenPayload = {
    e: email.trim().toLowerCase(),
    v: TOKEN_VERSION,
  }
  const body = base64UrlEncode(Buffer.from(JSON.stringify(payload), 'utf8'))
  const sig = sign(body, secret)
  return `${body}.${sig}`
}

export function verifyUnsubscribeToken(token: unknown): { email: string } | null {
  if (typeof token !== 'string' || token.length === 0) return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [body, sig] = parts
  if (!body || !sig) return null

  const secret = getSecretForVerify()
  if (!secret) return null

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
  if (!payload || typeof payload !== 'object') return null
  if (payload.v !== TOKEN_VERSION) return null
  if (typeof payload.e !== 'string' || payload.e.length === 0) return null

  return { email: payload.e }
}
