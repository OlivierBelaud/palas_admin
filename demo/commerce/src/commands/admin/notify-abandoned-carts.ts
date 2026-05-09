// Command: relance abandoned carts via Resend (transactional emails).
//
// **One email per cart, ever.** abandon_notified_count<1 in the SQL where +
// belt-and-braces in the marker. There is no second tier.
//
// Selection happens via `step.service.cart.listCarts`. Two windowing modes:
//   - LIVE (default cron path): last_action_at ∈ [now − maxAgeHours, now − minIdleHours].
//     Cron defaults: minIdleHours=2.5, maxAgeHours=5 → cibles les paniers idle
//     entre 2h30 et 5h, ce qui laisse le flow Klaviyo natif faire son premier
//     email avant qu'on relance.
//   - BACKFILL (one-off jobs): pass `forDate: 'YYYY-MM-DD'` to target one
//     calendar day in Europe/Paris (used by the May-8 backfill job).
//
// Per-cart in-memory filters (in order):
//   - hard cap (count >= 1) — race guard
//   - empty items array — guard for ghost carts
//   - opt-out (Contact.email_marketing_opt_out_at) or klaviyo_suppressed
//   - recent Klaviyo native abandonment send (≤ klaviyoRecentHours, default 12h)
//     → "déjà dans le flow Klaviyo, on ne s'ajoute pas par-dessus"
// Then delegate render+send to `sendAbandonedCartEmailForCart`.
//
// Idempotence: only after a SUCCESS from Resend do we mark the cart with
// `abandon_notified_at` + bump `abandon_notified_count` to 1. The helper
// produces its own Resend idempotency_key so retries dedupe at the provider too.
//
// Compensation is a no-op — once an email is dispatched it can't be unsent.

import type { NotificationSend } from '../../emails/abandoned-cart/send-for-cart'
import {
  type CartContactLinkReadRepo,
  type CartRepo,
  type ContactReadRepo,
  type KlaviyoEventReadRepo,
  runNotifyAbandonedCarts,
} from './notify-abandoned-carts-helper'

export default defineCommand({
  name: 'notifyAbandonedCarts',
  description: 'Send Resend abandoned-cart emails for identified carts idle for >= minIdleHours',
  input: z.object({
    // Default 2.5h so we don't hit a cart while Klaviyo's first email
    // (typically T+1h) is still landing in the customer's inbox.
    minIdleHours: z.number().positive().max(720).default(2.5),
    // Default 5h: short window so the cron only relances genuinely fresh
    // abandons. Backfill jobs override with `forDate` (preferred) or a
    // larger maxAgeHours for ad-hoc drains.
    maxAgeHours: z.number().positive().max(8760).default(5),
    batchLimit: z.number().int().positive().max(500).default(100),
    dryRun: z.boolean().default(false),
    /** YYYY-MM-DD in Europe/Paris. When set, ignores idle/age window — used by backfill jobs. */
    forDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    /** Skip carts whose email received a Klaviyo native abandonment-flow event within this many hours. */
    klaviyoRecentHours: z.number().positive().max(720).default(12),
  }),
  workflow: async (input, { step, log }) => {
    const result = await step.action('notify-abandoned-carts', {
      invoke: async (_i: unknown, ctx) => {
        // step.service runtime exposes one service per ENTITY (not per
        // module), even when an entity lives in a multi-entity module. So
        // KlaviyoEvent is `step.service.klaviyoEvent`, not `step.service.contact`.
        const stepSvcAny = step.service as unknown as Record<
          string,
          Record<string, (...args: unknown[]) => Promise<unknown>>
        >
        const stepLinkAny = step.link as unknown as Record<
          string,
          { list: (where: Record<string, unknown>) => Promise<Array<{ cart_id: string; contact_id: string }>> }
        >

        const cart: CartRepo = {
          // biome-ignore lint/suspicious/noExplicitAny: $-prefixed Manta filter operators not in entity type
          list: (where, opts) => stepSvcAny.cart.listCarts(where as any, opts) as Promise<never>,
          update: (patch) => stepSvcAny.cart.updateCarts(patch),
        }
        const contact: ContactReadRepo = {
          // biome-ignore lint/suspicious/noExplicitAny: same
          list: (where) => stepSvcAny.contact.listContacts(where as any) as Promise<never>,
          retrieve: (id) => stepSvcAny.contact.retrieveContact(id) as Promise<never>,
        }
        const klaviyoEvent: KlaviyoEventReadRepo = {
          // biome-ignore lint/suspicious/noExplicitAny: same
          list: (where, opts) => stepSvcAny.klaviyoEvent.listKlaviyoEvents(where as any, opts) as Promise<never>,
        }
        const cartContactLink: CartContactLinkReadRepo = {
          list: (where) => stepLinkAny.cartContact.list(where),
        }

        const notification = ctx.app.resolve('INotificationPort') as NotificationSend

        const counters = await runNotifyAbandonedCarts(
          {
            minIdleHours: input.minIdleHours,
            maxAgeHours: input.maxAgeHours,
            batchLimit: input.batchLimit,
            dryRun: input.dryRun,
            forDate: input.forDate,
            klaviyoRecentHours: input.klaviyoRecentHours,
          },
          { cart, contact, klaviyoEvent, cartContactLink, notification, log, signal: ctx.signal },
        )

        return counters
      },
      compensate: async (output, _ctx) => {
        // External email sends are irreversible — compensation is a no-op
        // by design (same pattern as purgeEmptyCarts / rebuildCarts).
        log.warn(`[notifyAbandonedCarts] Non-compensable: ${output.notified} Resend emails already sent`)
      },
    })({})

    log.info(
      `[notifyAbandonedCarts] scanned=${result.scanned} notified=${result.notified} skipped=${result.skipped} errors=${result.errors} skipped_optout=${result.skipped_optout} skipped_klaviyo_recent=${result.skipped_klaviyo_recent}`,
    )
    return result
  },
})
