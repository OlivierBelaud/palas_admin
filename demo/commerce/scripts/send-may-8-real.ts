// Standalone script: drain the May-8 abandoned-cart backlog, sending
// real Resend emails to each customer's actual address (not a test inbox).
//
// Hard guarantees:
//   - Same selection as the helper (`forDate: '2026-05-08'`):
//     email + items present + not completed + count<1 + not opted-out
//     + no Klaviyo abandonment-flow event in the last 12h
//   - 15 seconds between sends (gentle on Resend + sender reputation)
//   - DB mark right after each successful send: abandon_notified_at = NOW(),
//     abandon_notified_count = 1, abandon_notified_source = 'manta'
//     → safe to re-run; already-marked carts are filtered out by the SQL
//   - PostHog `manta_abandoned_cart_sent` event captured per send
//   - Ctrl-C between sends = clean stop (current send finishes, loop exits
//     before the next sleep)
//
// Usage:
//   cd demo/commerce && tsx scripts/send-may-8-real.ts          # live
//   cd demo/commerce && tsx scripts/send-may-8-real.ts --dry    # render only, no send, no mark

// Polyfill MantaError into globalThis BEFORE any framework module is
// imported — `signUnsubscribeToken` (and friends) reach for the global
// `MantaError` injected by the Manta runtime, which doesn't exist in plain
// tsx scripts. A minimal Error subclass is enough.
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
import { pickLocale } from '../src/emails/abandoned-cart/pick-locale'
import { renderAbandonedCart } from '../src/emails/abandoned-cart/render'
import { sendPosthogEvent } from '../src/utils/posthog-ingest'
import { buildRecoveryUrl } from '../src/utils/recovery-url'
import { signUnsubscribeToken } from '../src/utils/unsubscribe-token'

// ── Args + env ────────────────────────────────────────────────────────
const DRY = process.argv.includes('--dry')
const FOR_DATE = '2026-05-08'
// Live: 15s between sends to be gentle. Dry-run: no sleep — drain instantly.
const SLEEP_MS = DRY ? 0 : 15_000

const here = dirname(fileURLToPath(import.meta.url))
const envFile = '.env.production'
for (const line of readFileSync(resolve(here, '..', envFile), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const dbUrl = process.env.DATABASE_URL
const resendKey = process.env.RESEND_API_KEY
if (!dbUrl) throw new Error('DATABASE_URL not set in .env.production')
if (!resendKey && !DRY) throw new Error('RESEND_API_KEY not set (use --dry to skip)')

// ── Helpers ───────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

function parisDayBounds(yyyymmdd: string) {
  return {
    start: new Date(`${yyyymmdd}T00:00:00+02:00`),
    end: new Date(`${yyyymmdd}T23:59:59.999+02:00`),
  }
}

const KLAVIYO_RECENT_HOURS = 12

interface CandidateRow {
  id: string
  cart_token: string
  checkout_token: string | null
  distinct_id: string | null
  email: string
  first_name: string | null
  country_code: string | null
  items: unknown
  total_price: number | null
  currency: string | null
  contact_locale: string | null
}

// ── Main ──────────────────────────────────────────────────────────────
const sql = postgres(dbUrl, { ssl: 'require', max: 1, prepare: false })
const resend = resendKey ? new Resend(resendKey) : null
const adminBase = (process.env.ADMIN_BASE_URL ?? 'https://admin.fancypalas.com').replace(/\/+$/, '')

let stopRequested = false
process.on('SIGINT', () => {
  console.log('\n[stop] SIGINT received — finishing current send and exiting cleanly')
  stopRequested = true
})

async function pickCandidates(): Promise<CandidateRow[]> {
  const { start, end } = parisDayBounds(FOR_DATE)
  const klaviyoSince = new Date(Date.now() - KLAVIYO_RECENT_HOURS * 3600 * 1000)
  return await sql<CandidateRow[]>`
    SELECT
      c.id, c.cart_token, c.checkout_token, c.distinct_id, c.email,
      c.first_name, c.country_code, c.items, c.total_price, c.currency,
      ct.locale AS contact_locale
    FROM carts c
    LEFT JOIN contacts ct ON LOWER(ct.email) = LOWER(c.email)
    WHERE c.last_action_at >= ${start} AND c.last_action_at <= ${end}
      AND c.email IS NOT NULL
      AND c.items IS NOT NULL AND jsonb_array_length(c.items) > 0
      AND c.highest_stage <> 'completed' AND c.status <> 'completed'
      AND COALESCE(c.abandon_notified_count, 0) < 1
      AND (ct.email_marketing_opt_out_at IS NULL)
      AND (ct.klaviyo_suppressed IS NULL OR ct.klaviyo_suppressed = false)
      AND NOT EXISTS (
        SELECT 1 FROM klaviyo_events ke
        WHERE LOWER(ke.email) = LOWER(c.email)
          AND ke.occurred_at >= ${klaviyoSince}
          AND (
            ke.metric IN ('Shopify_Checkout_Abandonned', 'Checkout Abandoned')
            OR (ke.metric = 'Received Email' AND (
              ke.subject ILIKE '%oublié quelque chose%'
              OR ke.subject ILIKE '%pensez encore%'
              OR ke.subject ILIKE '%attend plus que vous%'
            ))
          )
      )
    ORDER BY c.last_action_at ASC`
}

const GWP_TITLE_RX = /\b(?:gift|offert|free|charm offert)\b/i

function coerceItems(raw: unknown) {
  if (!Array.isArray(raw)) return []
  const map = new Map<
    string,
    { id: string | number | null; title: string; quantity: number; image_url: string | null }
  >()
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const title = typeof o.title === 'string' ? o.title : ''
    if (GWP_TITLE_RX.test(title)) continue
    const rawId = typeof o.id === 'string' || typeof o.id === 'number' ? o.id : null
    const key = rawId !== null ? String(rawId) : `__no_id_${map.size}`
    const qty = typeof o.quantity === 'number' && Number.isFinite(o.quantity) ? o.quantity : 1
    const existing = map.get(key)
    if (existing) {
      existing.quantity += qty
      if (!existing.image_url && typeof o.image_url === 'string') existing.image_url = o.image_url
      continue
    }
    map.set(key, {
      id: rawId,
      title,
      quantity: qty,
      image_url: typeof o.image_url === 'string' ? o.image_url : null,
    })
  }
  return Array.from(map.values())
}

async function sendOne(c: CandidateRow): Promise<{ sent: boolean; reason?: string; messageId?: string }> {
  const items = coerceItems(c.items)
  if (items.length === 0) return { sent: false, reason: 'only-gwp' }

  const locale = pickLocale({ contactLocale: c.contact_locale, countryCode: c.country_code })
  const recoveryUrl = buildRecoveryUrl({
    checkout_token: c.checkout_token,
    cart_token: c.cart_token,
    items: items.map((i) => ({ id: i.id, quantity: i.quantity })),
  })
  const unsubscribeToken = signUnsubscribeToken(c.email)
  const unsubscribeUrl = `${adminBase}/api/contact/unsubscribe?t=${unsubscribeToken}`

  const { subject, html, text } = await renderAbandonedCart({
    locale,
    firstName: c.first_name,
    items,
    recoveryUrl,
    unsubscribeUrl,
  })

  if (DRY) {
    console.log(`  [dry] would send to=${c.email} locale=${locale} subject="${subject}" items=${items.length}`)
    return { sent: false, reason: 'dry-run' }
  }
  if (!resend) return { sent: false, reason: 'no-resend-client' }

  const idempotencyKey = `may-8-backfill:${c.id}:1`
  const result = await resend.emails.send(
    {
      from: process.env.RESEND_FROM_EMAIL ?? 'Fancy Palas <hello@fancypalas.com>',
      to: c.email,
      subject,
      html,
      text,
      replyTo: process.env.RESEND_REPLY_TO,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      tags: [
        { name: 'category', value: 'abandoned-cart' },
        { name: 'cart_id', value: c.id },
        { name: 'locale', value: locale },
        { name: 'campaign', value: 'may-8-backfill' },
      ],
    },
    { idempotencyKey },
  )
  if (result.error) return { sent: false, reason: `resend:${result.error.message}` }
  return { sent: true, messageId: result.data?.id }
}

async function markCart(id: string) {
  if (DRY) return
  await sql`
    UPDATE carts
    SET abandon_notified_at = NOW(),
        abandon_notified_count = 1,
        abandon_notified_source = 'manta',
        updated_at = NOW()
    WHERE id = ${id}
      AND COALESCE(abandon_notified_count, 0) < 1`
}

async function fireAndForgetPosthog(c: CandidateRow, locale: string) {
  if (DRY) return
  const items = coerceItems(c.items)
  await sendPosthogEvent({
    event: 'manta_abandoned_cart_sent',
    distinctId: c.distinct_id ?? c.email.toLowerCase(),
    email: c.email,
    properties: {
      cart_id: c.id,
      cart_token: c.cart_token,
      locale,
      item_count: items.length,
      currency: c.currency ?? 'EUR',
      total_price: c.total_price ?? 0,
      source: 'manta',
      campaign: 'may-8-backfill',
      sent_at: new Date().toISOString(),
    },
  })
}

try {
  console.log(`=== May-8 backfill (${DRY ? 'DRY-RUN' : 'LIVE'}) ===`)
  const candidates = await pickCandidates()
  console.log(`Candidates: ${candidates.length}`)
  if (candidates.length === 0) {
    console.log('Nothing to do.')
    process.exit(0)
  }
  console.log(
    `Estimated runtime: ~${Math.round((candidates.length * SLEEP_MS) / 1000 / 60)} min @ ${SLEEP_MS / 1000}s/cart\n`,
  )
  console.log('Press Ctrl-C to stop after the current send.\n')

  let sentCount = 0
  let skippedCount = 0
  let errorCount = 0

  for (let i = 0; i < candidates.length; i++) {
    if (stopRequested) {
      console.log(`\n[stop] aborting before cart ${i + 1}/${candidates.length}`)
      break
    }
    const c = candidates[i]
    const t = new Date().toISOString().slice(11, 19)
    process.stdout.write(
      `[${t}] ${i + 1}/${candidates.length} cart=${c.id.slice(0, 8)}… email=${c.email.padEnd(35)} → `,
    )
    try {
      const out = await sendOne(c)
      if (out.sent) {
        await markCart(c.id)
        const locale = pickLocale({ contactLocale: c.contact_locale, countryCode: c.country_code })
        await fireAndForgetPosthog(c, locale)
        sentCount++
        console.log(`SENT msg=${out.messageId ?? '-'}`)
      } else {
        skippedCount++
        console.log(`SKIP ${out.reason}`)
      }
    } catch (err) {
      errorCount++
      console.log(`ERROR ${(err as Error).message}`)
    }
    if (i < candidates.length - 1 && !stopRequested) {
      await sleep(SLEEP_MS)
    }
  }

  console.log(`\n=== Done — sent=${sentCount} skipped=${skippedCount} errors=${errorCount} ===`)
} finally {
  await sql.end({ timeout: 1 })
}
