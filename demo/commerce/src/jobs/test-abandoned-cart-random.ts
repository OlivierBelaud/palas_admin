// TEST cron: every minute, picks a random recent cart and sends the
// abandoned-cart email to the hardcoded test inbox. Does NOT mark the cart,
// no PostHog event.
//
// Uses Manta ports directly so the job can await the full pipeline before
// returning without importing concrete DB or email transports.

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

export default defineJob('test-abandoned-cart-random', '* * * * *', async ({ command, db, notification, log }) => {
  if (process.env.ENABLE_ABANDONED_CART_TEST_CRON !== 'true') {
    log.warn('[test-random] disabled: ENABLE_ABANDONED_CART_TEST_CRON is not true')
    return EMPTY
  }
  if (process.env.NODE_ENV !== 'production') {
    log.info(`[test-random] skipped (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}, prod-only)`)
    return EMPTY
  }
  // command parameter is unused here — we go around it on purpose (see file header).
  void command

  const sql = db?.getPool()
  if (!db || typeof sql !== 'function') {
    log.error('[test-random] IDatabasePort not set')
    return { ...EMPTY, error: 'IDatabasePort not set' }
  }
  if (!notification) {
    log.error('[test-random] INotificationPort not set')
    return { ...EMPTY, error: 'INotificationPort not set' }
  }

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

    const minuteBucket = new Date().toISOString().slice(0, 16)
    const idempotencyKey = `test-random:${pick.id}:${minuteBucket}`

    const result = await notification.send({
      channel: 'email',
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
      idempotency_key: idempotencyKey,
    })

    if (result.status === 'FAILURE') {
      log.error(`[test-random] notification error cart=${pick.id} msg=${result.error?.message ?? '-'}`)
      return { picked: pick.id, sent: false, candidates: candidates.length, error: result.error?.message }
    }
    log.info(`[test-random] sent cart=${pick.id} to=${TEST_TO} subject="${subject}" messageId=${result.id ?? '-'}`)
    return {
      picked: pick.id,
      sent: true,
      to: TEST_TO,
      messageId: result.id,
      candidates: candidates.length,
    }
  } catch (err) {
    log.error(`[test-random] threw: ${(err as Error).message}`)
    return { ...EMPTY, error: (err as Error).message }
  }
})
