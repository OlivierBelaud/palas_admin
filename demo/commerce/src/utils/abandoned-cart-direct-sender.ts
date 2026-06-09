// Direct sender for abandoned-cart emails. Used by:
//   - the production cron `detect-abandoned-carts.ts`
//   - the one-off `scripts/send-may-8-real.ts`
//
// Same business logic as `notify-abandoned-carts-helper.ts` (selection,
// rendering, mark, PostHog), but talks through Manta ports in app runtime so
// Cloudflare/Vercel can use Neon HTTP and provider adapters without importing
// concrete transports into business code.
//
// Two windowing modes (mutually exclusive):
//   - LIVE: last_action_at ∈ [now − maxAgeHours, now − minIdleHours]
//   - DATED: forDate set → last_action_at ∈ that calendar day in Europe/Paris

import { pickLocale } from '../emails/abandoned-cart/pick-locale'
import { renderAbandonedCart } from '../emails/abandoned-cart/render'
import type { RuntimeNotificationPort, RuntimeSql } from './manta-runtime'
import { sendPosthogEvent } from './posthog-ingest'
import { buildRecoveryUrl } from './recovery-url'
import { signUnsubscribeToken } from './unsubscribe-token'

export interface RunOptions {
  sql: RuntimeSql
  notification?: RuntimeNotificationPort | null
  /** Legacy script-only Resend-shaped client. App runtime should use notification. */
  resend?: LegacyResendClient | null
  adminBase: string
  fromEmail: string
  replyTo?: string
  minIdleHours?: number
  maxAgeHours?: number
  forDate?: string
  klaviyoRecentHours?: number
  batchLimit?: number
  dryRun?: boolean
  campaign: string
  log: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void }
  /** Per-cart hook fired between sends; throw to abort. Used by scripts to throttle. */
  onAfterSend?: (i: number, total: number) => Promise<void> | void
}

interface LegacyResendClient {
  emails: {
    send: (
      payload: {
        from: string
        to: string
        subject: string
        html: string
        text: string
        replyTo?: string
        headers?: Record<string, string>
        tags?: Array<{ name: string; value: string }>
      },
      options?: { idempotencyKey?: string },
    ) => Promise<{ data?: { id?: string }; error?: { name?: string; message?: string } }>
  }
}

export interface RunResult {
  scanned: number
  sent: number
  skipped: number
  errors: number
  skipped_optout: number
  skipped_klaviyo: number
  skipped_no_products: number
  skipped_dry_run: number
}

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

const KLAVIYO_ABANDON_METRICS = ['Shopify_Checkout_Abandonned', 'Checkout Abandoned']
const GWP_TITLE_RX = /\b(?:gift|offert|free|charm offert)\b/i

function parisDayBounds(yyyymmdd: string) {
  // CEST = UTC+2 in May; outside CEST this drifts by 1h at midnight.
  return {
    start: new Date(`${yyyymmdd}T00:00:00+02:00`),
    end: new Date(`${yyyymmdd}T23:59:59.999+02:00`),
  }
}

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

export async function runAbandonedCartBackfill(opts: RunOptions): Promise<RunResult> {
  const {
    sql,
    resend,
    notification,
    adminBase,
    fromEmail,
    replyTo,
    minIdleHours = 2.5,
    maxAgeHours = 5,
    forDate,
    klaviyoRecentHours = 12,
    batchLimit = 100,
    dryRun = false,
    campaign,
    log,
    onAfterSend,
  } = opts

  const now = Date.now()
  const klaviyoSince = new Date(now - klaviyoRecentHours * 3600 * 1000)

  let candidates: CandidateRow[]
  if (forDate) {
    const { start, end } = parisDayBounds(forDate)
    candidates = await sql<CandidateRow[]>`
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
        AND COALESCE(c.shopify_order_id, '') = ''
        AND COALESCE(c.status, 'active') != 'completed'
        AND c.highest_stage != 'completed'
        AND (ct.email_marketing_opt_out_at IS NULL)
        AND (ct.klaviyo_suppressed IS NULL OR ct.klaviyo_suppressed = false)
        AND NOT EXISTS (
          SELECT 1 FROM klaviyo_events ke
          WHERE LOWER(ke.email) = LOWER(c.email)
            AND ke.occurred_at >= ${klaviyoSince}
            AND (
              ke.metric = ANY(${KLAVIYO_ABANDON_METRICS})
              OR (ke.metric = 'Received Email' AND (
                ke.subject ILIKE '%oublié quelque chose%'
                OR ke.subject ILIKE '%pensez encore%'
                OR ke.subject ILIKE '%attend plus que vous%'
              ))
            )
        )
      ORDER BY c.last_action_at ASC
      LIMIT ${batchLimit}`
  } else {
    const upperBound = new Date(now - minIdleHours * 3600 * 1000)
    const lowerBound = new Date(now - maxAgeHours * 3600 * 1000)
    candidates = await sql<CandidateRow[]>`
      SELECT
        c.id, c.cart_token, c.checkout_token, c.distinct_id, c.email,
        c.first_name, c.country_code, c.items, c.total_price, c.currency,
        ct.locale AS contact_locale
      FROM carts c
      LEFT JOIN contacts ct ON LOWER(ct.email) = LOWER(c.email)
      WHERE c.last_action_at >= ${lowerBound} AND c.last_action_at <= ${upperBound}
        AND c.email IS NOT NULL
        AND c.items IS NOT NULL AND jsonb_array_length(c.items) > 0
        AND c.highest_stage <> 'completed' AND c.status <> 'completed'
        AND COALESCE(c.abandon_notified_count, 0) < 1
        AND COALESCE(c.shopify_order_id, '') = ''
        AND COALESCE(c.status, 'active') != 'completed'
        AND c.highest_stage != 'completed'
        AND (ct.email_marketing_opt_out_at IS NULL)
        AND (ct.klaviyo_suppressed IS NULL OR ct.klaviyo_suppressed = false)
        AND NOT EXISTS (
          SELECT 1 FROM klaviyo_events ke
          WHERE LOWER(ke.email) = LOWER(c.email)
            AND ke.occurred_at >= ${klaviyoSince}
            AND (
              ke.metric = ANY(${KLAVIYO_ABANDON_METRICS})
              OR (ke.metric = 'Received Email' AND (
                ke.subject ILIKE '%oublié quelque chose%'
                OR ke.subject ILIKE '%pensez encore%'
                OR ke.subject ILIKE '%attend plus que vous%'
              ))
            )
        )
      ORDER BY c.last_action_at ASC
      LIMIT ${batchLimit}`
  }

  const counters: RunResult = {
    scanned: candidates.length,
    sent: 0,
    skipped: 0,
    errors: 0,
    skipped_optout: 0,
    skipped_klaviyo: 0,
    skipped_no_products: 0,
    skipped_dry_run: 0,
  }
  if (candidates.length === 0) return counters

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    const items = coerceItems(c.items)
    if (items.length === 0) {
      counters.skipped++
      counters.skipped_no_products++
      log.info(`[abandoned-cart] skip cart=${c.id} — only-gwp / empty items`)
      continue
    }

    const locale = pickLocale({ contactLocale: c.contact_locale, countryCode: c.country_code })
    const recoveryUrl = buildRecoveryUrl({
      checkout_token: c.checkout_token,
      cart_token: c.cart_token,
      items: items.map((it) => ({ id: it.id, quantity: it.quantity })),
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

    if (dryRun) {
      counters.skipped++
      counters.skipped_dry_run++
      log.info(`[abandoned-cart] dry cart=${c.id} email=${c.email} locale=${locale}`)
      continue
    }
    if (!notification && !resend) {
      counters.errors++
      log.error('[abandoned-cart] notification port missing — skipping')
      continue
    }

    try {
      const idempotencyKey = `${campaign}:${c.id}:1`
      const payload = {
        from: fromEmail,
        to: c.email,
        subject,
        html,
        text,
        replyTo,
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
        tags: [
          { name: 'category', value: 'abandoned-cart' },
          { name: 'cart_id', value: c.id },
          { name: 'locale', value: locale },
          { name: 'campaign', value: campaign },
        ],
      }
      const result = notification
        ? await notification.send({ ...payload, channel: 'email', idempotency_key: idempotencyKey })
        : await resend!.emails.send(payload, { idempotencyKey })
      const error = 'error' in result ? result.error : undefined
      if (error) {
        counters.errors++
        log.error(`[abandoned-cart] notification error cart=${c.id} ${error.message}`)
        continue
      }
      const messageId = 'id' in result ? result.id : result.data?.id

      // Mark with a guarded UPDATE — won't double-mark on race.
      await sql`
        UPDATE carts
        SET abandon_notified_at = NOW(),
            abandon_notified_count = 1,
            abandon_notified_source = 'manta',
            updated_at = NOW()
        WHERE id = ${c.id}
          AND COALESCE(abandon_notified_count, 0) < 1`

      // Fire-and-forget PostHog. Errors don't block the loop.
      try {
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
            campaign,
            sent_at: new Date().toISOString(),
          },
        })
      } catch (err) {
        log.warn(`[abandoned-cart] posthog capture failed cart=${c.id}: ${(err as Error).message}`)
      }

      counters.sent++
      log.info(`[abandoned-cart] sent cart=${c.id} email=${c.email} msg=${messageId ?? '-'}`)
    } catch (err) {
      counters.errors++
      log.error(`[abandoned-cart] threw cart=${c.id}: ${(err as Error).message}`)
    }

    if (onAfterSend) {
      try {
        await onAfterSend(i, candidates.length)
      } catch (err) {
        log.warn(`[abandoned-cart] onAfterSend aborted: ${(err as Error).message}`)
        break
      }
    }
  }
  return counters
}
