// Derivation rules for cart abandonment — single source of truth consumed by
// queries, stats, and jobs. See docs/cart-abandonment-rules.md.
//
// Design: DB stores only raw facts (last_action_at, highest_stage,
// abandon_notified_*). Every "abandoned / dormant / dead / recovered"
// categorization is computed here on the fly so a missed cron tick can never
// leave the UI lying.

export const DORMANT_AFTER_HOURS = 2
export const DEAD_AFTER_DAYS = 7
export const ATTRIBUTION_WINDOW_DAYS = 2
export const RECOVERY_FLOW_ACTIVE_DAYS = 3

export type ActivityState = 'browsing' | 'dormant' | 'dead' | 'completed'

export type SubStage = 'cart_abandoned' | 'checkout_abandoned' | 'payment_abandoned' | null

export type AbandonmentCategory =
  | 'recovered'
  | 'pending_recovery'
  | 'assisted_dead'
  | 'not_picked_up'
  | 'normal_conversion'

export interface CartFacts {
  highest_stage: string
  last_action_at: Date | string
  created_at?: Date | string | null
}

const DAY_MS = 86400 * 1000
const HOUR_MS = 3600 * 1000

export function toMs(d: Date | string | null | undefined): number | null {
  if (!d) return null
  return d instanceof Date ? d.getTime() : new Date(d).getTime()
}

export function computeActivityState(cart: CartFacts, nowMs: number = Date.now()): ActivityState {
  if (cart.highest_stage === 'completed') return 'completed'
  const lastActionMs = toMs(cart.last_action_at) ?? 0
  const ageMs = nowMs - lastActionMs
  if (ageMs < DORMANT_AFTER_HOURS * HOUR_MS) return 'browsing'
  if (ageMs >= DEAD_AFTER_DAYS * DAY_MS) return 'dead'
  return 'dormant'
}

export function computeSubStage(highest_stage: string): SubStage {
  switch (highest_stage) {
    case 'cart':
      return 'cart_abandoned'
    case 'checkout_started':
    case 'checkout_engaged':
      return 'checkout_abandoned'
    case 'payment_attempted':
      return 'payment_abandoned'
    default:
      return null
  }
}

/**
 * Is a Klaviyo abandon email attributable to this cart?
 *
 * Heuristic (see docs/cart-abandonment-rules.md §3):
 *   - Completed cart: the email must land in [completed_at - 2d, completed_at].
 *     Tight window because attribution is the strongest claim — "this email
 *     drove the conversion".
 *   - Open cart (dormant or dead): the email must land within the 7-day
 *     dormant window of last_action_at, i.e. |email - last_action| ≤ 7d.
 *     Loose because our own recovery flow legitimately fires emails at 2h /
 *     J+1 / J+3 *after* last action, and an email sent *before* last action
 *     can have triggered the user coming back (= also attributable).
 *
 * Intentionally does NOT use `cart.created_at` as a lower bound — the column
 * stores the DB-row insertion time, which gets rewritten on every
 * `rebuildCarts` run and is therefore unreliable as a cart-birth proxy.
 */
export function isEmailAttributed(
  cart: CartFacts,
  lastEmailAtMs: number | null,
  _nowMs: number = Date.now(),
): boolean {
  if (lastEmailAtMs === null) return false
  const lastActionMs = toMs(cart.last_action_at) ?? 0
  const isCompleted = cart.highest_stage === 'completed'

  if (isCompleted) {
    const completedMs = lastActionMs
    const delta = completedMs - lastEmailAtMs
    return delta >= 0 && delta <= ATTRIBUTION_WINDOW_DAYS * DAY_MS
  }

  // Open cart — email within the dormant-window radius of last_action_at
  return Math.abs(lastEmailAtMs - lastActionMs) <= DEAD_AFTER_DAYS * DAY_MS
}

export function computeCategory(
  cart: CartFacts & { abandon_notified_count?: number | null },
  lastEmailAtMs: number | null,
  nowMs: number = Date.now(),
): AbandonmentCategory {
  const activity = computeActivityState(cart, nowMs)
  const attributed = isEmailAttributed(cart, lastEmailAtMs, nowMs)

  if (activity === 'completed') {
    return attributed ? 'recovered' : 'normal_conversion'
  }

  if (!attributed) return 'not_picked_up'

  // Attributed email + still open
  const since = lastEmailAtMs === null ? Infinity : nowMs - lastEmailAtMs
  if (activity === 'dead' || since > RECOVERY_FLOW_ACTIVE_DAYS * DAY_MS) return 'assisted_dead'
  return 'pending_recovery'
}

/**
 * SQL fragment (Postgres) that derives the 4 activity states from a
 * `carts` row. Inlined as a CASE so stats aggregations can GROUP BY it
 * in a single query.
 *
 * Column refs assume the `carts` table is aliased `c` (or unqualified).
 */
export function sqlActivityStateCase(alias = ''): string {
  const c = alias ? `${alias}.` : ''
  const dormantSecs = DORMANT_AFTER_HOURS * 3600
  const deadSecs = DEAD_AFTER_DAYS * 86400
  return `
    CASE
      WHEN ${c}highest_stage = 'completed' THEN 'completed'
      WHEN EXTRACT(EPOCH FROM (now() - ${c}last_action_at)) < ${dormantSecs} THEN 'browsing'
      WHEN EXTRACT(EPOCH FROM (now() - ${c}last_action_at)) >= ${deadSecs} THEN 'dead'
      ELSE 'dormant'
    END`
}

/**
 * SQL fragment mapping highest_stage → funnel sub-stage. Returns NULL for
 * completed carts (no abandonment).
 */
export function sqlSubStageCase(alias = ''): string {
  const c = alias ? `${alias}.` : ''
  return `
    CASE
      WHEN ${c}highest_stage = 'cart' THEN 'cart_abandoned'
      WHEN ${c}highest_stage IN ('checkout_started', 'checkout_engaged') THEN 'checkout_abandoned'
      WHEN ${c}highest_stage = 'payment_attempted' THEN 'payment_abandoned'
      ELSE NULL
    END`
}
