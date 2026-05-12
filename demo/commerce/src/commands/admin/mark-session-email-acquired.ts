// Command: stamp the currently-open visitor_session as
// email-acquired (newsletter or checkout_started).
//
// Triggered by:
//   - `klaviyo-identity-to-session` subscriber (newsletter path), after
//     the proxy resolves a Klaviyo $exchange_id → email
//   - the checkout_started path is handled inline by planSessionUpsert
//     (NOT through this command), but the `via` enum supports both for
//     completeness / future use
//
// Idempotent: a session that already carries `email_acquired_in_session`
// is a no-op (matched=1, no write).
//
// Algorithm lives in `mark-session-email-acquired-helper.ts` for testing.

import { markSessionEmailAcquiredCore, type SessionMarkerRepo } from '../../utils/mark-session-email-acquired-helper'

export default defineCommand({
  name: 'markSessionEmailAcquired',
  description:
    'Stamp the currently-open visitor_session as email-acquired (newsletter or checkout_started). Idempotent.',
  input: z.object({
    distinct_id: z.string().min(1),
    email: z.string().min(3),
    via: z.enum(['newsletter', 'checkout_started']),
  }),
  workflow: async (input, { step }) => {
    const svc = step.service as unknown as { visitorSession: SessionMarkerRepo }
    return markSessionEmailAcquiredCore(
      { distinct_id: input.distinct_id, email: input.email, via: input.via },
      svc.visitorSession,
    )
  },
})
