// ChartCard feed: per-day cart-creation funnel.
//
// Source = `carts` table (authoritative cohort source), NOT
// `visitor_sessions` — because past Shopify orders that bypassed our
// proxy don't have matching visitor_sessions, while their `carts`
// rows are populated by the `sync-from-shopify` cron + the
// `reconcile-shopify-orders` cron. Using carts directly means the
// chart matches Shopify's order count even for days where no session
// was captured.
//
// Two series:
//   - `carts_created` — COUNT of carts whose `cart_birth_at` falls on day D
//   - `carts_created_converted` — of those, COUNT with `highest_stage = 'completed'`
//
// `cart_birth_at` is the immutable first-event timestamp (set on cart
// INSERT in apply-event.ts, frozen forever). If a cart pre-dates the
// `cart_birth_at` field (very old rows), it falls back to `created_at`
// — and the synthetic backfill from orders.placed_at also fills
// `cart_birth_at` retroactively.

import { type DrizzleReadContext, readRows } from '../../utils/drizzle-read'
import {
  buildAllDaysFromTo,
  dayKey,
  emptyResponse,
  normalizeVisitorStatsRange,
  toDate,
  type VisitorStatsRangeInput,
} from '../../utils/visitor-stats-helpers'

interface CartLite {
  cart_birth_at: Date | string | null
  created_at: Date | string | null
  highest_stage: string
}

// Standalone cart pull (separate from pullSessions which is session-bound)
async function pullCarts(
  input: VisitorStatsRangeInput,
  ctx: DrizzleReadContext,
  log: { warn: (m: string) => void },
): Promise<{ carts: CartLite[]; from: Date; to: Date } | null> {
  const range = normalizeVisitorStatsRange(input)
  const from = new Date(range.from)
  const to = new Date(range.to)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new MantaError('INVALID_DATA', `visitor-stats: invalid range from=${input.from} to=${input.to}`)
  }
  // Paginate to drain the window.
  const PAGE = 5000
  const HARD_CAP = 100_000
  const all: CartLite[] = []
  try {
    for (let offset = 0; offset < HARD_CAP; offset += PAGE) {
      const page = (await readRows(ctx, {
        entity: 'cart',
        fields: ['cart_birth_at', 'created_at', 'highest_stage'],
        filters: {
          $or: [
            { cart_birth_at: { $gte: from.toISOString(), $lt: to.toISOString() } },
            // Fallback for carts created before cart_birth_at existed.
            { cart_birth_at: null, created_at: { $gte: from.toISOString(), $lt: to.toISOString() } },
          ],
        },
        pagination: { take: PAGE, skip: offset, limit: PAGE, offset },
      })) as CartLite[]
      if (!Array.isArray(page) || page.length === 0) break
      all.push(...page)
      if (page.length < PAGE) break
    }
    return { carts: all, from, to }
  } catch (err) {
    log.warn(`[visitor-stats-carts-created] database query failed: ${(err as Error).message}. Returning empty.`)
    return null
  }
}

export default defineQuery({
  name: 'visitor-stats-carts-created-funnel',
  description:
    'Per-day cart-creation cohort funnel: total carts created vs converted. Source = carts table (authoritative).',
  input: z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    granularity: z.enum(['day', 'week', 'month']).optional(),
  }),
  handler: async (input, { db, schema, log }) => {
    const pulled = await pullCarts(input, { db, schema }, log)
    if (!pulled) return emptyResponse(input)
    const { carts, from, to } = pulled

    const buckets = new Map<string, { total: number; converted: number }>()
    for (const c of carts) {
      const ref = c.cart_birth_at ?? c.created_at
      if (!ref) continue
      const day = dayKey(toDate(ref))
      let b = buckets.get(day)
      if (!b) {
        b = { total: 0, converted: 0 }
        buckets.set(day, b)
      }
      b.total += 1
      if (c.highest_stage === 'completed') b.converted += 1
    }

    const days = buildAllDaysFromTo(from, to)
    const rows = days.map((day) => {
      const b = buckets.get(day)
      return {
        date: day,
        carts_created: b ? b.total : 0,
        carts_created_converted: b ? b.converted : 0,
      }
    })

    return {
      rows,
      meta: {
        range: { from: from.toISOString(), to: to.toISOString() },
        granularity: 'day' as const,
        xFormat: 'date' as const,
      },
    }
  },
})
