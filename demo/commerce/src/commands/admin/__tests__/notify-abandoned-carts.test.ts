// Unit tests for the pure orchestration helper that backs the
// notifyAbandonedCarts command. All deps are mocked — no framework boot.
//
// Covers the eligibility matrix the spec requires:
//   - 1st send (count=0) → SEND, mark count=1
//   - count>=1 → never selected (SQL where), and never sent (race guard)
//   - opt-out / klaviyo_suppressed contact → SKIP
//   - recent (<12h) klaviyo abandonment-flow event → SKIP
//   - older (>12h) klaviyo event → SEND
//   - cart with empty items → SKIP
//   - dryRun → render, don't send, don't mark
//   - forDate=YYYY-MM-DD → window switches to that Paris-day, ignores idle/age
//   - last_action_at outside window → not selected (verified via buildSelectionWhere)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotificationSend } from '../../../emails/abandoned-cart/send-for-cart'
import {
  buildSelectionWhere,
  type CartContactLinkReadRepo,
  type CartContactLinkRow,
  type CartRepo,
  type ContactLookupRow,
  type ContactReadRepo,
  type EligibleCart,
  isAbandonmentFlowEvent,
  type KlaviyoEventLookupRow,
  type KlaviyoEventReadRepo,
  runNotifyAbandonedCarts,
} from '../../../utils/notify-abandoned-carts-helper'

// ── Fixtures ───────────────────────────────────────────────────────────

const NOW = new Date('2026-05-09T12:00:00Z')

function makeCart(over: Partial<EligibleCart> = {}): EligibleCart {
  return {
    id: 'cart_1',
    cart_token: 'tok_1',
    checkout_token: 'co_1',
    distinct_id: null,
    email: 'shopper@test.com',
    first_name: 'Alice',
    last_name: null,
    phone: null,
    city: null,
    country_code: 'FR',
    items: [{ id: 'v1', title: 'Bracelet Solana', quantity: 1 }],
    total_price: 39.9,
    item_count: 1,
    currency: 'EUR',
    highest_stage: 'cart',
    status: 'active',
    last_action: 'add_to_cart',
    last_action_at: new Date(NOW.getTime() - 4 * 3600 * 1000),
    abandon_notified_at: null,
    abandon_notified_count: 0,
    ...over,
  }
}

class FakeNotification implements NotificationSend {
  public sent: Array<Parameters<NotificationSend['send']>[0]> = []
  async send(notification: Parameters<NotificationSend['send']>[0]) {
    this.sent.push(notification)
    return { status: 'SUCCESS' as const, id: `msg_${this.sent.length}` }
  }
}

class FailingNotification implements NotificationSend {
  async send(_n: Parameters<NotificationSend['send']>[0]) {
    return { status: 'FAILURE' as const, error: new Error('Resend down') }
  }
}

function makeCartRepo(initial: EligibleCart[]): CartRepo & {
  updates: Array<{ id: string; [k: string]: unknown }>
} {
  const updates: Array<{ id: string; [k: string]: unknown }> = []
  return {
    list: vi.fn(async (_where: Record<string, unknown>) => initial.map((c) => ({ ...c }))),
    update: vi.fn(async (patch) => {
      updates.push(patch)
      return patch
    }),
    updates,
  }
}

function makeContactRepo(initial: ContactLookupRow[] = []): ContactReadRepo & { rows: ContactLookupRow[] } {
  const rows = [...initial]
  return {
    list: vi.fn(async (where: Record<string, unknown>) => {
      const emailFilter = where.email as { $in?: string[] } | undefined
      if (emailFilter?.$in) {
        const lc = new Set(emailFilter.$in.map((e) => e.toLowerCase()))
        return rows.filter((r) => lc.has(r.email.toLowerCase()))
      }
      return rows
    }),
    retrieve: vi.fn(async (id: string) => rows.find((r) => r.id === id) ?? null),
    rows,
  }
}

function makeKlaviyoEventRepo(initial: KlaviyoEventLookupRow[] = []): KlaviyoEventReadRepo {
  const rows = [...initial]
  return {
    list: vi.fn(async (where: Record<string, unknown>) => {
      const emailFilter = where.email as { $in?: string[] } | undefined
      const occurredFilter = where.occurred_at as { $gte?: Date } | undefined
      const metricFilter = where.metric as { $in?: string[] } | undefined
      const emails = emailFilter?.$in ? new Set(emailFilter.$in.map((e) => e.toLowerCase())) : null
      const since = occurredFilter?.$gte instanceof Date ? occurredFilter.$gte : null
      const metrics = metricFilter?.$in ? new Set(metricFilter.$in) : null
      return rows.filter((r) => {
        if (emails && !emails.has(r.email.toLowerCase())) return false
        if (metrics && !metrics.has(r.metric)) return false
        if (since) {
          const occurred = r.occurred_at instanceof Date ? r.occurred_at : new Date(r.occurred_at)
          if (occurred.getTime() < since.getTime()) return false
        }
        return true
      })
    }),
  }
}

function makeLinkRepo(links: CartContactLinkRow[] = []): CartContactLinkReadRepo {
  return {
    list: vi.fn(async (where: Record<string, unknown>) =>
      links.filter((l) => Object.entries(where).every(([k, v]) => (l as unknown as Record<string, unknown>)[k] === v)),
    ),
  }
}

const log = {
  info: () => {},
  warn: () => {},
  error: () => {},
}

const baseInput = {
  minIdleHours: 2.5,
  maxAgeHours: 5,
  batchLimit: 100,
  dryRun: false,
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

// ── Suite: pure predicates ─────────────────────────────────────────────

describe('isAbandonmentFlowEvent', () => {
  it('Shopify_Checkout_Abandonned metric → true', () => {
    expect(
      isAbandonmentFlowEvent({
        metric: 'Shopify_Checkout_Abandonned',
        email: 'a@b.com',
        subject: null,
        occurred_at: NOW,
      }),
    ).toBe(true)
  })
  it('Checkout Abandoned metric → true', () => {
    expect(
      isAbandonmentFlowEvent({ metric: 'Checkout Abandoned', email: 'a@b.com', subject: null, occurred_at: NOW }),
    ).toBe(true)
  })
  it('Received Email + matching subject "oublié quelque chose" → true', () => {
    expect(
      isAbandonmentFlowEvent({
        metric: 'Received Email',
        email: 'a@b.com',
        subject: 'Vous avez oublié quelque chose',
        occurred_at: NOW,
      }),
    ).toBe(true)
  })
  it('Received Email + unrelated subject → false', () => {
    expect(
      isAbandonmentFlowEvent({
        metric: 'Received Email',
        email: 'a@b.com',
        subject: 'Newsletter de la semaine',
        occurred_at: NOW,
      }),
    ).toBe(false)
  })
  it('unrelated metric → false', () => {
    expect(isAbandonmentFlowEvent({ metric: 'Placed Order', email: 'a@b.com', subject: null, occurred_at: NOW })).toBe(
      false,
    )
  })
})

describe('buildSelectionWhere', () => {
  it('LIVE: produces the documented filter shape with default minIdle=2.5h / maxAge=5h', () => {
    const where = buildSelectionWhere({ minIdleHours: 2.5, maxAgeHours: 5, batchLimit: 100, now: NOW })
    expect(where.email).toEqual({ $notnull: true })
    expect(where.highest_stage).toEqual({ $ne: 'completed' })
    expect(where.status).toEqual({ $ne: 'completed' })
    expect(where.items).toEqual({ $notnull: true })
    expect(where.abandon_notified_count).toEqual({ $lt: 1 })
    const window = where.last_action_at as { $gte: Date; $lte: Date }
    expect(window.$gte.getTime()).toBe(NOW.getTime() - 5 * 3600 * 1000)
    expect(window.$lte.getTime()).toBe(NOW.getTime() - 2.5 * 3600 * 1000)
  })

  it('BACKFILL: forDate switches to a calendar day in Europe/Paris', () => {
    const where = buildSelectionWhere({
      minIdleHours: 2.5,
      maxAgeHours: 5,
      batchLimit: 100,
      forDate: '2026-05-08',
      now: NOW,
    })
    const window = where.last_action_at as { $gte: Date; $lte: Date }
    // 2026-05-08T00:00:00+02:00 = 2026-05-07T22:00:00Z
    expect(window.$gte.toISOString()).toBe('2026-05-07T22:00:00.000Z')
    // 2026-05-08T23:59:59.999+02:00 = 2026-05-08T21:59:59.999Z
    expect(window.$lte.toISOString()).toBe('2026-05-08T21:59:59.999Z')
    // Other predicates unchanged
    expect(where.abandon_notified_count).toEqual({ $lt: 1 })
  })
})

// ── Suite: runNotifyAbandonedCarts integration over fakes ──────────────

describe('runNotifyAbandonedCarts', () => {
  it('sends when cart never notified (count=0) — marks cart with count=1 + notified_at', async () => {
    const cart = makeCart()
    const cartRepo = makeCartRepo([cart])
    const notification = new FakeNotification()
    const out = await runNotifyAbandonedCarts(baseInput, {
      cart: cartRepo,
      contact: makeContactRepo(),
      klaviyoEvent: makeKlaviyoEventRepo(),
      cartContactLink: makeLinkRepo(),
      notification,
      log,
    })
    expect(out.notified).toBe(1)
    expect(out.skipped).toBe(0)
    expect(out.errors).toBe(0)
    expect(notification.sent).toHaveLength(1)
    expect(cartRepo.updates).toEqual([
      { id: 'cart_1', abandon_notified_at: NOW, abandon_notified_count: 1, abandon_notified_source: 'manta' },
    ])
  })

  it('belt-and-braces race guard: skips a cart whose count was bumped to 1 between SELECT and iteration', async () => {
    // Simulate the race by giving the carts repo a row that bypasses the SQL
    // where (count would have filtered it out, but a concurrent run updated it).
    const cart = makeCart({
      abandon_notified_count: 1,
      abandon_notified_at: new Date(NOW.getTime() - 30 * 3600 * 1000),
    })
    const cartRepo = makeCartRepo([cart])
    const notification = new FakeNotification()
    const out = await runNotifyAbandonedCarts(baseInput, {
      cart: cartRepo,
      contact: makeContactRepo(),
      klaviyoEvent: makeKlaviyoEventRepo(),
      cartContactLink: makeLinkRepo(),
      notification,
      log,
    })
    expect(out.notified).toBe(0)
    expect(out.skipped).toBe(1)
    expect(notification.sent).toHaveLength(0)
    expect(cartRepo.updates).toHaveLength(0)
  })

  it('skips when contact has email_marketing_opt_out_at set', async () => {
    const cart = makeCart({ email: 'optout@test.com' })
    const cartRepo = makeCartRepo([cart])
    const contactRepo = makeContactRepo([
      {
        id: 'co_1',
        email: 'optout@test.com',
        locale: 'fr-FR',
        email_marketing_opt_out_at: new Date('2026-04-01T00:00:00Z'),
        klaviyo_suppressed: false,
      },
    ])
    const notification = new FakeNotification()
    const out = await runNotifyAbandonedCarts(baseInput, {
      cart: cartRepo,
      contact: contactRepo,
      klaviyoEvent: makeKlaviyoEventRepo(),
      cartContactLink: makeLinkRepo(),
      notification,
      log,
    })
    expect(out.notified).toBe(0)
    expect(out.skipped).toBe(1)
    expect(out.skipped_optout).toBe(1)
    expect(notification.sent).toHaveLength(0)
    expect(cartRepo.updates).toHaveLength(0)
  })

  it('skips when contact has klaviyo_suppressed=true', async () => {
    const cart = makeCart({ email: 'suppressed@test.com' })
    const cartRepo = makeCartRepo([cart])
    const contactRepo = makeContactRepo([
      {
        id: 'co_1',
        email: 'suppressed@test.com',
        locale: 'fr-FR',
        email_marketing_opt_out_at: null,
        klaviyo_suppressed: true,
      },
    ])
    const notification = new FakeNotification()
    const out = await runNotifyAbandonedCarts(baseInput, {
      cart: cartRepo,
      contact: contactRepo,
      klaviyoEvent: makeKlaviyoEventRepo(),
      cartContactLink: makeLinkRepo(),
      notification,
      log,
    })
    expect(out.notified).toBe(0)
    expect(out.skipped_optout).toBe(1)
    expect(notification.sent).toHaveLength(0)
  })

  it('skips when there is a recent (<12h, default) klaviyo abandonment-flow event', async () => {
    const cart = makeCart({ email: 'k@test.com' })
    const cartRepo = makeCartRepo([cart])
    const klaviyoRepo = makeKlaviyoEventRepo([
      {
        email: 'k@test.com',
        metric: 'Shopify_Checkout_Abandonned',
        subject: null,
        occurred_at: new Date(NOW.getTime() - 6 * 3600 * 1000), // 6h ago
      },
    ])
    const notification = new FakeNotification()
    const out = await runNotifyAbandonedCarts(baseInput, {
      cart: cartRepo,
      contact: makeContactRepo(),
      klaviyoEvent: klaviyoRepo,
      cartContactLink: makeLinkRepo(),
      notification,
      log,
    })
    expect(out.notified).toBe(0)
    expect(out.skipped_klaviyo_recent).toBe(1)
    expect(notification.sent).toHaveLength(0)
  })

  it('SENDS when the only klaviyo event is older than 12h (default window)', async () => {
    const cart = makeCart({ email: 'k@test.com' })
    const cartRepo = makeCartRepo([cart])
    const klaviyoRepo = makeKlaviyoEventRepo([
      {
        email: 'k@test.com',
        metric: 'Shopify_Checkout_Abandonned',
        subject: null,
        occurred_at: new Date(NOW.getTime() - 24 * 3600 * 1000), // 24h ago
      },
    ])
    const notification = new FakeNotification()
    const out = await runNotifyAbandonedCarts(baseInput, {
      cart: cartRepo,
      contact: makeContactRepo(),
      klaviyoEvent: klaviyoRepo,
      cartContactLink: makeLinkRepo(),
      notification,
      log,
    })
    expect(out.notified).toBe(1)
    expect(out.skipped_klaviyo_recent).toBe(0)
    expect(notification.sent).toHaveLength(1)
  })

  it('respects a custom klaviyoRecentHours override (e.g. 24h)', async () => {
    const cart = makeCart({ email: 'k@test.com' })
    const cartRepo = makeCartRepo([cart])
    const klaviyoRepo = makeKlaviyoEventRepo([
      {
        email: 'k@test.com',
        metric: 'Shopify_Checkout_Abandonned',
        subject: null,
        occurred_at: new Date(NOW.getTime() - 18 * 3600 * 1000), // 18h ago
      },
    ])
    const notification = new FakeNotification()
    const out = await runNotifyAbandonedCarts(
      { ...baseInput, klaviyoRecentHours: 24 },
      {
        cart: cartRepo,
        contact: makeContactRepo(),
        klaviyoEvent: klaviyoRepo,
        cartContactLink: makeLinkRepo(),
        notification,
        log,
      },
    )
    expect(out.notified).toBe(0)
    expect(out.skipped_klaviyo_recent).toBe(1)
  })

  it('skips a cart with empty items array (in-memory guard)', async () => {
    const cart = makeCart({ items: [] })
    const cartRepo = makeCartRepo([cart])
    const notification = new FakeNotification()
    const out = await runNotifyAbandonedCarts(baseInput, {
      cart: cartRepo,
      contact: makeContactRepo(),
      klaviyoEvent: makeKlaviyoEventRepo(),
      cartContactLink: makeLinkRepo(),
      notification,
      log,
    })
    expect(out.notified).toBe(0)
    expect(out.skipped).toBe(1)
    expect(out.skipped_no_products).toBe(1)
    expect(notification.sent).toHaveLength(0)
  })

  it('dryRun=true → renders but does NOT send and does NOT mark', async () => {
    const cart = makeCart()
    const cartRepo = makeCartRepo([cart])
    const notification = new FakeNotification()
    const out = await runNotifyAbandonedCarts(
      { ...baseInput, dryRun: true },
      {
        cart: cartRepo,
        contact: makeContactRepo(),
        klaviyoEvent: makeKlaviyoEventRepo(),
        cartContactLink: makeLinkRepo(),
        notification,
        log,
      },
    )
    expect(out.notified).toBe(0)
    expect(out.skipped_dry_run).toBe(1)
    expect(notification.sent).toHaveLength(0)
    expect(cartRepo.updates).toHaveLength(0)
  })

  it('counts an error when the notification adapter returns FAILURE', async () => {
    const cart = makeCart()
    const cartRepo = makeCartRepo([cart])
    const out = await runNotifyAbandonedCarts(baseInput, {
      cart: cartRepo,
      contact: makeContactRepo(),
      klaviyoEvent: makeKlaviyoEventRepo(),
      cartContactLink: makeLinkRepo(),
      notification: new FailingNotification(),
      log,
    })
    expect(out.notified).toBe(0)
    expect(out.errors).toBe(1)
    expect(cartRepo.updates).toHaveLength(0)
  })

  it('uses the linked contact locale to render EN when contact.locale=en-US', async () => {
    const cart = makeCart({ email: 'us@test.com', country_code: 'US' })
    const cartRepo = makeCartRepo([cart])
    const contactRepo = makeContactRepo([
      {
        id: 'co_1',
        email: 'us@test.com',
        locale: 'en-US',
        email_marketing_opt_out_at: null,
        klaviyo_suppressed: false,
      },
    ])
    const linkRepo = makeLinkRepo([{ cart_id: 'cart_1', contact_id: 'co_1' }])
    const notification = new FakeNotification()
    const out = await runNotifyAbandonedCarts(baseInput, {
      cart: cartRepo,
      contact: contactRepo,
      klaviyoEvent: makeKlaviyoEventRepo(),
      cartContactLink: linkRepo,
      notification,
      log,
    })
    expect(out.notified).toBe(1)
    expect(notification.sent[0].tags).toEqual(expect.arrayContaining([{ name: 'locale', value: 'en' }]))
  })

  it('handles 0 carts cleanly (no DB calls past the initial list)', async () => {
    const cartRepo = makeCartRepo([])
    const contactRepo = makeContactRepo()
    const klaviyoRepo = makeKlaviyoEventRepo()
    const out = await runNotifyAbandonedCarts(baseInput, {
      cart: cartRepo,
      contact: contactRepo,
      klaviyoEvent: klaviyoRepo,
      cartContactLink: makeLinkRepo(),
      notification: new FakeNotification(),
      log,
    })
    expect(out).toEqual({
      scanned: 0,
      notified: 0,
      skipped: 0,
      errors: 0,
      skipped_optout: 0,
      skipped_klaviyo_recent: 0,
      skipped_no_email_helper: 0,
      skipped_no_products: 0,
      skipped_dry_run: 0,
    })
    expect(contactRepo.list).not.toHaveBeenCalled()
  })

  it('aborts the loop early when signal is aborted before iterating', async () => {
    const carts = [makeCart({ id: 'a' }), makeCart({ id: 'b', cart_token: 'tok_b' })]
    const cartRepo = makeCartRepo(carts)
    const notification = new FakeNotification()
    const ctl = new AbortController()
    ctl.abort()
    const out = await runNotifyAbandonedCarts(baseInput, {
      cart: cartRepo,
      contact: makeContactRepo(),
      klaviyoEvent: makeKlaviyoEventRepo(),
      cartContactLink: makeLinkRepo(),
      notification,
      log,
      signal: ctl.signal,
    })
    expect(out.notified).toBe(0)
    expect(notification.sent).toHaveLength(0)
  })

  it('captures PostHog event after a successful send (uses cart.distinct_id when present)', async () => {
    const cart = makeCart({ distinct_id: 'anon_abc123' })
    const cartRepo = makeCartRepo([cart])
    const notification = new FakeNotification()
    const captures: Array<{ event: string; distinctId: string; properties: Record<string, unknown> }> = []
    const out = await runNotifyAbandonedCarts(baseInput, {
      cart: cartRepo,
      contact: makeContactRepo(),
      klaviyoEvent: makeKlaviyoEventRepo(),
      cartContactLink: makeLinkRepo(),
      notification,
      log,
      posthogCapture: async (input) => {
        captures.push(input)
      },
    })
    expect(out.notified).toBe(1)
    expect(captures).toHaveLength(1)
    expect(captures[0].event).toBe('manta_abandoned_cart_sent')
    expect(captures[0].distinctId).toBe('anon_abc123')
    expect(captures[0].properties).toMatchObject({
      cart_id: 'cart_1',
      cart_token: 'tok_1',
      email: 'shopper@test.com',
      item_count: 1,
      currency: 'EUR',
      total_price: 39.9,
      source: 'manta',
    })
    expect(captures[0].properties.locale).toBe('fr')
    expect(captures[0].properties.sent_at).toBe(NOW.toISOString())
  })

  it('PostHog capture falls back to lowercased email when cart.distinct_id is null', async () => {
    const cart = makeCart({ distinct_id: null, email: 'Mixed.Case@TEST.com' })
    const cartRepo = makeCartRepo([cart])
    const notification = new FakeNotification()
    const captures: Array<{ event: string; distinctId: string; properties: Record<string, unknown> }> = []
    await runNotifyAbandonedCarts(baseInput, {
      cart: cartRepo,
      contact: makeContactRepo(),
      klaviyoEvent: makeKlaviyoEventRepo(),
      cartContactLink: makeLinkRepo(),
      notification,
      log,
      posthogCapture: async (input) => {
        captures.push(input)
      },
    })
    expect(captures).toHaveLength(1)
    expect(captures[0].distinctId).toBe('mixed.case@test.com')
  })

  it('PostHog capture failure does NOT block the send/mark pipeline', async () => {
    const cart = makeCart({ distinct_id: 'anon_xyz' })
    const cartRepo = makeCartRepo([cart])
    const notification = new FakeNotification()
    const out = await runNotifyAbandonedCarts(baseInput, {
      cart: cartRepo,
      contact: makeContactRepo(),
      klaviyoEvent: makeKlaviyoEventRepo(),
      cartContactLink: makeLinkRepo(),
      notification,
      log,
      // Simulate a PostHog hiccup — the capture throws. The pipeline must
      // still report notified=1 and the cart must still be marked.
      posthogCapture: async () => {
        throw new Error('PostHog 503')
      },
    })
    expect(out.notified).toBe(1)
    expect(out.errors).toBe(0)
    expect(notification.sent).toHaveLength(1)
    expect(cartRepo.updates).toHaveLength(1)
    expect(cartRepo.updates[0]).toMatchObject({
      id: 'cart_1',
      abandon_notified_count: 1,
      abandon_notified_source: 'manta',
    })
  })
})
