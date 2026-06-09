// Standalone script: drain the historical abandoned-cart backlog
// (everything still eligible after May-8 + the live cron).
//
// Window: idle ∈ [5h, 30 days]. The 5h lower bound matches the cron live's
// upper bound, so the two pipelines never collide on the same cart.
//
// Same guarantees as send-may-8-real.ts:
//   - filters: opt-out, klaviyo_suppressed, klaviyo<12h, not completed,
//     items present, abandon_notified_count<1
//   - DB mark + PostHog after each successful send
//   - 15s between sends
//   - Idempotent (count<1 SQL gate)
//   - Ctrl-C = clean stop
//
// Usage:
//   cd demo/commerce && pnpm exec tsx scripts/send-historical-real.ts --dry
//   cd demo/commerce && pnpm exec tsx scripts/send-historical-real.ts

// Polyfill MantaError before any framework module is imported.
;(globalThis as unknown as { MantaError: typeof Error }).MantaError = class extends Error {
  code: string
  constructor(code: string, msg?: string) {
    super(msg ?? code)
    this.code = code
    this.name = 'MantaError'
  }
} as unknown as typeof Error

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { Resend } from 'resend'
import { runAbandonedCartBackfill } from '../src/utils/abandoned-cart-direct-sender'

const DRY = process.argv.includes('--dry')
const SLEEP_MS = DRY ? 0 : 15_000
const MAX_AGE_HOURS = 30 * 24 // 30 days
const MIN_IDLE_HOURS = 5 // matches the cron live's upper bound

const here = dirname(fileURLToPath(import.meta.url))
for (const line of readFileSync(resolve(here, '..', '.env.production'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const dbUrl = process.env.DATABASE_URL
const resendKey = process.env.RESEND_API_KEY
if (!dbUrl) throw new Error('DATABASE_URL not set in .env.production')
if (!resendKey && !DRY) throw new Error('RESEND_API_KEY not set (use --dry to skip)')

const sql = postgres(dbUrl, { ssl: 'require', max: 1, prepare: false })
const resend = resendKey ? new Resend(resendKey) : null
const adminBase = (process.env.ADMIN_BASE_URL ?? 'https://admin.fancypalas.com').replace(/\/+$/, '')
const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'Fancy Palas <hello@fancypalas.com>'
const replyTo = process.env.RESEND_REPLY_TO

let stopRequested = false
process.on('SIGINT', () => {
  console.log('\n[stop] SIGINT — finishing current send and exiting cleanly')
  stopRequested = true
})

const log = {
  info: (m: string) => console.log(m),
  warn: (m: string) => console.warn(m),
  error: (m: string) => console.error(m),
}

try {
  console.log(`=== Historical backfill (${DRY ? 'DRY-RUN' : 'LIVE'}) ===`)
  console.log(`Window: idle ${MIN_IDLE_HOURS}h → ${MAX_AGE_HOURS}h (~${Math.round(MAX_AGE_HOURS / 24)} days)`)
  console.log(`Sleep between sends: ${SLEEP_MS / 1000}s`)
  console.log('Press Ctrl-C to stop after the current send.\n')

  const result = await runAbandonedCartBackfill({
    sql,
    resend,
    adminBase,
    fromEmail,
    replyTo,
    minIdleHours: MIN_IDLE_HOURS,
    maxAgeHours: MAX_AGE_HOURS,
    klaviyoRecentHours: 12,
    batchLimit: 500,
    dryRun: DRY,
    campaign: 'historical-backfill',
    log,
    onAfterSend: async (i, total) => {
      if (stopRequested) {
        throw new Error('user-stop')
      }
      if (i < total - 1) {
        await new Promise<void>((r) => setTimeout(r, SLEEP_MS))
      }
    },
  })

  console.log(
    `\n=== Done — scanned=${result.scanned} sent=${result.sent} skipped=${result.skipped} errors=${result.errors}`,
    `(opt-out=${result.skipped_optout} klaviyo=${result.skipped_klaviyo} no_products=${result.skipped_no_products} dry_run=${result.skipped_dry_run}) ===`,
  )
} finally {
  await sql.end({ timeout: 1 })
}
