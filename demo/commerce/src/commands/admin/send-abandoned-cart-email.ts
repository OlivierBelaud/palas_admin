// Command: V1 standalone test — render and send a single abandoned-cart
// email via Resend (or whatever notification adapter is wired in).
//
// This command DOES NOT mark the cart (no `abandon_notified_at` write). It is
// meant for one-off testing while we validate the email template in
// production. The cron-driven path stays Klaviyo-only until we cut over.
//
// Compensation is a no-op — once an email is dispatched to the provider it
// cannot be unsent. We log a warning if the workflow is rolled back after
// the action succeeds.

import { type NotificationSend, sendAbandonedCartEmailForCart } from '../../emails/abandoned-cart/send-for-cart'

interface CartRow {
  id: string
  cart_token: string
  checkout_token: string | null
  email: string | null
  first_name: string | null
  country_code: string | null
  browser_locale?: string | null
  items: unknown
  total_price: number | null
  currency: string | null
  abandon_notified_count?: number | null
}

interface ContactRow {
  id: string
  locale?: string | null
  email_marketing_opt_out_at?: Date | string | null
  klaviyo_suppressed?: boolean | null
}

export default defineCommand({
  name: 'sendAbandonedCartEmail',
  description: 'V1 standalone test — render + send a Resend abandoned-cart email for one cart. Does NOT mark the cart.',
  input: z.object({
    cartId: z.string(),
    dryRun: z.boolean().default(false),
    idempotencyKey: z.string().optional(),
    localeOverride: z.enum(['fr', 'en']).optional(),
  }),
  workflow: async (input, { step, log }) => {
    return await step.action('send-abandoned-cart-email', {
      invoke: async (_: unknown, ctx) => {
        // 1. Retrieve the cart via the cart service. Same Proxy trick as
        //    rebuild-carts / notify-abandoned-carts: step.service exposes
        //    per-entity CRUD at runtime even though TS sees only modules.
        const cartSvc = (
          step.service as unknown as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>
        ).cart
        const cart = (await cartSvc.retrieveCart(input.cartId)) as CartRow | null
        if (!cart) {
          throw new MantaError('NOT_FOUND', `Cart ${input.cartId} not found`)
        }

        // 2. Resolve the linked contact (if any) so we can pick the locale.
        //    The cart-contact link is 1:1; we read with link.list and pull
        //    the first row.
        const linkRead = (
          step.link as unknown as Record<
            string,
            { list: (where: Record<string, unknown>) => Promise<Array<{ cart_id: string; contact_id: string }>> }
          >
        ).cartContact
        const links = await linkRead.list({ cart_id: input.cartId })
        const contactId = links[0]?.contact_id

        let contact: ContactRow | null = null
        if (contactId) {
          const contactSvc = (
            step.service as unknown as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>
          ).contact
          contact = (await contactSvc.retrieveContact(contactId)) as ContactRow | null
        }

        // 3. Resolve the notification port from the app container — same
        //    pattern as rebuild-carts.ts:74 reaching for IDatabasePort.
        const notification = ctx.app.resolve('INotificationPort') as NotificationSend

        // 4. Delegate to the helper (already unit-tested).
        return await sendAbandonedCartEmailForCart({
          cart,
          contact,
          notification,
          dryRun: input.dryRun,
          idempotencyKey: input.idempotencyKey,
          localeOverride: input.localeOverride,
          log,
        })
      },
      compensate: async (_out, _ctx) => {
        // External email send is irreversible. Same posture as
        // notifyAbandonedCarts and rebuildCarts: log loudly and move on.
        log.warn('[sendAbandonedCartEmail] non-compensable: email already dispatched')
      },
    })({})
  },
})
