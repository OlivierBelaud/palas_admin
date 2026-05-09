// TEST command: pick a random recent cart, render the abandoned-cart email,
// and send it to a hardcoded test inbox. Does NOT mark the cart, does NOT
// capture PostHog. Used by the `test-abandoned-cart-random` cron at every
// minute to exercise the Resend pipeline end-to-end without touching real
// customers.

import { type NotificationSend, sendAbandonedCartEmailForCart } from '../../emails/abandoned-cart/send-for-cart'

const TEST_TO = 'olivierbelaudpro@gmail.com'

interface CartRow {
  id: string
  cart_token: string
  checkout_token: string | null
  email: string | null
  first_name: string | null
  country_code: string | null
  items: unknown
  total_price: number | null
  currency: string | null
  abandon_notified_count?: number | null
}

export default defineCommand({
  name: 'testSendRandomAbandonedCart',
  description: 'TEST: pick a random recent cart, render the abandoned-cart email, send to TEST_TO. No DB mark.',
  input: z.object({}).default({}),
  workflow: async (_input, { step, log }) => {
    return await step.action('test-send-random-abandoned-cart', {
      invoke: async (_: unknown, ctx) => {
        const cartSvc = (
          step.service as unknown as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>
        ).cart

        const lookBackMs = 30 * 86400 * 1000
        const since = new Date(Date.now() - lookBackMs)
        const candidates = (await cartSvc.listCarts(
          {
            // biome-ignore lint/suspicious/noExplicitAny: $-prefixed Manta filter operators not in entity type
            email: { $notnull: true } as any,
            // biome-ignore lint/suspicious/noExplicitAny: same
            items: { $notnull: true } as any,
            // biome-ignore lint/suspicious/noExplicitAny: same
            last_action_at: { $gte: since } as any,
          },
          { take: 200 },
        )) as CartRow[]

        if (candidates.length === 0) {
          log.info('[testSendRandom] no candidate cart in the last 30 days')
          return { picked: null, sent: false, skipped: 'no-candidates' as const }
        }

        const pick = candidates[Math.floor(Math.random() * candidates.length)]
        if (!pick) return { picked: null, sent: false }

        const overrideCart: CartRow = { ...pick, email: TEST_TO, country_code: 'FR' }
        const notification = ctx.app.resolve('INotificationPort') as NotificationSend

        // Per-minute idempotency key so Resend doesn't dedupe the test stream.
        const minuteBucket = new Date().toISOString().slice(0, 16) // YYYY-MM-DDTHH:MM
        const idempotencyKey = `test-random:${pick.id}:${minuteBucket}`

        const result = await sendAbandonedCartEmailForCart({
          cart: overrideCart,
          contact: null,
          notification,
          dryRun: false,
          idempotencyKey,
          localeOverride: 'fr',
          log,
        })

        log.info(
          `[testSendRandom] picked=${pick.id} cart_email=${pick.email ?? '-'} sent=${result.sent} to=${result.to ?? '-'} skipped=${result.skipped ?? '-'} subject="${result.subject}"`,
        )

        return {
          picked: pick.id,
          sent: result.sent,
          to: result.to ?? null,
          locale: result.locale,
          skipped: result.skipped,
          error: result.error,
        }
      },
      compensate: async (_out, _ctx) => {
        log.warn('[testSendRandom] non-compensable: test email already dispatched (or not)')
      },
    })({})
  },
})
