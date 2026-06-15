// Command: cohort-attribute a completed cart back to the visitor-session
// that should own the conversion.
//
// Called by ingestCartEvent on the FIRST transition into
// `highest_stage = 'completed'` for a cart. Idempotent: a second call
// for the same cart is a no-op as long as `cart_converted` is already true.
//
// Attribution rule: try the original birth-session match first, then
// recover real checkout sessions for old carts or carts missing a
// distinct_id via conversion timestamp and email.
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
  description: 'Attribute a completed cart back to the visitor_session that owns the conversion. Idempotent.',
  input: z.object({
    cart_id: z.string().min(1),
    cart_birth_at: z.string().datetime(),
    conversion_at: z.string().datetime().nullable().optional(),
    distinct_id: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    order_id: z.string().nullable().optional(),
  }),
  workflow: async (input, { step }) => {
    const svc = step.service as unknown as { visitorSession: SessionAttributionRepo }
    const visitorSessionRepo: SessionAttributionRepo = {
      list: (filters) => svc.visitorSession.list(filters),
      update: (id, data) => svc.visitorSession.update(id, data),
      listByEmail: async (email) => {
        const [startRows, endRows] = await Promise.all([
          svc.visitorSession.list({ email_at_session_start: email }),
          svc.visitorSession.list({ email_at_session_end: email }),
        ])
        const byId = new Map(startRows.concat(endRows).map((row) => [row.id, row]))
        return [...byId.values()]
      },
    }
    return attributeSessionConversionCore(
      {
        cart_birth_at: input.cart_birth_at,
        conversion_at: input.conversion_at ?? null,
        distinct_id: input.distinct_id ?? null,
        email: input.email ?? null,
        order_id: input.order_id ?? null,
      },
      visitorSessionRepo,
    )
  },
})
