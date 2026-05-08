// Command: upsert a Contact from a cart-tracking signal + link the
// originating cart to it.
//
// Called by ingestCartEvent whenever an inbound event carries an email.
// We treat it as a "contact identification" signal: we know an email
// for the visitor at this point, so we want a Contact row that
// reflects everything we know (Shopify customer id, distinct_id,
// locale-friendly first_name/last_name) and a 1:1 link from the cart
// row so admin pages can join cart -> contact in one hop.
//
// Idempotency rules (so the cron + the live subscriber + a rebuild can
// all hit this command for the same event without divergence):
//   - email is normalised to lowercase before any lookup.
//   - non-empty fields on an existing contact are preserved (we never
//     clobber a value with null).
//   - empty/null fields on an existing contact get filled in if the
//     signal carries something.
//   - last_activity_at is always bumped to now() — this is the only
//     side effect that always happens, because "we saw this contact
//     again" is the entire point of the signal.
//   - the cart->contact link is created if missing, or repointed if the
//     cart was previously linked to a different contact.

import {
  type CartContactLinkOps,
  type CartContactRow,
  type ContactRepo,
  upsertContactAndLink,
} from '../../modules/contact/upsert-contact-helper'

export default defineCommand({
  name: 'upsertContactFromCartSignal',
  description: 'Upsert a Contact from a cart-tracking signal and link the cart to it. Idempotent.',
  input: z.object({
    cart_id: z.string(),
    email: z.string().min(3),
    first_name: z.string().nullable().optional(),
    last_name: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    country_code: z.string().nullable().optional(),
    distinct_id: z.string().nullable().optional(),
    shopify_customer_id: z.string().nullable().optional(),
  }),
  workflow: async (input, { step }) => {
    // step.service runtime Proxy resolves entity names (contact) to per-entity CRUD
    // even though the static type only knows module names. Same trick as
    // ingest-cart-event.ts.
    const contact = (step.service as unknown as { contact: ContactRepo }).contact

    // step.link's runtime exposes per-link CRUD namespaces (list/...). We use
    // the auto-generated framework commands `linkCartContact` / `unlinkCartContact`
    // for the writes (so compensation flows through the workflow engine) and the
    // link-list helper for the read.
    const linkRead = (
      step.link as unknown as Record<string, { list: (w: Record<string, unknown>) => Promise<CartContactRow[]> }>
    ).cartContact

    const link: CartContactLinkOps = {
      list: linkRead.list,
      link: (i) => step.command.linkCartContact(i),
      unlink: (i) => step.command.unlinkCartContact(i),
    }

    return await upsertContactAndLink({ contact, link, input })
  },
})
