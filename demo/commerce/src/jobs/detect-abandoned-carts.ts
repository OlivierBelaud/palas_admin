// Cron: hourly sweep for abandoned identified carts → Resend relance.
//
// Window: idle ∈ [2h30, 5h]. Cibles les paniers qui viennent de "sortir" du
// flow Klaviyo natif sans avoir converti. Skip si :
//   - opt-out (Contact.email_marketing_opt_out_at)
//   - klaviyo_suppressed
//   - Klaviyo abandonment-flow event in the last 12h
// One email per cart, ever (`abandon_notified_count < 1` SQL gate).
//
// Direct postgres + Resend SDK on purpose — Manta `defineCommand` short-
// circuits at 300ms via Promise.race and runs the rest in the host process.
// On Vercel serverless the function dies as soon as the HTTP handler returns,
// killing the background continuation before Resend has time to send. By
// going around the framework we keep the entire pipeline awaited inside the
// cron HTTP handler. See `notify-abandoned-carts.ts` for the legacy
// command-mode wrapper (kept for manual admin invocation).
//
// Production-only — local `manta dev` no-ops to avoid hitting prod data.

import postgres from 'postgres'
import { Resend } from 'resend'
import { type RunResult, runAbandonedCartBackfill } from '../utils/abandoned-cart-direct-sender'

const EMPTY: RunResult = {
  scanned: 0,
  sent: 0,
  skipped: 0,
  errors: 0,
  skipped_optout: 0,
  skipped_klaviyo: 0,
  skipped_no_products: 0,
  skipped_dry_run: 0,
}

export default defineJob('detect-abandoned-carts', '0 * * * *', async ({ log }) => {
  if (process.env.NODE_ENV !== 'production') {
    log.info(`[detect-abandoned-carts] skipped (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}, prod-only)`)
    return EMPTY
  }
  const dbUrl = process.env.DATABASE_URL
  const resendKey = process.env.RESEND_API_KEY
  if (!dbUrl || !resendKey) {
    log.error('[detect-abandoned-carts] DATABASE_URL or RESEND_API_KEY missing')
    return { ...EMPTY, errors: 1 }
  }

  const sql = postgres(dbUrl, { ssl: 'require', max: 1, prepare: false })
  const resend = new Resend(resendKey)
  const adminBase = (process.env.ADMIN_BASE_URL ?? 'https://admin.fancypalas.com').replace(/\/+$/, '')
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'Fancy Palas <hello@fancypalas.com>'
  const replyTo = process.env.RESEND_REPLY_TO

  try {
    const result = await runAbandonedCartBackfill({
      sql,
      resend,
      adminBase,
      fromEmail,
      replyTo,
      minIdleHours: 2.5,
      maxAgeHours: 5,
      klaviyoRecentHours: 12,
      batchLimit: 50,
      campaign: 'live-2h30-5h',
      log,
    })
    log.info(
      `[detect-abandoned-carts] scanned=${result.scanned} sent=${result.sent} skipped=${result.skipped} errors=${result.errors} skipped_no_products=${result.skipped_no_products}`,
    )
    return result
  } finally {
    await sql.end({ timeout: 1 })
  }
})
