import { createHmac, timingSafeEqual } from 'node:crypto'

/** Verify Shopify's base64 HMAC over the exact UTF-8 request body. */
export function verifyShopifyHmac(rawBody: string, headerValue: string | null, secret: string): boolean {
  if (!headerValue || !secret) return false
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64')
  const expectedBytes = Buffer.from(expected, 'utf8')
  const receivedBytes = Buffer.from(headerValue, 'utf8')
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes)
}
