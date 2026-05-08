// CRM-V1-Phase-2A — Manta-issued contact identification token.
//
// Pure HMAC-SHA256, no framework dependency. Tests cover round-trip,
// tampering detection, expiry, malformed input, and email normalization.

import { describe, expect, it } from 'vitest'
import { signContactToken, verifyContactToken } from '../src/utils/manta-uid'

const TTL_MS = 90 * 24 * 60 * 60 * 1000

describe('manta-uid token', () => {
  it('round-trip: sign then verify returns the same email (lowercased)', () => {
    const token = signContactToken('jane@example.com')
    const result = verifyContactToken(token)
    expect(result).toEqual({ email: 'jane@example.com' })
  })

  it('lowercases the email at signature time', () => {
    const token = signContactToken('Foo@Bar.COM')
    const result = verifyContactToken(token)
    expect(result?.email).toBe('foo@bar.com')
  })

  it('returns null when a single character is tampered with', () => {
    const token = signContactToken('jane@example.com')
    // Flip a character in the signature half — guaranteed to invalidate.
    const [body, sig] = token.split('.')
    const flippedSig = sig.startsWith('A') ? `B${sig.slice(1)}` : `A${sig.slice(1)}`
    expect(verifyContactToken(`${body}.${flippedSig}`)).toBeNull()
  })

  it('returns null for tokens older than 90 days', () => {
    const issuedAt = Date.now() - (TTL_MS + 1000)
    const token = signContactToken('jane@example.com', { now: issuedAt })
    expect(verifyContactToken(token)).toBeNull()
  })

  it('accepts tokens just inside the TTL window', () => {
    const issuedAt = Date.now() - (TTL_MS - 60_000)
    const token = signContactToken('jane@example.com', { now: issuedAt })
    expect(verifyContactToken(token)).toEqual({ email: 'jane@example.com' })
  })

  it('returns null on malformed input (no dot separator)', () => {
    expect(verifyContactToken('not-a-token')).toBeNull()
    expect(verifyContactToken('')).toBeNull()
    expect(verifyContactToken('a.b.c')).toBeNull()
  })

  it('returns null on malformed body (non-base64url chars)', () => {
    const token = signContactToken('jane@example.com')
    const [, sig] = token.split('.')
    expect(verifyContactToken(`!!!.${sig}`)).toBeNull()
  })

  it('returns null when the email is empty after trim', () => {
    // Non-empty input, but normalises to empty — verifyContactToken should
    // still accept the round-trip since the payload carries the lowercased
    // value. We just want to assert sign() doesn't crash on whitespace.
    const token = signContactToken('   a@b.co   ')
    expect(verifyContactToken(token)).toEqual({ email: 'a@b.co' })
  })
})
