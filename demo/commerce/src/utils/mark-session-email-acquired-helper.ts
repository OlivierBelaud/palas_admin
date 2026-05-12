// Pure helper for `markSessionEmailAcquired` command. No framework
// globals — exercises the open-session lookup + idempotency rules
// from plan §Phase E3.
//
// Same shape as `attribute-session-conversion-helper.ts`: extract the
// algorithmic core so unit tests can run without booting the app.

export interface MarkSessionEmailAcquiredInput {
  distinct_id: string
  email: string
  via: 'newsletter' | 'checkout_started'
  /** Override for the "now" timestamp used by the open-session lookup.
   * Defaults to Date.now() — tests pass a fixed value. */
  nowMs?: number
}

export interface SessionRow {
  id: string
  last_event_at: Date | string
  email_acquired_in_session: boolean
}

export interface SessionMarkerRepo {
  list: (filters: Record<string, unknown>) => Promise<SessionRow[]>
  update: (id: string, data: Record<string, unknown>) => Promise<SessionRow>
}

export type MarkResult = { matched: 0 } | { matched: 1 }

/** Window in which a session is considered "open" for newsletter attribution. */
export const OPEN_SESSION_WINDOW_MS = 30 * 60 * 1000

/**
 * Stamp the currently-open visitor_session for this `distinct_id` as
 * having had its email acquired via `input.via`.
 *
 * Rules:
 *   - No session with `last_event_at >= NOW - 30min`        → matched=0
 *   - Most recent `last_event_at` wins on ties
 *   - target.email_acquired_in_session === true             → matched=1 (idempotent, no write)
 *   - else: update email_acquired_in_session/via + email_at_session_end → matched=1
 */
export async function markSessionEmailAcquiredCore(
  input: MarkSessionEmailAcquiredInput,
  repo: SessionMarkerRepo,
): Promise<MarkResult> {
  const candidates = await repo.list({ distinct_id: input.distinct_id })
  if (candidates.length === 0) return { matched: 0 }

  const nowMs = input.nowMs ?? Date.now()
  const windowStartMs = nowMs - OPEN_SESSION_WINDOW_MS

  const open = candidates.filter((row) => new Date(row.last_event_at).getTime() >= windowStartMs)
  if (open.length === 0) return { matched: 0 }

  open.sort((a, b) => new Date(b.last_event_at).getTime() - new Date(a.last_event_at).getTime())
  const target = open[0]

  if (target.email_acquired_in_session === true) return { matched: 1 }

  await repo.update(target.id, {
    email_acquired_in_session: true,
    email_acquired_via: input.via,
    email_at_session_end: input.email,
  })
  return { matched: 1 }
}
