// TEST cron: every minute in production, picks a random recent cart and
// sends the abandoned-cart email to the hardcoded test inbox
// (`olivierbelaudpro@gmail.com`). The cart is NOT marked, no PostHog event
// is captured — see `commands/admin/test-send-random-abandoned-cart.ts`.
//
// Purpose: validate end-to-end Resend pipeline (template variants by item
// count, recovery URL, unsubscribe headers, deliverability) at sender
// rhythm without touching real customers.
//
// To pause: comment out / remove the entry in vercel.json or remove this file.

interface TestResult {
  picked: string | null
  sent: boolean
  to?: string | null
  locale?: string
  skipped?: string
  error?: string
}

const EMPTY: TestResult = { picked: null, sent: false }

export default defineJob('test-abandoned-cart-random', '* * * * *', async ({ command, log }) => {
  if (process.env.NODE_ENV !== 'production') {
    log.info(`[test-random] skipped (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}, prod-only)`)
    return EMPTY
  }
  const result = (await command.testSendRandomAbandonedCart({})) as TestResult
  log.info(
    `[test-random] picked=${result.picked ?? '-'} sent=${result.sent} to=${result.to ?? '-'} skipped=${result.skipped ?? '-'}`,
  )
  return result
})
