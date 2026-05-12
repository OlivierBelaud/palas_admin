// Command: cohort-attribute a completed cart back to the visitor-session
// that birthed it.
//
// Called by ingestCartEvent on the FIRST transition into
// `highest_stage = 'completed'` for a cart. Idempotent: a second call
// for the same cart is a no-op as long as `cart_converted` is already true.
//
// Attribution rule (locked, D3): find the visitor_session for this
// distinct_id where `started_at <= cart_birth_at` AND
// `last_event_at >= cart_birth_at - 30min`. If multiple candidates,
// the most recent `started_at` wins. If none → matched: 0 (anonymous
// purchase or session was created after `cart_birth_at`, e.g. Apple Pay).
//
// The orchestration logic lives in the pure `attributeSessionConversionCore`
// helper so unit tests can exercise the matching/idempotency rules
// without booting the framework.

import {
  attributeSessionConversionCore,
  type SessionAttributionRepo,
} from '../../utils/attribute-session-conversion-helper'

export default defineCommand({
  name: 'attributeSessionConversion',
  description: 'Attribute a completed cart back to the visitor_session that was active at cart_birth_at. Idempotent.',
  input: z.object({
    cart_id: z.string().min(1),
    cart_birth_at: z.string().datetime(),
    distinct_id: z.string().nullable().optional(),
    order_id: z.string().nullable().optional(),
  }),
  workflow: async (input, { step }) => {
    const svc = step.service as unknown as { visitorSession: SessionAttributionRepo }
    return attributeSessionConversionCore(
      {
        cart_birth_at: input.cart_birth_at,
        distinct_id: input.distinct_id ?? null,
        order_id: input.order_id ?? null,
      },
      svc.visitorSession,
    )
  },
})
