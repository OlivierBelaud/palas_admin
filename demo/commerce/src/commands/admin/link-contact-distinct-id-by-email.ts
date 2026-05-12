// Command: stamp `contact.distinct_id` for a contact identified by its email,
// only when the contact exists AND its `distinct_id` is currently NULL.
//
// Purpose: close the gap where a contact was created via Klaviyo sync
// (newsletter signup) without a PostHog session, then later a newsletter
// click (`_kx=`) resolves the identity in the proxy. Without this update,
// the contact's `distinct_id` stays NULL forever, so future visitor-session
// segmentation can't link the session back to the contact.
//
// Triggered by:
//   - `klaviyo-identity-to-session` subscriber (after proxy emits
//     `posthog.klaviyo-identity-resolved`)
//   - `posthog-cart-tracker` subscriber when an event carries both
//     `distinct_id` and a resolved `email` (broader path: any identified
//     event from a contact whose distinct_id was missing)
//
// Idempotency: `WHERE distinct_id IS NULL` — re-runs are no-ops on contacts
// that already have an id stamped. Case-insensitive email match.
//
// Does NOT update other contact fields. Does NOT create a contact if none
// exists for the email (we don't want to spawn ghost rows from random
// events).

import { z } from 'zod'

export default defineCommand({
  name: 'linkContactDistinctIdByEmail',
  description:
    'Stamp contact.distinct_id from (email, distinct_id) when contact exists and distinct_id is NULL. Idempotent.',
  input: z.object({
    email: z.string().min(3),
    distinct_id: z.string().min(1),
  }),
  workflow: async (input, { step }) => {
    const svc = step.service as unknown as {
      contact: {
        list(
          filter: Record<string, unknown>,
          opts?: { take?: number },
        ): Promise<Array<{ id: string; distinct_id: string | null; email: string }>>
        update(id: string, patch: Record<string, unknown>): Promise<unknown>
      }
    }

    // Lookup contact by lowercased email — service `list` filter uses raw equality
    // so we trust the contact-tracking sync paths to normalise emails to lower.
    // If the email isn't stored normalised, the lookup just misses (acceptable —
    // we don't want to create or mutate ghost rows).
    const emailLc = input.email.trim().toLowerCase()
    const candidates = await svc.contact.list({ email: emailLc }, { take: 1 })
    const target = candidates[0]
    if (!target) return { matched: 0 } // No contact for this email → no-op
    if (target.distinct_id != null && target.distinct_id !== '') return { matched: 1 } // Already set → idempotent
    await svc.contact.update(target.id, { distinct_id: input.distinct_id })
    return { matched: 1 }
  },
})
