// Unit tests — Shopify webhook HMAC verification.
//
// Pure function, no framework dependency. The webhook route is the single
// boundary that decides whether an unauthenticated POST hits our DB; the
// signature check is the entire trust gate, so it gets explicit coverage.

import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyShopifyHmac } from '../src/modules/cart-tracking/shopify-webhook-hmac'
import { deriveOrderStatus } from '../src/modules/cart-tracking/upsert-shopify-order'

const SECRET = '287428e44d0d3e929d5d1149aa6a52032c36424a711b11a69d1d2b49a72c490b'
const BODY = JSON.stringify({ id: 12345, cart_token: 'abc', email: 'jane@example.com' })

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('base64')
}

describe('verifyShopifyHmac', () => {
  it('accepts a valid signature for the given body', () => {
    const sig = sign(BODY, SECRET)
    expect(verifyShopifyHmac(BODY, sig, SECRET)).toBe(true)
  })

  it('rejects when the body byte changes after signing', () => {
    const sig = sign(BODY, SECRET)
    const tampered = `${BODY} `
    expect(verifyShopifyHmac(tampered, sig, SECRET)).toBe(false)
  })

  it('rejects when the secret differs', () => {
    const sig = sign(BODY, SECRET)
    expect(verifyShopifyHmac(BODY, sig, 'wrong-secret')).toBe(false)
  })

  it('rejects when the signature is tampered with', () => {
    const sig = sign(BODY, SECRET)
    const flipped = sig.startsWith('A') ? `B${sig.slice(1)}` : `A${sig.slice(1)}`
    expect(verifyShopifyHmac(BODY, flipped, SECRET)).toBe(false)
  })

  it('rejects when header is null/empty', () => {
    expect(verifyShopifyHmac(BODY, null, SECRET)).toBe(false)
    expect(verifyShopifyHmac(BODY, '', SECRET)).toBe(false)
  })

  it('rejects when secret is empty', () => {
    const sig = sign(BODY, SECRET)
    expect(verifyShopifyHmac(BODY, sig, '')).toBe(false)
  })

  it('rejects signatures of different length (no timingSafeEqual throw)', () => {
    // shorter than a valid base64 SHA-256 digest (44 chars) — must not throw.
    expect(verifyShopifyHmac(BODY, 'too-short', SECRET)).toBe(false)
  })
})

describe('deriveOrderStatus', () => {
  it('keeps partially paid and partially refunded Shopify orders in the paid projection', () => {
    expect(deriveOrderStatus({ financial_status: 'partially_paid' })).toBe('paid')
    expect(deriveOrderStatus({ financial_status: 'partially_refunded' })).toBe('paid')
  })

  it('does not let fulfillment override a canonical refund or cancellation', () => {
    expect(
      deriveOrderStatus({
        financial_status: 'refunded',
        fulfillment_status: 'fulfilled',
      }),
    ).toBe('refunded')
    expect(
      deriveOrderStatus({
        financial_status: 'paid',
        fulfillment_status: 'fulfilled',
        cancelled_at: '2026-07-20T10:00:00.000Z',
      }),
    ).toBe('cancelled')
  })
})
