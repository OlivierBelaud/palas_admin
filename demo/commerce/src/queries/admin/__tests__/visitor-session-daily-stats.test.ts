// Snapshot tests — `aggregateVisitorSessions` pure helper.
//
// The query handler (visitor-session-daily-stats.ts) is a thin wrapper
// over `aggregateVisitorSessions` + `pullSessions`. We test the pure
// helper directly so the test doesn't need framework globals (defineQuery
// is only available after bootstrap).
//
// Coverage:
//   - typical mix across 2 days × 2 segments × paid/organic
//   - empty range
//   - had_paid_7d=true: same distinct_id had a paid session 3d earlier
//   - had_paid_7d=false: prior paid session is older than 7d

import { describe, expect, it } from 'vitest'
import { aggregateVisitorSessions } from '../../../utils/visitor-stats-aggregator'
import type { SessionLite } from '../../../utils/visitor-stats-helpers'

describe('aggregateVisitorSessions', () => {
  it('aggregates a typical mix across 2 days × 2 segments × paid/organic', () => {
    const sessions: SessionLite[] = [
      // Day 1 — 2026-05-10
      {
        distinct_id: 'd1',
        started_at: '2026-05-10T08:00:00.000Z',
        segment_at_session_start: 'unknown',
        is_paid_session: true,
        carts_created_in_session: 1,
        carts_updated_in_session: 0,
        cart_converted: true,
        email_acquired_in_session: true,
        email_acquired_via: 'checkout_started',
      },
      {
        distinct_id: 'd2',
        started_at: '2026-05-10T09:00:00.000Z',
        segment_at_session_start: 'unknown',
        is_paid_session: true,
        carts_created_in_session: 1,
        carts_updated_in_session: 0,
        cart_converted: false,
        email_acquired_in_session: false,
        email_acquired_via: null,
      },
      {
        distinct_id: 'd3',
        started_at: '2026-05-10T10:00:00.000Z',
        segment_at_session_start: 'returning_customer',
        is_paid_session: false,
        carts_created_in_session: 0,
        carts_updated_in_session: 2,
        cart_converted: true,
        email_acquired_in_session: false,
        email_acquired_via: null,
      },
      // Day 2 — 2026-05-11
      {
        distinct_id: 'd4',
        started_at: '2026-05-11T08:00:00.000Z',
        segment_at_session_start: 'known_no_purchase',
        is_paid_session: false,
        carts_created_in_session: 1,
        carts_updated_in_session: 1,
        cart_converted: false,
        email_acquired_in_session: true,
        email_acquired_via: 'newsletter',
      },
      {
        distinct_id: 'd1', // SAME distinct_id as day1 → unique count still 1 per group
        started_at: '2026-05-11T12:00:00.000Z',
        segment_at_session_start: 'unknown',
        is_paid_session: false,
        carts_created_in_session: 0,
        carts_updated_in_session: 1,
        cart_converted: false,
        email_acquired_in_session: false,
        email_acquired_via: null,
      },
    ]

    const rows = aggregateVisitorSessions(
      sessions,
      new Date('2026-05-10T00:00:00.000Z'),
      new Date('2026-05-12T00:00:00.000Z'),
    )
    expect(rows).toHaveLength(4)

    const findRow = (day: string, segment: string, paid: boolean) =>
      rows.find((r) => r.day === day && r.segment === segment && r.is_paid_session === paid)

    expect(findRow('2026-05-10', 'unknown', true)).toMatchObject({
      unique_visitors: 2,
      carts_created: 2,
      carts_created_converted: 1,
      carts_updated: 0,
      identity_checkout: 1,
      identity_newsletter: 0,
    })

    expect(findRow('2026-05-10', 'returning_customer', false)).toMatchObject({
      unique_visitors: 1,
      carts_created: 0,
      carts_updated: 2,
      carts_updated_converted: 1,
      carts_created_converted: 0,
    })

    expect(findRow('2026-05-11', 'known_no_purchase', false)).toMatchObject({
      unique_visitors: 1,
      carts_created: 1,
      carts_updated: 1,
      identity_newsletter: 1,
    })

    expect(findRow('2026-05-11', 'unknown', false)).toMatchObject({
      unique_visitors: 1,
      carts_updated: 1,
      carts_created: 0,
    })
  })

  it('returns empty rows for an empty range (from === to)', () => {
    const rows = aggregateVisitorSessions(
      [
        {
          distinct_id: 'd1',
          started_at: '2026-05-10T08:00:00.000Z',
          segment_at_session_start: 'unknown',
          is_paid_session: false,
          carts_created_in_session: 1,
          carts_updated_in_session: 0,
          cart_converted: false,
          email_acquired_in_session: false,
          email_acquired_via: null,
        },
      ],
      new Date('2026-05-10T00:00:00.000Z'),
      new Date('2026-05-10T00:00:00.000Z'),
    )
    expect(rows).toEqual([])
  })

  it('marks had_paid_7d=true when same distinct_id had a paid session 3d earlier', () => {
    const sessions: SessionLite[] = [
      {
        distinct_id: 'd1',
        started_at: '2026-05-07T12:00:00.000Z',
        segment_at_session_start: 'unknown',
        is_paid_session: true,
        carts_created_in_session: 0,
        carts_updated_in_session: 0,
        cart_converted: false,
        email_acquired_in_session: false,
        email_acquired_via: null,
      },
      {
        distinct_id: 'd1',
        started_at: '2026-05-10T10:00:00.000Z',
        segment_at_session_start: 'unknown',
        is_paid_session: false,
        carts_created_in_session: 1,
        carts_updated_in_session: 0,
        cart_converted: false,
        email_acquired_in_session: false,
        email_acquired_via: null,
      },
    ]
    const rows = aggregateVisitorSessions(
      sessions,
      new Date('2026-05-10T00:00:00.000Z'),
      new Date('2026-05-11T00:00:00.000Z'),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      day: '2026-05-10',
      segment: 'unknown',
      is_paid_session: false,
      had_paid_7d: true,
      unique_visitors: 1,
    })
  })

  it('returns had_paid_7d=false when the prior paid session is older than 7d', () => {
    const sessions: SessionLite[] = [
      {
        distinct_id: 'd1',
        started_at: '2026-05-02T12:00:00.000Z', // 8 days before
        segment_at_session_start: 'unknown',
        is_paid_session: true,
        carts_created_in_session: 0,
        carts_updated_in_session: 0,
        cart_converted: false,
        email_acquired_in_session: false,
        email_acquired_via: null,
      },
      {
        distinct_id: 'd1',
        started_at: '2026-05-10T10:00:00.000Z',
        segment_at_session_start: 'unknown',
        is_paid_session: false,
        carts_created_in_session: 0,
        carts_updated_in_session: 0,
        cart_converted: false,
        email_acquired_in_session: false,
        email_acquired_via: null,
      },
    ]
    const rows = aggregateVisitorSessions(
      sessions,
      new Date('2026-05-10T00:00:00.000Z'),
      new Date('2026-05-11T00:00:00.000Z'),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].had_paid_7d).toBe(false)
  })
})
