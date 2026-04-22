// verifyQStashSignature — HMAC-SHA256 verification for incoming QStash
// deliveries. QStash signs the body with `QSTASH_CURRENT_SIGNING_KEY` (and
// rotates to `QSTASH_NEXT_SIGNING_KEY` periodically — we accept both).
//
// Protocol (Upstash docs):
//   - Request header `Upstash-Signature`: "v1,<base64url(HMAC-SHA256(body, key))>"
//   - We recompute both signatures (current + next), accept the message if
//     EITHER matches. This covers the ~5-minute key rotation window.
//
// Use in your resume endpoint before calling `manager.resume(runId)` so end
// users can't directly POST /_workflow/:id/resume and replay old messages.

import { createHmac, timingSafeEqual } from 'node:crypto'

export interface VerifyQStashSignatureOptions {
  currentSigningKey: string
  nextSigningKey?: string
}

export function verifyQStashSignature(
  body: string,
  signatureHeader: string | null | undefined,
  opts: VerifyQStashSignatureOptions,
): boolean {
  if (!signatureHeader) return false
  const match = /^v1,(.+)$/.exec(signatureHeader.trim())
  if (!match) return false
  const signature = match[1]

  const expectedCurrent = sign(body, opts.currentSigningKey)
  if (safeEqual(signature, expectedCurrent)) return true

  if (opts.nextSigningKey) {
    const expectedNext = sign(body, opts.nextSigningKey)
    if (safeEqual(signature, expectedNext)) return true
  }

  return false
}

function sign(body: string, key: string): string {
  return createHmac('sha256', key).update(body).digest('base64url')
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b))
  } catch {
    return false
  }
}
