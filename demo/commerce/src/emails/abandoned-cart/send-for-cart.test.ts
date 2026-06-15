// Helper-level integration tests using InMemoryNotificationAdapter directly,
// no full Manta bootstrap. Verifies locale routing + dry-run semantics +
// no-email shortcut.

import { beforeEach, describe, expect, it } from 'vitest'
import { type NotificationSend, sendAbandonedCartEmailForCart } from './send-for-cart'
import { STRINGS } from './strings'

// Local fake adapter — duplicates just enough of InMemoryNotificationAdapter
// to keep these tests at the helper level. We can't import the real one from
// @mantajs/core (lint forbids it in app code).
type SendInput = Parameters<NotificationSend['send']>[0]
type SendResult = Awaited<ReturnType<NotificationSend['send']>>

class FakeNotificationAdapter implements NotificationSend {
  private _sent: Array<{ notification: SendInput; result: SendResult }> = []
  private _failRecipients = new Set<string>()

  configureFailures(recipients: string[]): void {
    this._failRecipients = new Set(recipients)
  }

  async send(notification: SendInput): Promise<SendResult> {
    if (this._failRecipients.has(notification.to)) {
      const result: SendResult = { status: 'FAILURE', error: new Error(`Delivery to ${notification.to} failed`) }
      this._sent.push({ notification, result })
      return result
    }
    const result: SendResult = { status: 'SUCCESS', id: crypto.randomUUID() }
    this._sent.push({ notification, result })
    return result
  }

  getSent() {
    return [...this._sent]
  }
}

const baseCart = {
  id: 'cart_1',
  cart_token: 'tok_abc',
  checkout_token: 'co_xyz',
  email: 'shopper@test.com',
  first_name: 'Alice',
  country_code: 'FR' as string | null,
  items: [
    { id: 'v1', title: 'Bracelet Solana', quantity: 1, line_price: 39.9 },
    { id: 'v2', title: 'Collier Aurora', quantity: 2, line_price: 49.9 },
  ],
  total_price: 89.8,
  currency: 'EUR' as string | null,
  abandon_notified_count: 0,
}

const log = {
  info: () => {},
  warn: () => {},
}

describe('sendAbandonedCartEmailForCart', () => {
  let notification: FakeNotificationAdapter

  beforeEach(() => {
    notification = new FakeNotificationAdapter()
  })

  it('skips when cart.email is null', async () => {
    const out = await sendAbandonedCartEmailForCart({
      cart: { ...baseCart, email: null },
      contact: { locale: 'fr-FR' },
      notification,
      dryRun: false,
      log,
    })

    expect(out.sent).toBe(false)
    expect(out.skipped).toBe('no-email')
    expect(notification.getSent()).toHaveLength(0)
  })

  it('skips when cart.email is empty string', async () => {
    const out = await sendAbandonedCartEmailForCart({
      cart: { ...baseCart, email: '' },
      contact: null,
      notification,
      dryRun: false,
      log,
    })

    expect(out.sent).toBe(false)
    expect(out.skipped).toBe('no-email')
  })

  it('sends FR email when contact locale is fr-FR', async () => {
    const out = await sendAbandonedCartEmailForCart({
      cart: baseCart,
      contact: { locale: 'fr-FR' },
      notification,
      dryRun: false,
      log,
    })

    expect(out.sent).toBe(true)
    expect(out.locale).toBe('fr')
    expect(out.subject).toBe(STRINGS.fr.subject)
    expect(out.to).toBe('shopper@test.com')

    const sent = notification.getSent()
    expect(sent).toHaveLength(1)
    expect(sent[0].notification.channel).toBe('email')
    expect(sent[0].notification.subject).toBe(STRINGS.fr.subject)
    expect(sent[0].notification.tags).toEqual(
      expect.arrayContaining([
        { name: 'category', value: 'abandoned-cart' },
        { name: 'cart_id', value: 'cart_1' },
        { name: 'locale', value: 'fr' },
      ]),
    )
    // RFC 8058 one-click unsubscribe: both headers must be present.
    expect(sent[0].notification.headers).toMatchObject({
      'List-Unsubscribe': expect.stringMatching(/^<.+>$/),
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    })
    // The List-Unsubscribe URL must point to the signed-token endpoint.
    expect(sent[0].notification.headers?.['List-Unsubscribe']).toMatch(/\/api\/contact\/unsubscribe\?t=/)
    expect(sent[0].notification.html).toContain('utm_source=palas_crm')
    expect(sent[0].notification.html).toContain('utm_campaign=abandoned_cart')
    expect(sent[0].notification.html).toContain('utm_content=abandoned_cart_1')
    expect(sent[0].notification.html).toContain('palas_email_sequence_step=1')
    expect(sent[0].notification.html).toContain('palas_cart_token=tok_abc')
    expect(sent[0].notification.html).toContain('u=')
  })

  it('uses contact locale (en-US) only as last resort, when no nav/country signal', async () => {
    const out = await sendAbandonedCartEmailForCart({
      cart: { ...baseCart, country_code: null, browser_locale: null },
      contact: { locale: 'en-US' },
      notification,
      dryRun: false,
      log,
    })

    expect(out.sent).toBe(true)
    expect(out.locale).toBe('en')
    expect(out.subject).toBe(STRINGS.en.subject)
  })

  it('navigation language (browser_locale) wins over a stale contact locale', async () => {
    const out = await sendAbandonedCartEmailForCart({
      // FR shopper whose Shopify contact locale is wrongly en-US, but who
      // browsed the store in French → email must be French.
      cart: { ...baseCart, country_code: 'FR', browser_locale: 'fr-FR' },
      contact: { locale: 'en-US' },
      notification,
      dryRun: false,
      log,
    })

    expect(out.sent).toBe(true)
    expect(out.locale).toBe('fr')
    expect(out.subject).toBe(STRINGS.fr.subject)
  })

  it('FR country beats a stale en-US contact locale (the bug fix)', async () => {
    const out = await sendAbandonedCartEmailForCart({
      cart: { ...baseCart, country_code: 'FR', browser_locale: null },
      contact: { locale: 'en-US' },
      notification,
      dryRun: false,
      log,
    })

    expect(out.sent).toBe(true)
    expect(out.locale).toBe('fr')
    expect(out.subject).toBe(STRINGS.fr.subject)
  })

  it('falls back to country code when no contact locale', async () => {
    const out = await sendAbandonedCartEmailForCart({
      cart: { ...baseCart, country_code: 'US' },
      contact: null,
      notification,
      dryRun: false,
      log,
    })

    expect(out.locale).toBe('en')
    expect(out.subject).toBe(STRINGS.en.subject)
  })

  it('dry-run renders subject/html/text but does NOT send', async () => {
    const out = await sendAbandonedCartEmailForCart({
      cart: baseCart,
      contact: { locale: 'fr-FR' },
      notification,
      dryRun: true,
      log,
    })

    expect(out.sent).toBe(false)
    expect(out.skipped).toBe('dry-run')
    expect(out.subject).toBe(STRINGS.fr.subject)
    expect(out.html.length).toBeGreaterThan(100)
    expect(out.text.length).toBeGreaterThan(20)
    expect(notification.getSent()).toHaveLength(0)
  })

  it('default idempotency key includes cart id and notified count', async () => {
    await sendAbandonedCartEmailForCart({
      cart: { ...baseCart, abandon_notified_count: 2 },
      contact: { locale: 'fr-FR' },
      notification,
      dryRun: false,
      log,
    })

    const sent = notification.getSent()
    expect(sent[0].notification.idempotency_key).toBe('abandoned-cart:cart_1:2')
  })

  it('explicit idempotencyKey overrides default', async () => {
    await sendAbandonedCartEmailForCart({
      cart: baseCart,
      contact: null,
      notification,
      dryRun: false,
      idempotencyKey: 'custom-key',
      log,
    })

    expect(notification.getSent()[0].notification.idempotency_key).toBe('custom-key')
  })

  it('returns error message when adapter returns FAILURE', async () => {
    notification.configureFailures(['shopper@test.com'])

    const out = await sendAbandonedCartEmailForCart({
      cart: baseCart,
      contact: null,
      notification,
      dryRun: false,
      log,
    })

    expect(out.sent).toBe(false)
    expect(out.error).toMatch(/failed/i)
  })
})
