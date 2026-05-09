// NOTIF-UNSUB-01 — Unsubscribe HMAC token round-trip + tamper resistance.
//
// Pure HMAC-SHA256, no framework dependency. No TTL on this token (emails
// may be opened months later — the unsubscribe link must always work).

import { describe, expect, it } from 'vitest'
import { signUnsubscribeToken, verifyUnsubscribeToken } from '../unsubscribe-token'

describe('unsubscribe token', () => {
  it('round-trip: sign then verify returns the same email (lowercased)', () => {
    const token = signUnsubscribeToken('jane@example.com')
    expect(verifyUnsubscribeToken(token)).toEqual({ email: 'jane@example.com' })
  })

  it('lowercases + trims the email at signature time', () => {
    const token = signUnsubscribeToken('  Foo@Bar.COM  ')
    expect(verifyUnsubscribeToken(token)).toEqual({ email: 'foo@bar.com' })
  })

  it('returns null when the signature is tampered with', () => {
    const token = signUnsubscribeToken('jane@example.com')
    const [body, sig] = token.split('.')
    const flipped = sig.startsWith('A') ? `B${sig.slice(1)}` : `A${sig.slice(1)}`
    expect(verifyUnsubscribeToken(`${body}.${flipped}`)).toBeNull()
  })

  it('returns null on bad format (no dot, multiple dots, empty parts)', () => {
    expect(verifyUnsubscribeToken('not-a-token')).toBeNull()
    expect(verifyUnsubscribeToken('a.b.c')).toBeNull()
    expect(verifyUnsubscribeToken('.')).toBeNull()
    expect(verifyUnsubscribeToken('a.')).toBeNull()
    expect(verifyUnsubscribeToken('.b')).toBeNull()
  })

  it('returns null when payload body is non-base64url', () => {
    const token = signUnsubscribeToken('jane@example.com')
    const [, sig] = token.split('.')
    expect(verifyUnsubscribeToken(`!!!.${sig}`)).toBeNull()
  })

  it('returns null when payload decodes but is not valid JSON', () => {
    // Build a token with a body that is base64url-valid but not JSON, then
    // re-sign it so the signature passes — verifies the JSON parse guard.
    const { createHmac } = require('node:crypto') as typeof import('node:crypto')
    const secret = 'test-unsubscribe-secret-do-not-use'
    const body = Buffer.from('not-json-at-all', 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    const sig = createHmac('sha256', secret)
      .update(body)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(verifyUnsubscribeToken(`${body}.${sig}`)).toBeNull()
  })

  it('returns null on version mismatch', () => {
    const { createHmac } = require('node:crypto') as typeof import('node:crypto')
    const secret = 'test-unsubscribe-secret-do-not-use'
    const payload = { e: 'jane@example.com', v: 99 }
    const body = Buffer.from(JSON.stringify(payload), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    const sig = createHmac('sha256', secret)
      .update(body)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(verifyUnsubscribeToken(`${body}.${sig}`)).toBeNull()
  })

  it('returns null on empty / null / undefined / non-string input', () => {
    expect(verifyUnsubscribeToken('')).toBeNull()
    expect(verifyUnsubscribeToken(null)).toBeNull()
    expect(verifyUnsubscribeToken(undefined)).toBeNull()
    expect(verifyUnsubscribeToken(42 as unknown)).toBeNull()
    expect(verifyUnsubscribeToken({} as unknown)).toBeNull()
  })
})
