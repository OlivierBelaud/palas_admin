// Pure helper for `attributeSessionConversion` command. No framework
// globals — exercises the cohort-matching rules in plan §Phase D1.
//
// Why a separate helper: the command is a thin shell on top of these
// rules so they can be unit-tested without booting the app. Same
// pattern as `sync-klaviyo-events-mark-helper.ts`.

export interface SessionAttributionInput {
  cart_birth_at: string
  conversion_at?: string | null
  distinct_id: string | null
  email?: string | null
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
  listByEmail?: (email: string) => Promise<SessionRow[]>
  update: (id: string, data: Record<string, unknown>) => Promise<SessionRow>
}

export type AttributionResult = { matched: 0 } | { matched: 1 }

/** Lookback window for "session active at cart_birth_at/conversion_at". */
export const SESSION_ACTIVE_WINDOW_MS = 30 * 60 * 1000

/**
 * Cohort late-update: find the visitor_session that should own the
 * conversion and stamp `cart_converted=true, order_id=...`.
 *
 * Rules:
 *   - priority 1: same distinct_id, session active at cart_birth_at
 *   - priority 2: same distinct_id, session active at conversion_at
 *   - priority 3: same email, session active at conversion_at
 *   - if this order_id is already stamped on a converted session, no-op
 *   - candidate already converted → matched=1 (idempotent, no write)
 *   - else: most recent `started_at` wins → update → matched=1
 */
export async function attributeSessionConversionCore(
  input: SessionAttributionInput,
  repo: SessionAttributionRepo,
): Promise<AttributionResult> {
  const distinctId = input.distinct_id ?? null
  const cartBirthAt = parseTime(input.cart_birth_at)
  const conversionAt = parseTime(input.conversion_at ?? null)
  if (cartBirthAt == null) return { matched: 0 }

  const orderId = input.order_id ?? null
  if (orderId) {
    const existing = await repo.list({ order_id: orderId })
    if (existing.some((row) => row.cart_converted === true && row.order_id === orderId)) return { matched: 1 }
  }

  let match: { row: SessionRow; attributedAt: Date } | null = null
  if (distinctId) {
    const candidates = await repo.list({ distinct_id: distinctId })
    match =
      pickMostRecentActiveSession(candidates, cartBirthAt) ??
      (conversionAt ? pickMostRecentActiveSession(candidates, conversionAt) : null)
  }

  const normalizedEmail = normalizeEmail(input.email)
  if (!match && normalizedEmail && conversionAt && repo.listByEmail) {
    match = pickMostRecentActiveSession(await repo.listByEmail(normalizedEmail), conversionAt)
  }

  if (!match) return { matched: 0 }
  const target = match.row

  if (target.cart_converted === true) return { matched: 1 }

  const becameCustomer = target.segment_at_session_start !== 'returning_customer'
  await repo.update(target.id, {
    cart_converted: true,
    order_id: input.order_id ?? null,
    became_customer_in_session: becameCustomer,
    became_customer_at: becameCustomer ? match.attributedAt : null,
  })
  return { matched: 1 }
}

function parseTime(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function normalizeEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase()
  return email && email.includes('@') ? email : null
}

function pickMostRecentActiveSession(
  candidates: SessionRow[],
  referenceAt: Date,
): { row: SessionRow; attributedAt: Date } | null {
  const referenceMs = referenceAt.getTime()
  const windowStartMs = referenceMs - SESSION_ACTIVE_WINDOW_MS
  const active = candidates.filter((row) => {
    const startedMs = new Date(row.started_at).getTime()
    const lastEventMs = new Date(row.last_event_at).getTime()
    return startedMs <= referenceMs && lastEventMs >= windowStartMs
  })
  if (active.length === 0) return null
  active.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
  return { row: active[0], attributedAt: referenceAt }
}
