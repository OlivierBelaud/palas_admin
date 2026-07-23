// Standalone helper: render + send the abandoned-cart email for one cart.
// Pure function over (cart + contact + adapter) — no framework wiring.
// Used by the explicit operator smoke script and retained legacy
// characterization tests. It is not a registered production command; real
// campaign sends go through `runAbandonedCartCampaign`. Keep this file
// infra-light: nothing here pulls
// `step.service` or other workflow primitives.
//
// Idempotence: callers may pass an explicit `idempotencyKey`. By default we
// derive one from `cart.id` + `abandon_notified_count` so a re-run for a
// cart that hasn't been re-incremented is treated as a duplicate by Resend.

import { buildEmailLinkTrackingParams } from '../../utils/email-link-tracking'
import { buildRecoveryUrl } from '../../utils/recovery-url'
import { signUnsubscribeToken } from '../../utils/unsubscribe-token'
import type { AbandonedCartItem } from './AbandonedCartEmail'

// Local structural shape of the INotificationPort `send` we depend on. We
// can't import the full type from @mantajs/core in app code (lint forbids it
// because the framework's primitives are globals at runtime). Keeping the
// shape duplicated here is intentional: it locks the local contract and
// fails loudly if the framework's port surface drifts.
export interface NotificationSend {
  send(notification: {
    to: string
    channel: string
    from?: string
    replyTo?: string | string[]
    subject?: string
    html?: string
    text?: string
    headers?: Record<string, string>
    tags?: Array<{ name: string; value: string }>
    idempotency_key?: string
  }): Promise<{ status: 'SUCCESS' | 'FAILURE' | 'PENDING'; id?: string; error?: Error }>
}

import { pickLocale } from './pick-locale'
import { renderAbandonedCart } from './render'
import type { Locale } from './strings'

interface CartLike {
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

interface ContactLike {
  locale?: string | null
  email_marketing_opt_out_at?: Date | string | null
  klaviyo_suppressed?: boolean | null
}

interface BasicLogger {
  info: (msg: string) => void
  warn: (msg: string) => void
}

export interface SendAbandonedCartEmailInput {
  cart: CartLike
  contact: ContactLike | null
  notification: NotificationSend
  dryRun: boolean
  idempotencyKey?: string
  localeOverride?: Locale
  log: BasicLogger
}

export interface SendAbandonedCartEmailResult {
  sent: boolean
  messageId?: string
  locale: Locale
  to: string | null
  subject: string
  html: string
  text: string
  skipped?: 'no-email' | 'no-products' | 'dry-run' | 'opt-out'
  error?: string
}

// Title pattern for Gift With Purchase / charm offert / free items added
// automatically by Shopify promo rules. Matches "Gift - Your new charm",
// "Votre charm offert", "Free <whatever>" — the catalog uses these names
// consistently. We filter by TITLE (not by line_price) because older
// ingested carts may not have line_price populated even on real products.
const GWP_TITLE_RX = /\b(?:gift|offert|free|charm offert)\b/i

/**
 * Coerce the cart.items column (JSONB / unknown) into typed rows.
 *  - Filters out GWP / "Gift" items (auto-added cadeaux, the customer didn't choose them)
 *  - Groups lines that share the same variant id (carts can legitimately have
 *    two events producing two rows for the same variant — re-add after remove,
 *    promo split between original and discounted). The DB stays faithful, but
 *    the email shows "2× Coeur Agat" instead of two separate lines — readable
 *    and matches what the customer expects.
 */
function coerceItems(raw: unknown): AbandonedCartItem[] {
  if (!Array.isArray(raw)) return []
  const map = new Map<string, AbandonedCartItem>()
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const title = typeof o.title === 'string' ? o.title : ''
    if (GWP_TITLE_RX.test(title)) continue
    const rawId = typeof o.id === 'string' || typeof o.id === 'number' ? o.id : null
    const key = rawId !== null ? String(rawId) : `__no_id_${map.size}`
    const qty = typeof o.quantity === 'number' && Number.isFinite(o.quantity) ? o.quantity : 1
    // Prefer line_price (post-cart-discount), fall back to price (pre-discount).
    // Older ingested carts may have neither — leave undefined so render skips price.
    const linePrice =
      typeof o.line_price === 'number' && o.line_price > 0
        ? o.line_price
        : typeof o.price === 'number' && o.price > 0
          ? o.price
          : null
    const existing = map.get(key)
    if (existing) {
      existing.quantity += qty
      if (!existing.image_url && typeof o.image_url === 'string') {
        existing.image_url = o.image_url
      }
      // For grouped lines (same variant), sum the line_prices.
      if (typeof linePrice === 'number') {
        existing.line_price = (existing.line_price ?? 0) + linePrice
      }
      continue
    }
    map.set(key, {
      id: rawId,
      title,
      quantity: qty,
      line_price: linePrice,
      image_url: typeof o.image_url === 'string' ? o.image_url : null,
    })
  }
  return Array.from(map.values())
}

export async function sendAbandonedCartEmailForCart(
  input: SendAbandonedCartEmailInput,
): Promise<SendAbandonedCartEmailResult> {
  const { cart, contact, notification, dryRun, log } = input

  // 1. Bail early if there's no recipient.
  if (!cart.email || cart.email.length === 0) {
    log.info(`[abandoned-cart] cart=${cart.id} has no email — skipping`)
    return {
      sent: false,
      skipped: 'no-email',
      locale: 'fr',
      to: null,
      subject: '',
      html: '',
      text: '',
    }
  }

  if (contact?.email_marketing_opt_out_at || contact?.klaviyo_suppressed === true) {
    log.info(`[abandoned-cart] cart=${cart.id} contact opted out — skipping`)
    return {
      sent: false,
      skipped: 'opt-out',
      locale: 'fr',
      to: cart.email,
      subject: '',
      html: '',
      text: '',
    }
  }

  // 2. Resolve locale (explicit override > navigation language > country > contact) and recovery URL.
  const locale =
    input.localeOverride ??
    pickLocale({
      browserLocale: cart.browser_locale ?? null,
      contactLocale: contact?.locale ?? null,
      countryCode: cart.country_code,
    })

  const itemsArr = coerceItems(cart.items)

  // 2.5. Skip if the cart only contained GWPs / cadeaux. Sending "voilà ton
  //      panier" with nothing meaningful in it = noise + bad signal to the
  //      customer ("you wanted that?"). Better to wait for a real cart.
  if (itemsArr.length === 0) {
    log.info(`[abandoned-cart] cart=${cart.id} — only GWP items, skipping`)
    return {
      sent: false,
      skipped: 'no-products',
      locale,
      to: cart.email,
      subject: '',
      html: '',
      text: '',
    }
  }

  const idempotencyKey = input.idempotencyKey ?? `abandoned-cart:${cart.id}:${cart.abandon_notified_count ?? 0}`
  const sequenceStep = Math.max(1, Math.floor(Number(cart.abandon_notified_count ?? 0)) + 1)
  const recoveryUrl = buildRecoveryUrl(
    {
      checkout_token: cart.checkout_token,
      cart_token: cart.cart_token,
      items: itemsArr.map((it) => ({ id: it.id, quantity: it.quantity })),
    },
    {
      trackingParams: buildEmailLinkTrackingParams({
        email: cart.email,
        campaign: 'abandoned_cart',
        messageType: `abandoned_cart_${sequenceStep}`,
        messageId: idempotencyKey,
        sequenceVersion: 1,
        sequenceStep,
        cartId: cart.id,
        cartToken: cart.cart_token,
      }),
    },
  )

  // 3. Unsubscribe URL — RFC-8058 one-click endpoint backed by a signed token
  //    over the recipient email. The token is HMAC-SHA256 with no TTL — emails
  //    may be opened months later and the link must keep working.
  const adminBase = (process.env.ADMIN_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
  const unsubscribeToken = signUnsubscribeToken(cart.email)
  const unsubscribeUrl = `${adminBase}/api/contact/unsubscribe?t=${unsubscribeToken}`

  // 4. Render once. Even in dry-run we render so the script can preview.
  //    Currency is still passed through for future template variants. V1 keeps
  //    product prices out of the email.
  const { subject, html, text } = await renderAbandonedCart({
    locale,
    firstName: cart.first_name,
    items: itemsArr,
    currency: cart.currency ?? 'EUR',
    recoveryUrl,
    unsubscribeUrl,
  })

  // 5. Dry-run short-circuits before the network call.
  if (dryRun) {
    log.info(`[abandoned-cart] cart=${cart.id} dry-run — locale=${locale} subject="${subject}"`)
    return {
      sent: false,
      skipped: 'dry-run',
      locale,
      to: cart.email,
      subject,
      html,
      text,
    }
  }

  // 6. Live send.
  const result = await notification.send({
    to: cart.email,
    channel: 'email',
    replyTo: process.env.RESEND_REPLY_TO,
    subject,
    html,
    text,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    tags: [
      { name: 'category', value: 'abandoned-cart' },
      { name: 'cart_id', value: cart.id },
      { name: 'locale', value: locale },
    ],
    idempotency_key: idempotencyKey,
  })

  if (result.status !== 'SUCCESS') {
    log.warn(
      `[abandoned-cart] cart=${cart.id} send failed status=${result.status} error=${result.error?.message ?? '-'}`,
    )
  }

  return {
    sent: result.status === 'SUCCESS',
    messageId: result.id,
    locale,
    to: cart.email,
    subject,
    html,
    text,
    error: result.error?.message,
  }
}
