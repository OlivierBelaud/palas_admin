// Pure helper used by `syncKlaviyoEvents` after the upsert step. Given a
// batch of freshly-ingested Klaviyo events, finds the carts whose email
// matches an abandonment-flow event and marks them as notified by Klaviyo —
// but ONLY if they aren't already marked (we never overwrite an existing
// `abandon_notified_at`, whether it came from Manta or from a previous
// Klaviyo ingestion).
//
// Why this exists: we want a unified `cart.abandon_notified_at` /
// `abandon_notified_source` record that's true regardless of who actually
// sent the email. Manta's own cron writes `'manta'`; this helper writes
// `'klaviyo'` when Klaviyo's native flow reached the customer first.
//
// One SQL SELECT bounded by (email IN [emails of ingested events] AND
// abandon_notified_at IS NULL). Then one UPDATE per match. The race against
// the Manta cron is acceptable: both flows ultimately set count=1 + a
// timestamp; if both fire near-simultaneously we keep the first write
// thanks to the `IS NULL` SELECT predicate.

import { isAbandonmentFlowEvent, type KlaviyoEventLookupRow } from './notify-abandoned-carts-helper'

export interface CartMarkingRow {
  id: string
  email: string | null
  abandon_notified_at: Date | string | null
  abandon_notified_count: number | null
}

export interface CartMarkingRepo {
  list: (where: Record<string, unknown>) => Promise<CartMarkingRow[]>
  update: (patch: { id: string; [k: string]: unknown }) => Promise<unknown>
}

export interface BasicLogger {
  info: (msg: string) => void
  warn: (msg: string) => void
  error: (msg: string) => void
}

export interface MarkResult {
  /** Number of carts updated with source='klaviyo'. */
  carts_marked_klaviyo: number
  /** Number of distinct emails in the abandonment-flow events that we considered. */
  emails_considered: number
  /** Carts found matching by email but skipped because already notified. */
  carts_skipped_already_notified: number
}

const EMPTY: MarkResult = {
  carts_marked_klaviyo: 0,
  emails_considered: 0,
  carts_skipped_already_notified: 0,
}

/** Look-back window for the cart match — we don't want to mark a cart that's
 *  much older than the event itself (would always be wrong attribution). */
const MATCH_LOOKBACK_DAYS = 30

/**
 * Given a batch of Klaviyo event rows just ingested, mark every matching
 * cart's `abandon_notified_at` / `abandon_notified_source = 'klaviyo'` /
 * `abandon_notified_count = 1` — but only when the cart was not already
 * notified.
 *
 * Idempotent: re-running with the same input is a no-op (the SELECT filters
 * on `abandon_notified_at IS NULL`, second pass finds nothing).
 */
export async function markCartsFromKlaviyoEvents(
  events: ReadonlyArray<{ email: string; metric: string; subject: string | null; occurred_at: Date | string }>,
  cart: CartMarkingRepo,
  log: BasicLogger,
  now: Date = new Date(),
): Promise<MarkResult> {
  if (events.length === 0) return { ...EMPTY }

  // 1. Pick the earliest abandonment-flow event per email — that's the one
  //    we attribute. Multiple events for the same email (3-step flow) all
  //    collapse to a single update.
  const earliestByEmail = new Map<string, Date>()
  for (const ev of events) {
    if (!isAbandonmentFlowEvent(ev as KlaviyoEventLookupRow)) continue
    const email = ev.email.trim().toLowerCase()
    if (!email) continue
    const occurred = ev.occurred_at instanceof Date ? ev.occurred_at : new Date(ev.occurred_at)
    if (Number.isNaN(occurred.getTime())) continue
    const existing = earliestByEmail.get(email)
    if (!existing || occurred.getTime() < existing.getTime()) earliestByEmail.set(email, occurred)
  }

  if (earliestByEmail.size === 0) return { ...EMPTY }

  const emails = Array.from(earliestByEmail.keys())
  const lowerBound = new Date(now.getTime() - MATCH_LOOKBACK_DAYS * 86400 * 1000)

  // 2. One SELECT — bounded by emails + IS NULL (race-safe against the Manta
  //    cron) + funnel state (skip completed carts) + last_action_at window.
  const carts = await cart.list({
    email: { $in: emails },
    abandon_notified_at: { $null: true },
    highest_stage: { $ne: 'completed' },
    status: { $ne: 'completed' },
    last_action_at: { $gte: lowerBound },
  })

  const result: MarkResult = {
    carts_marked_klaviyo: 0,
    emails_considered: earliestByEmail.size,
    carts_skipped_already_notified: 0,
  }

  for (const c of carts) {
    // Belt-and-braces: the SELECT already filtered NULL, but a concurrent
    // Manta cron might have just bumped this row. Skip silently.
    if (c.abandon_notified_at != null) {
      result.carts_skipped_already_notified++
      continue
    }
    const email = (c.email ?? '').toLowerCase()
    const occurred = earliestByEmail.get(email)
    if (!occurred) continue // shouldn't happen — SELECT was bounded by `email IN emails`
    try {
      await cart.update({
        id: c.id,
        abandon_notified_at: occurred,
        abandon_notified_source: 'klaviyo',
        abandon_notified_count: 1,
      })
      result.carts_marked_klaviyo++
    } catch (err) {
      log.warn(`[syncKlaviyoEvents] mark-from-klaviyo failed cart=${c.id} err=${(err as Error).message}`)
    }
  }

  return result
}
