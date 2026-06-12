// Pure helper used by the `notifyAbandonedCarts` command and its unit tests.
// The command itself is the framework boundary (defineCommand + step.*
// proxies); the eligibility/iteration/send-orchestration logic — which we
// want covered by tests — lives here so we can drive it with plain mocks.
//
// One email per cart, ever — `abandon_notified_count < 1` in the SQL where,
// belt-and-braces in the marker code. There is no second tier.
//
// Two-stage filtering:
//   1. SQL where: cheap predicates that the database can do (email present,
//      stage/status not completed, time window, count<1, items present).
//   2. In-memory filter: predicates the framework's where API can't express
//      cleanly:
//        - opt-out / klaviyo_suppressed → join through Contact (by email)
//        - recent Klaviyo native send (≤12h, configurable) → join through
//          klaviyo_events table (subject patterns matched in memory because
//          the operator API has no LIKE/regex)
//        - empty items array
//
// Two windowing modes (mutually exclusive):
//   - LIVE (default): `last_action_at` ∈ [now − maxAgeHours, now − minIdleHours]
//   - DATED (backfill): `forDate` set → `last_action_at` ∈ that calendar day
//     (Europe/Paris). minIdle/maxAge are ignored.
//
// Send pipeline per cart: resolve linked Contact (for locale) → call
// `sendAbandonedCartEmailForCart` → on success, mark the cart
// (abandon_notified_at + abandon_notified_count++).

import { pickLocale } from '../emails/abandoned-cart/pick-locale'
import {
  type NotificationSend,
  type SendAbandonedCartEmailResult,
  sendAbandonedCartEmailForCart,
} from '../emails/abandoned-cart/send-for-cart'

export interface EligibleCart {
  id: string
  cart_token: string
  checkout_token: string | null
  distinct_id: string | null
  email: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  city: string | null
  country_code: string | null
  browser_locale?: string | null
  items: unknown
  total_price: number | null
  item_count: number | null
  currency: string | null
  highest_stage: string
  status: string
  last_action: string
  last_action_at: Date | string
  abandon_notified_at: Date | string | null
  abandon_notified_count: number | null
}

export interface ContactLookupRow {
  id: string
  email: string
  locale?: string | null
  email_marketing_opt_out_at?: Date | string | null
  klaviyo_suppressed?: boolean | null
}

export interface KlaviyoEventLookupRow {
  email: string
  metric: string
  subject: string | null
  occurred_at: Date | string
}

export interface OrderLookupRow {
  email: string
  placed_at: Date | string | null
  status: string
}

export interface CartContactLinkRow {
  cart_id: string
  contact_id: string
}

export interface CartRepo {
  list: (
    where: Record<string, unknown>,
    opts?: { order?: Record<string, 'ASC' | 'DESC'>; take?: number },
  ) => Promise<EligibleCart[]>
  update: (patch: { id: string; [k: string]: unknown }) => Promise<unknown>
}

export interface ContactReadRepo {
  list: (where: Record<string, unknown>) => Promise<ContactLookupRow[]>
  retrieve: (id: string) => Promise<ContactLookupRow | null>
}

export interface KlaviyoEventReadRepo {
  list: (
    where: Record<string, unknown>,
    opts?: { order?: Record<string, 'ASC' | 'DESC'>; take?: number },
  ) => Promise<KlaviyoEventLookupRow[]>
}

export interface OrderReadRepo {
  list: (where: Record<string, unknown>) => Promise<OrderLookupRow[]>
}

export interface CartContactLinkReadRepo {
  list: (where: Record<string, unknown>) => Promise<CartContactLinkRow[]>
}

export interface BasicLogger {
  info: (msg: string) => void
  warn: (msg: string) => void
  error: (msg: string) => void
}

// Klaviyo native abandonment metrics + subject patterns (see legacy HogQL in
// the previous Klaviyo-based command). These are what we treat as evidence
// that Klaviyo's own flow already reached out to the contact recently — when
// present we yield to it and skip our own send.
const KLAVIYO_ABANDON_METRICS = ['Shopify_Checkout_Abandonned', 'Checkout Abandoned']
const KLAVIYO_ABANDON_SUBJECT_PATTERNS = ['oublié quelque chose', 'pensez encore', 'attend plus que vous']

// Default window: any Klaviyo native abandonment email sent within the last
// `klaviyoRecentHours` is grounds to skip (we yield to Klaviyo's flow).
const DEFAULT_KLAVIYO_RECENT_HOURS = 12

// Default 7 days — if the customer placed any order on this email in the last
// week, do NOT send an "abandoned cart" email. Catches Apple Pay / Web Pixel
// bypass where Shopify recorded the order but our event pipeline never marked
// the cart `completed`.
const DEFAULT_RECENT_ORDER_HOURS = 168

export interface SelectionInputs {
  minIdleHours: number
  maxAgeHours: number
  batchLimit: number
  /** When set, ignore minIdleHours/maxAgeHours and only pull carts whose
   *  last_action_at falls on this calendar day in Europe/Paris (YYYY-MM-DD). */
  forDate?: string
  now?: Date
}

export interface RunInputs extends SelectionInputs {
  dryRun: boolean
  /** Skip carts whose email received a Klaviyo native abandonment-flow event
   *  within this many hours. Default 12. */
  klaviyoRecentHours?: number
  /** Skip carts whose email placed an order (Shopify) within this many hours.
   *  Catches Apple Pay / Shopify Web Pixel bypass paths where the cart's own
   *  highest_stage / shopify_order_id may not have been updated by our pipeline.
   *  Default 168h = 7 days (a customer who bought yesterday should not get an
   *  "abandoned cart" relance today). */
  recentOrderHours?: number
}

export interface PosthogCaptureInput {
  event: string
  distinctId: string
  properties: Record<string, unknown>
}

/** Fire-and-forget PostHog capture. MUST never throw — failures are non-blocking. */
export type PosthogCaptureFn = (input: PosthogCaptureInput, log: BasicLogger) => Promise<void>

export interface RunDeps {
  cart: CartRepo
  contact: ContactReadRepo
  klaviyoEvent: KlaviyoEventReadRepo
  cartContactLink: CartContactLinkReadRepo
  /** Read access to the local `orders` table (synced from Shopify). Used to
   *  skip carts whose email has placed any order recently — catches the
   *  Apple Pay / Shopify Web Pixel bypass where the cart's own status was
   *  never updated by our event-driven pipeline. */
  order: OrderReadRepo
  notification: NotificationSend
  log: BasicLogger
  now?: () => Date
  signal?: AbortSignal
  /** Override for tests. In production, defaults to a fire-and-forget POST
   *  to PostHog `/capture/` via `sendPosthogEvent`. */
  posthogCapture?: PosthogCaptureFn
}

export interface RunResult {
  scanned: number
  notified: number
  skipped: number
  errors: number
  skipped_optout: number
  skipped_klaviyo_recent: number
  skipped_recent_order: number
  skipped_no_email_helper: number
  skipped_no_products: number
  skipped_dry_run: number
}

/** Compute [start, end) for a YYYY-MM-DD date in Europe/Paris (CEST = UTC+2 in May). */
function parisDayBounds(yyyymmdd: string): { start: Date; end: Date } {
  // CEST is UTC+2 in May (Mother's Day window). For prod safety we hardcode
  // +02:00 here — accept that this is correct only inside CEST. Outside CEST
  // the date filter would be off by one hour at the day boundary; callers
  // should pass `forDate` only during the abandoned-cart backfill window.
  const start = new Date(`${yyyymmdd}T00:00:00+02:00`)
  const end = new Date(`${yyyymmdd}T23:59:59.999+02:00`)
  return { start, end }
}

/** Build the SQL where clause used to load candidate carts from the cart service. */
export function buildSelectionWhere(input: SelectionInputs): Record<string, unknown> {
  const now = input.now ?? new Date()
  const nowMs = now.getTime()
  let lastActionAt: Record<string, Date>
  if (input.forDate) {
    const { start, end } = parisDayBounds(input.forDate)
    lastActionAt = { $gte: start, $lte: end }
  } else {
    const upperBound = new Date(nowMs - input.minIdleHours * 3600 * 1000)
    const lowerBound = new Date(nowMs - input.maxAgeHours * 3600 * 1000)
    lastActionAt = { $gte: lowerBound, $lte: upperBound }
  }
  return {
    email: { $notnull: true },
    highest_stage: { $ne: 'completed' },
    status: { $ne: 'completed' },
    items: { $notnull: true },
    last_action_at: lastActionAt,
    // Hard cap at one email per cart, ever — enforced both here and at the
    // marker step. Anyone tweaking this must understand the user-facing
    // promise: "personne ne peut recevoir plus d'1 email".
    abandon_notified_count: { $lt: 1 },
    // Belt-and-suspenders : un cart converti côté Shopify peut ne pas avoir
    // mis à jour status/highest_stage si le pixel a raté l'event (~28% des
    // conversions). Si shopify_order_id est posé, le cart a converti.
    shopify_order_id: { $null: true },
  }
}

/** Check whether the cart's items array is non-empty (after JSON coercion). */
export function hasNonEmptyItems(cart: { items: unknown }): boolean {
  return Array.isArray(cart.items) && cart.items.length > 0
}

/** True iff the contact has opted out of marketing or is Klaviyo-suppressed. */
export function isContactOptedOut(contact: ContactLookupRow): boolean {
  if (contact.klaviyo_suppressed === true) return true
  if (contact.email_marketing_opt_out_at != null) return true
  return false
}

/** True iff the Klaviyo event row qualifies as a recent abandonment-flow send for `email`. */
export function isAbandonmentFlowEvent(row: KlaviyoEventLookupRow): boolean {
  if (KLAVIYO_ABANDON_METRICS.includes(row.metric)) return true
  if (row.metric === 'Received Email' && row.subject) {
    const lc = row.subject.toLowerCase()
    return KLAVIYO_ABANDON_SUBJECT_PATTERNS.some((p) => lc.includes(p))
  }
  return false
}

/**
 * Load the opted-out emails for the supplied set. Lowercased on both sides.
 * Returns a Set so caller can do O(1) membership checks.
 */
export async function loadOptedOutEmails(contact: ContactReadRepo, emails: string[]): Promise<Set<string>> {
  if (emails.length === 0) return new Set()
  const rows = await contact.list({ email: { $in: emails } })
  const out = new Set<string>()
  for (const r of rows) {
    if (isContactOptedOut(r)) out.add(r.email.toLowerCase())
  }
  return out
}

/**
 * Load the most-recent abandonment-flow Klaviyo event timestamp per email,
 * for the supplied set, restricted to the configured window. Lowercased on
 * both sides.
 */
export async function loadRecentKlaviyoAbandonByEmail(
  klaviyoEvent: KlaviyoEventReadRepo,
  emails: string[],
  now: Date,
  klaviyoRecentHours: number = DEFAULT_KLAVIYO_RECENT_HOURS,
): Promise<Map<string, Date>> {
  if (emails.length === 0) return new Map()
  const sinceDate = new Date(now.getTime() - klaviyoRecentHours * 3600 * 1000)
  // Pull both metric variants in one call. The framework's $in operator is
  // the cleanest expression — we then filter the "Received Email" subject
  // patterns in memory because LIKE/regex aren't part of the operator set.
  const rows = await klaviyoEvent.list(
    {
      email: { $in: emails },
      occurred_at: { $gte: sinceDate },
      metric: { $in: [...KLAVIYO_ABANDON_METRICS, 'Received Email'] },
    },
    { order: { occurred_at: 'DESC' } },
  )
  const out = new Map<string, Date>()
  for (const r of rows) {
    if (!isAbandonmentFlowEvent(r)) continue
    const occurred = r.occurred_at instanceof Date ? r.occurred_at : new Date(r.occurred_at)
    const key = r.email.toLowerCase()
    const existing = out.get(key)
    if (!existing || existing.getTime() < occurred.getTime()) out.set(key, occurred)
  }
  return out
}

/**
 * Load the set of emails (lowercased) that have placed at least one order
 * (status in 'paid' / 'fulfilled') within the supplied window. Returns a Set
 * so caller can do O(1) membership checks.
 *
 * Why this exists: most past Shopify orders bypassed our PostHog proxy (Apple
 * Pay, Web Pixel server-side route). The cart row associated with the email
 * was therefore never marked `highest_stage='completed'`. Without this filter
 * the abandoned-cart relance fires emails to people who literally just bought.
 */
export async function loadRecentOrderEmails(
  order: OrderReadRepo,
  emails: string[],
  now: Date,
  recentOrderHours: number = DEFAULT_RECENT_ORDER_HOURS,
): Promise<Set<string>> {
  if (emails.length === 0) return new Set()
  const since = new Date(now.getTime() - recentOrderHours * 3600 * 1000)
  const rows = await order.list({
    email: { $in: emails },
    placed_at: { $gte: since },
    status: { $in: ['paid', 'fulfilled'] },
  })
  const out = new Set<string>()
  for (const r of rows) {
    if (r.email) out.add(r.email.toLowerCase())
  }
  return out
}

/**
 * Resolve the linked Contact for a cart (1:1 link). Returns null if the cart
 * is not yet linked (stays compatible with the helper which only needs locale).
 */
export async function resolveCartContact(
  cartContactLink: CartContactLinkReadRepo,
  contact: ContactReadRepo,
  cartId: string,
): Promise<ContactLookupRow | null> {
  const links = await cartContactLink.list({ cart_id: cartId })
  const contactId = links[0]?.contact_id
  if (!contactId) return null
  return await contact.retrieve(contactId)
}

/**
 * Default PostHog capture: thin wrapper around `sendPosthogEvent`. Swallows
 * any error — PostHog visibility must NEVER block the email pipeline.
 */
export async function defaultPosthogCapture(input: PosthogCaptureInput, log: BasicLogger): Promise<void> {
  try {
    const { sendPosthogEvent } = await import('./posthog-ingest')
    const res = await sendPosthogEvent({
      event: input.event,
      distinctId: input.distinctId,
      properties: input.properties,
    })
    if (!res.ok) {
      log.warn(`[notifyAbandonedCarts] PostHog capture non-OK: ${res.error ?? `status=${res.status ?? '?'}`}`)
    }
  } catch (err) {
    log.warn(`[notifyAbandonedCarts] PostHog capture threw (non-blocking): ${(err as Error).message}`)
  }
}

/**
 * Run the full notify pipeline. Pure orchestration over the supplied repos /
 * notification port. Returns the aggregated counters that the command logs.
 */
export async function runNotifyAbandonedCarts(input: RunInputs, deps: RunDeps): Promise<RunResult> {
  const now = deps.now ? deps.now() : new Date()
  const counters: RunResult = {
    scanned: 0,
    notified: 0,
    skipped: 0,
    errors: 0,
    skipped_optout: 0,
    skipped_klaviyo_recent: 0,
    skipped_recent_order: 0,
    skipped_no_email_helper: 0,
    skipped_no_products: 0,
    skipped_dry_run: 0,
  }

  const where = buildSelectionWhere({ ...input, now })
  const carts = await deps.cart.list(where, { order: { last_action_at: 'ASC' }, take: input.batchLimit })
  counters.scanned = carts.length
  if (carts.length === 0) {
    deps.log.info('[notifyAbandonedCarts] no eligible carts')
    return counters
  }

  // Lowercased emails of every loaded cart — used to bound the contact +
  // klaviyo_event lookups so we don't scan the whole table.
  const cartEmails = Array.from(
    new Set(carts.map((c) => (c.email ? c.email.toLowerCase() : '')).filter((e): e is string => e.length > 0)),
  )

  const [optedOut, klaviyoRecent, recentOrderEmails] = await Promise.all([
    loadOptedOutEmails(deps.contact, cartEmails),
    loadRecentKlaviyoAbandonByEmail(deps.klaviyoEvent, cartEmails, now, input.klaviyoRecentHours),
    loadRecentOrderEmails(deps.order, cartEmails, now, input.recentOrderHours),
  ])

  for (const cart of carts) {
    if (deps.signal?.aborted) break

    // Belt-and-braces hard cap. The SQL where already filters
    // abandon_notified_count<1 — this guard catches a race where the row was
    // updated between the SELECT and now, ensuring no cart ever gets two.
    if ((cart.abandon_notified_count ?? 0) >= 1) {
      counters.skipped++
      deps.log.warn(`[notifyAbandonedCarts] skip cart=${cart.id} — already notified (race after SELECT)`)
      continue
    }

    if (!hasNonEmptyItems(cart)) {
      counters.skipped++
      counters.skipped_no_products++
      deps.log.info(`[notifyAbandonedCarts] skip cart=${cart.id} — empty items array`)
      continue
    }

    const emailLc = cart.email ? cart.email.toLowerCase() : ''
    if (emailLc && optedOut.has(emailLc)) {
      counters.skipped++
      counters.skipped_optout++
      deps.log.info(`[notifyAbandonedCarts] skip cart=${cart.id} — contact opted out`)
      continue
    }

    if (emailLc && klaviyoRecent.has(emailLc)) {
      counters.skipped++
      counters.skipped_klaviyo_recent++
      deps.log.info(
        `[notifyAbandonedCarts] skip cart=${cart.id} — recent Klaviyo native abandonment email at ${klaviyoRecent
          .get(emailLc)
          ?.toISOString()}`,
      )
      continue
    }

    if (emailLc && recentOrderEmails.has(emailLc)) {
      counters.skipped++
      counters.skipped_recent_order++
      deps.log.info(
        `[notifyAbandonedCarts] skip cart=${cart.id} — email ${emailLc} placed an order within recentOrderHours window`,
      )
      continue
    }

    // Resolve the linked Contact (for locale). Helper handles missing email
    // and empty items defensively, so a failure here shouldn't block the run.
    const contact = await resolveCartContact(deps.cartContactLink, deps.contact, cart.id)

    let result: SendAbandonedCartEmailResult
    try {
      result = await sendAbandonedCartEmailForCart({
        cart: {
          id: cart.id,
          cart_token: cart.cart_token,
          checkout_token: cart.checkout_token,
          email: cart.email,
          first_name: cart.first_name,
          country_code: cart.country_code,
          browser_locale: cart.browser_locale ?? null,
          items: cart.items,
          total_price: cart.total_price,
          currency: cart.currency,
          abandon_notified_count: cart.abandon_notified_count,
        },
        contact: contact ? { locale: contact.locale ?? null } : null,
        notification: deps.notification,
        dryRun: input.dryRun,
        log: deps.log,
      })
    } catch (err) {
      counters.errors++
      deps.log.error(`[notifyAbandonedCarts] send threw cart=${cart.id} err=${(err as Error).message}`)
      continue
    }

    if (result.sent) {
      const nextCount = (cart.abandon_notified_count ?? 0) + 1
      try {
        await deps.cart.update({
          id: cart.id,
          abandon_notified_at: now,
          abandon_notified_count: nextCount,
          abandon_notified_source: 'manta',
        })
        counters.notified++
      } catch (err) {
        counters.errors++
        deps.log.error(
          `[notifyAbandonedCarts] mark failed cart=${cart.id} (email already sent) err=${(err as Error).message}`,
        )
      }

      // Fire-and-forget PostHog capture for analytics/funnels/debugging.
      // Resolved AFTER the cart update so a PostHog hiccup never breaks
      // idempotence. distinctId prefers cart.distinct_id (the same anonymous
      // id the storefront pixel used), falls back to lowercased email so a
      // person identified later can still merge with this event.
      const distinctId =
        cart.distinct_id && cart.distinct_id.length > 0 ? cart.distinct_id : (cart.email ?? '').toLowerCase()
      if (distinctId) {
        const captureLocale = pickLocale({
          browserLocale: cart.browser_locale ?? null,
          contactLocale: contact?.locale ?? null,
          countryCode: cart.country_code,
        })
        const capture = deps.posthogCapture ?? defaultPosthogCapture
        // Defense-in-depth: even if the injected capture throws against its
        // contract, we MUST NOT let it break the send/mark pipeline.
        try {
          await capture(
            {
              event: 'manta_abandoned_cart_sent',
              distinctId,
              properties: {
                cart_id: cart.id,
                cart_token: cart.cart_token,
                email: cart.email,
                locale: captureLocale,
                item_count: cart.item_count,
                currency: cart.currency,
                total_price: cart.total_price,
                source: 'manta',
                sent_at: now.toISOString(),
              },
            },
            deps.log,
          )
        } catch (err) {
          deps.log.warn(
            `[notifyAbandonedCarts] PostHog capture wrapper threw cart=${cart.id} err=${(err as Error).message}`,
          )
        }
      }
      continue
    }

    if (result.skipped === 'no-email') {
      counters.skipped++
      counters.skipped_no_email_helper++
    } else if (result.skipped === 'no-products') {
      counters.skipped++
      counters.skipped_no_products++
    } else if (result.skipped === 'dry-run') {
      counters.skipped++
      counters.skipped_dry_run++
    } else {
      counters.errors++
      deps.log.error(`[notifyAbandonedCarts] send returned non-success cart=${cart.id} error=${result.error ?? '-'}`)
    }
  }

  return counters
}
