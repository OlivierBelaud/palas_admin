// Cron: hourly abandoned-cart campaign arbiter.
//
// It no longer treats `carts.abandon_notified_at` as the history. The cart is
// the snapshot; abandoned_cart_cases/messages/checks are the audit trail:
//   - abandoned_cart_1 after 2h idle
//   - abandoned_cart_2 two days after email 1
//   - abandoned_cart_3 two days after email 2
//   - payment_help_1 after 1h when the highest stage is payment_attempted
//
// Every due message is guarded by Shopify and Klaviyo before send.
//
// Runs the full pipeline awaited inside the cron HTTP handler. All I/O goes
// through Manta ports so the same job can run on Cloudflare Workers, Vercel
// serverless, Bun/Node servers, or local dev with different adapters.
//
// Production-only — local `manta dev` no-ops to avoid hitting prod data.

import { type AbandonedCartCampaignResult, runAbandonedCartCampaign } from '../utils/abandoned-cart-campaign'
import { type RuntimeSql, resolveFile } from '../utils/manta-runtime'

const EMPTY: AbandonedCartCampaignResult = {
  scanned: 0,
  due: 0,
  sent: 0,
  skipped: 0,
  skipped_optout: 0,
  skipped_no_products: 0,
  skipped_shopify_order: 0,
  skipped_shopify_unavailable: 0,
  skipped_klaviyo: 0,
  recovered: 0,
  errors: 0,
  claim_conflicts: 0,
}

export default defineJob('detect-abandoned-carts', '0 * * * *', async ({ app, db, notification, log }) => {
  if (process.env.NODE_ENV !== 'production') {
    log.info(`[detect-abandoned-carts] skipped (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}, prod-only)`)
    return EMPTY
  }
  const pool = db?.getPool()
  if (!db || typeof pool !== 'function' || !notification) {
    log.error('[detect-abandoned-carts] IDatabasePort or INotificationPort missing')
    return { ...EMPTY, errors: 1 }
  }
  const sql = pool as RuntimeSql

  const adminBase = (process.env.ADMIN_BASE_URL ?? 'https://admin.fancypalas.com').replace(/\/+$/, '')
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'Fancy Palas <hello@fancypalas.com>'
  const replyTo = process.env.RESEND_REPLY_TO ?? 'hello@fancypalas.com'

  const result = await runAbandonedCartCampaign({
    sql,
    notification,
    file: resolveFile(app),
    adminBase,
    fromEmail,
    replyTo,
    batchLimit: 50,
    log,
  })
  log.info(
    `[detect-abandoned-carts] scanned=${result.scanned} due=${result.due} sent=${result.sent} skipped=${result.skipped} recovered=${result.recovered} errors=${result.errors} claim_conflicts=${result.claim_conflicts} skipped_shopify_order=${result.skipped_shopify_order} skipped_shopify_unavailable=${result.skipped_shopify_unavailable}`,
  )
  return result
})
