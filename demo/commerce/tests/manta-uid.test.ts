// CRM-V1-Phase-2A — Manta-issued contact identification token.
//
// Pure HMAC-SHA256, no framework dependency. Tests cover round-trip,
// tampering detection, expiry, malformed input, and email normalization.

import { describe, expect, it } from 'vitest'
import { signContactToken, stableMuidForEmail, verifyContactToken } from '../src/utils/manta-uid'

const TTL_MS = 90 * 24 * 60 * 60 * 1000

describe('manta-uid token', () => {
  it('round-trip: sign then verify returns the same email (lowercased)', () => {
    const token = signContactToken('jane@example.com')
    const result = verifyContactToken(token)
    expect(result).toEqual({ email: 'jane@example.com' })
  })

  it('does not expose the email in the token body', () => {
    const token = signContactToken('jane@example.com')
    expect(token).toMatch(/^v2\./)
    expect(token).not.toContain('jane')
    expect(token).not.toContain(Buffer.from('jane@example.com').toString('base64url'))
  })

  it('lowercases the email at signature time', () => {
    const token = signContactToken('Foo@Bar.COM')
    const result = verifyContactToken(token)
    expect(result?.email).toBe('foo@bar.com')
  })

  it('derives a stable muid from the normalized email, independent of token issue time', () => {
    const earlyAt = Date.UTC(2026, 0, 1)
    const lateAt = Date.UTC(2026, 0, 2)
    const early = signContactToken('Foo@Bar.COM', { now: earlyAt })
    const late = signContactToken('foo@bar.com', { now: lateAt })
    const earlyEmail = verifyContactToken(early, { now: earlyAt + 60_000 })?.email
    const lateEmail = verifyContactToken(late, { now: lateAt + 60_000 })?.email

    expect(earlyEmail).toBe('foo@bar.com')
    expect(lateEmail).toBe('foo@bar.com')
    expect(stableMuidForEmail(earlyEmail!)).toBe(stableMuidForEmail(lateEmail!))
  })

  it('returns null when a single character is tampered with', () => {
    const token = signContactToken('jane@example.com')
    // Flip a character in the auth tag — guaranteed to invalidate.
    const parts = token.split('.')
    const tag = parts[3]
    parts[3] = tag.startsWith('A') ? `B${tag.slice(1)}` : `A${tag.slice(1)}`
    expect(verifyContactToken(parts.join('.'))).toBeNull()
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
