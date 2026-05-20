// Pure helper for `attributeSessionConversion` command. No framework
// globals — exercises the cohort-matching rules in plan §Phase D1.
//
// Why a separate helper: the command is a thin shell on top of these
// rules so they can be unit-tested without booting the app. Same
// pattern as `sync-klaviyo-events-mark-helper.ts`.

export interface SessionAttributionInput {
  cart_birth_at: string
  distinct_id: string | null
  order_id: string | null
}

export interface SessionRow {
  id: string
  started_at: Date | string
  last_event_at: Date | string
  cart_converted: boolean
  order_id: string | null
  segment_at_session_start?: 'unknown' | 'known_no_purchase' | 'returning_customer'
}

export interface SessionAttributionRepo {
  list: (filters: Record<string, unknown>) => Promise<SessionRow[]>
  update: (id: string, data: Record<string, unknown>) => Promise<SessionRow>
}

export type AttributionResult = { matched: 0 } | { matched: 1 }

/** Lookback window for "session active at cart_birth_at". */
export const SESSION_ACTIVE_WINDOW_MS = 30 * 60 * 1000

/**
 * Cohort late-update: find the visitor_session that was alive at
 * `cart_birth_at` and stamp `cart_converted=true, order_id=...`.
 *
 * Rules:
 *   - distinct_id null/empty   → matched=0 (anonymous purchase)
 *   - no session for this id   → matched=0
 *   - no session whose window covers cart_birth_at → matched=0
 *   - candidate already converted → matched=1 (idempotent, no write)
 *   - else: most recent `started_at` wins → update → matched=1
 */
export async function attributeSessionConversionCore(
  input: SessionAttributionInput,
  repo: SessionAttributionRepo,
): Promise<AttributionResult> {
  const distinctId = input.distinct_id ?? null
  if (!distinctId) return { matched: 0 }

  const candidates = await repo.list({ distinct_id: distinctId })
  if (candidates.length === 0) return { matched: 0 }

  const cartBirthMs = new Date(input.cart_birth_at).getTime()
  const windowStartMs = cartBirthMs - SESSION_ACTIVE_WINDOW_MS

  const active = candidates.filter((row) => {
    const startedMs = new Date(row.started_at).getTime()
    const lastEventMs = new Date(row.last_event_at).getTime()
    return startedMs <= cartBirthMs && lastEventMs >= windowStartMs
  })
  if (active.length === 0) return { matched: 0 }

  active.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
  const target = active[0]

  if (target.cart_converted === true) return { matched: 1 }

  const becameCustomer = target.segment_at_session_start !== 'returning_customer'
  await repo.update(target.id, {
    cart_converted: true,
    order_id: input.order_id ?? null,
    became_customer_in_session: becameCustomer,
    became_customer_at: becameCustomer ? new Date(input.cart_birth_at) : null,
  })
  return { matched: 1 }
}
