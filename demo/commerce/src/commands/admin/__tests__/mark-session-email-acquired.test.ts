// Unit tests for `markSessionEmailAcquiredCore` — the pure helper that
// backs the `markSessionEmailAcquired` command.
//
// Covers:
//   - happy: open session within 30min → marked, returns matched=1
//   - no session at all → matched=0
//   - all sessions expired (>30min) → matched=0
//   - already acquired → idempotent (matched=1, no write)
//   - multiple open sessions → most recent last_event_at wins
//   - `via` is written through (newsletter / checkout_started)
//   - email is written to email_at_session_end

import { describe, expect, it, vi } from 'vitest'
import {
  markSessionEmailAcquiredCore,
  OPEN_SESSION_WINDOW_MS,
  type SessionMarkerRepo,
  type SessionRow,
} from '../../../utils/mark-session-email-acquired-helper'

const NOW_MS = new Date('2026-05-12T12:00:00.000Z').getTime()

function makeRepo(rows: SessionRow[]): SessionMarkerRepo & {
  updates: Array<{ id: string; patch: Record<string, unknown> }>
} {
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = []
  return {
    list: vi.fn(async () => rows),
    update: vi.fn(async (id, patch) => {
      updates.push({ id, patch })
      return rows.find((r) => r.id === id) as SessionRow
    }),
    updates,
  }
}

describe('markSessionEmailAcquiredCore', () => {
  it('marks an open session within the 30min window (happy path)', async () => {
    const repo = makeRepo([
      {
        id: 'sess_a',
        last_event_at: new Date(NOW_MS - 5 * 60_000), // 5min ago
        email_acquired_in_session: false,
      },
    ])
    const out = await markSessionEmailAcquiredCore(
      { distinct_id: 'd_1', email: 'shopper@test.com', via: 'newsletter', nowMs: NOW_MS },
      repo,
    )
    expect(out).toEqual({ matched: 1 })
    expect(repo.updates).toHaveLength(1)
    expect(repo.updates[0]).toEqual({
      id: 'sess_a',
      patch: {
        email_acquired_in_session: true,
        email_acquired_via: 'newsletter',
        email_acquired_at: new Date(NOW_MS),
        email_at_session_end: 'shopper@test.com',
      },
    })
  })

  it('returns matched=0 when no sessions exist for distinct_id', async () => {
    const repo = makeRepo([])
    const out = await markSessionEmailAcquiredCore(
      { distinct_id: 'd_1', email: 'x@y.com', via: 'newsletter', nowMs: NOW_MS },
      repo,
    )
    expect(out).toEqual({ matched: 0 })
    expect(repo.updates).toHaveLength(0)
  })

  it('returns matched=0 when all sessions are expired (>30min)', async () => {
    const repo = makeRepo([
      {
        id: 'sess_old',
        last_event_at: new Date(NOW_MS - OPEN_SESSION_WINDOW_MS - 1_000), // just past 30min
        email_acquired_in_session: false,
      },
    ])
    const out = await markSessionEmailAcquiredCore(
      { distinct_id: 'd_1', email: 'x@y.com', via: 'newsletter', nowMs: NOW_MS },
      repo,
    )
    expect(out).toEqual({ matched: 0 })
    expect(repo.updates).toHaveLength(0)
  })

  it('is idempotent: already-acquired session returns matched=1 with no write', async () => {
    const repo = makeRepo([
      {
        id: 'sess_a',
        last_event_at: new Date(NOW_MS - 5 * 60_000),
        email_acquired_in_session: true,
      },
    ])
    const out = await markSessionEmailAcquiredCore(
      { distinct_id: 'd_1', email: 'x@y.com', via: 'newsletter', nowMs: NOW_MS },
      repo,
    )
    expect(out).toEqual({ matched: 1 })
    expect(repo.updates).toHaveLength(0)
  })

  it('most recent last_event_at wins when multiple sessions are open', async () => {
    const repo = makeRepo([
      {
        id: 'sess_old',
        last_event_at: new Date(NOW_MS - 20 * 60_000),
        email_acquired_in_session: false,
      },
      {
        id: 'sess_new',
        last_event_at: new Date(NOW_MS - 1 * 60_000),
        email_acquired_in_session: false,
      },
    ])
    const out = await markSessionEmailAcquiredCore(
      { distinct_id: 'd_1', email: 'shopper@test.com', via: 'newsletter', nowMs: NOW_MS },
      repo,
    )
    expect(out).toEqual({ matched: 1 })
    expect(repo.updates).toHaveLength(1)
    expect(repo.updates[0].id).toBe('sess_new')
  })

  it('preserves the via value (checkout_started)', async () => {
    const repo = makeRepo([
      {
        id: 'sess_a',
        last_event_at: new Date(NOW_MS - 5 * 60_000),
        email_acquired_in_session: false,
      },
    ])
    await markSessionEmailAcquiredCore(
      { distinct_id: 'd_1', email: 'newbie@test.com', via: 'checkout_started', nowMs: NOW_MS },
      repo,
    )
    expect(repo.updates[0].patch).toMatchObject({
      email_acquired_via: 'checkout_started',
      email_at_session_end: 'newbie@test.com',
    })
  })

  it('queries the repo with distinct_id as filter', async () => {
    const repo = makeRepo([])
    await markSessionEmailAcquiredCore(
      { distinct_id: 'wanted_id', email: 'x@y.com', via: 'newsletter', nowMs: NOW_MS },
      repo,
    )
    expect(repo.list).toHaveBeenCalledWith({ distinct_id: 'wanted_id' })
  })

  it('skips expired session but uses an open one in mixed result', async () => {
    const repo = makeRepo([
      {
        id: 'sess_expired',
        last_event_at: new Date(NOW_MS - 60 * 60_000), // 1h ago — expired
        email_acquired_in_session: false,
      },
      {
        id: 'sess_open',
        last_event_at: new Date(NOW_MS - 10 * 60_000), // 10min ago — open
        email_acquired_in_session: false,
      },
    ])
    const out = await markSessionEmailAcquiredCore(
      { distinct_id: 'd_1', email: 'x@y.com', via: 'newsletter', nowMs: NOW_MS },
      repo,
    )
    expect(out).toEqual({ matched: 1 })
    expect(repo.updates[0].id).toBe('sess_open')
  })
})
