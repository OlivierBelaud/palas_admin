// Manta-issued contact identification token. HMAC-SHA256, no Klaviyo dependency.
//
// Wire format:  base64url(JSON(payload)) + '.' + base64url(hmac)
// Payload:      { e: <lowercased email>, i: <issued_at_unix_seconds>, v: 1 }
// Secret:       process.env.MANTA_UID_SECRET (≥ 32 hex chars in production)
// TTL:          90 days, enforced at verify.
//
// The token is intentionally opaque to clients but symmetric on the server —
// any Manta runtime knowing MANTA_UID_SECRET can both sign and verify it.
// Used to identify a returning visitor across devices/sessions without
// piggy-backing on Klaviyo's $exchange_id.

import { createHmac, timingSafeEqual } from 'node:crypto'

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
  const body = base64UrlEncode(Buffer.from(JSON.stringify(payload), 'utf8'))
  const sig = sign(body, secret)
  return `${body}.${sig}`
}

export function verifyContactToken(token: string, opts?: { now?: number }): { email: string } | null {
  if (typeof token !== 'string' || token.length === 0) return null
  const parts = token.split('.')
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
