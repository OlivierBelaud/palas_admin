// TEST cron: every minute, picks a random recent cart and sends the
// abandoned-cart email to the hardcoded test inbox. Does NOT mark the cart,
// no PostHog event.
//
// IMPORTANT: this job does NOT route through `defineCommand` because Manta
// commands return `{ runId, status: 'running' }` after a 300ms short-circuit
// (WORKFLOW_PROGRESS.md §6.1). On Vercel serverless the function dies as
// soon as the HTTP handler returns, killing the background continuation
// before Resend has a chance to send. We bypass with direct postgres + Resend
// calls — the job can `await` the full pipeline before returning.

import postgres from 'postgres'
import { Resend } from 'resend'
import { renderAbandonedCart } from '../emails/abandoned-cart/render'
import { buildRecoveryUrl } from '../utils/recovery-url'
import { signUnsubscribeToken } from '../utils/unsubscribe-token'

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
}

interface JobResult {
  picked: string | null
  sent: boolean
  to?: string
  messageId?: string
  candidates: number
  error?: string
}

const EMPTY: JobResult = { picked: null, sent: false, candidates: 0 }

export default defineJob('test-abandoned-cart-random', '* * * * *', async ({ command, log }) => {
  if (process.env.NODE_ENV !== 'production') {
    log.info(`[test-random] skipped (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}, prod-only)`)
    return EMPTY
  }
  // command parameter is unused here — we go around it on purpose (see file header).
  void command

  const dbUrl = process.env.DATABASE_URL
  const resendKey = process.env.RESEND_API_KEY
  if (!dbUrl) {
    log.error('[test-random] DATABASE_URL not set')
    return { ...EMPTY, error: 'DATABASE_URL not set' }
  }
  if (!resendKey) {
    log.error('[test-random] RESEND_API_KEY not set')
    return { ...EMPTY, error: 'RESEND_API_KEY not set' }
  }

  const sql = postgres(dbUrl, { ssl: 'require', max: 1, prepare: false })
  try {
    const candidates = await sql<CartRow[]>`
      SELECT id, cart_token, checkout_token, email, first_name, country_code, items, total_price, currency
      FROM carts
      WHERE email IS NOT NULL
        AND items IS NOT NULL
        AND jsonb_array_length(items) > 0
        AND last_action_at >= NOW() - INTERVAL '30 days'
        AND highest_stage <> 'completed'
      ORDER BY RANDOM()
      LIMIT 1`

    if (candidates.length === 0) {
      log.info('[test-random] no candidate cart in the last 30 days')
      return EMPTY
    }
    const pick = candidates[0]
    log.info(`[test-random] picked cart=${pick.id} original_email=${pick.email}`)

    const itemsArr = Array.isArray(pick.items) ? (pick.items as Array<Record<string, unknown>>) : []
    if (itemsArr.length === 0) {
      log.warn(`[test-random] cart=${pick.id} has empty items array — skipping`)
      return { ...EMPTY, picked: pick.id, candidates: candidates.length }
    }

    // Map Shopify-shaped items to AbandonedCartItem[]
    const renderItems = itemsArr.map((it) => ({
      id: typeof it.id === 'string' || typeof it.id === 'number' ? it.id : null,
      title: typeof it.title === 'string' ? it.title : '',
      quantity: typeof it.quantity === 'number' ? it.quantity : 1,
      image_url: typeof it.image_url === 'string' ? it.image_url : null,
    }))

    const adminBase = (process.env.ADMIN_BASE_URL ?? 'https://admin.fancypalas.com').replace(/\/+$/, '')
    const recoveryUrl = buildRecoveryUrl({
      checkout_token: pick.checkout_token,
      cart_token: pick.cart_token,
      items: renderItems.map((i) => ({ id: i.id, quantity: i.quantity })),
    })
    const unsubscribeToken = signUnsubscribeToken(TEST_TO)
    const unsubscribeUrl = `${adminBase}/api/contact/unsubscribe?t=${unsubscribeToken}`

    const { subject, html, text } = await renderAbandonedCart({
      locale: 'fr',
      firstName: pick.first_name,
      items: renderItems,
      recoveryUrl,
      unsubscribeUrl,
    })

    const resend = new Resend(resendKey)
    const minuteBucket = new Date().toISOString().slice(0, 16)
    const idempotencyKey = `test-random:${pick.id}:${minuteBucket}`

    const result = await resend.emails.send(
      {
        from: process.env.RESEND_FROM_EMAIL ?? 'Fancy Palas <hello@fancypalas.com>',
        to: TEST_TO,
        subject,
        html,
        text,
        replyTo: process.env.RESEND_REPLY_TO,
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
        tags: [
          { name: 'category', value: 'abandoned-cart-test' },
          { name: 'cart_id', value: pick.id },
        ],
      },
      { idempotencyKey },
    )

    if (result.error) {
      log.error(
        `[test-random] Resend error cart=${pick.id} name=${result.error.name} msg=${result.error.message ?? '-'}`,
      )
      return { picked: pick.id, sent: false, candidates: candidates.length, error: result.error.message }
    }
    log.info(
      `[test-random] sent cart=${pick.id} to=${TEST_TO} subject="${subject}" messageId=${result.data?.id ?? '-'}`,
    )
    return {
      picked: pick.id,
      sent: true,
      to: TEST_TO,
      messageId: result.data?.id,
      candidates: candidates.length,
    }
  } catch (err) {
    log.error(`[test-random] threw: ${(err as Error).message}`)
    return { ...EMPTY, error: (err as Error).message }
  } finally {
    await sql.end({ timeout: 1 })
  }
})
