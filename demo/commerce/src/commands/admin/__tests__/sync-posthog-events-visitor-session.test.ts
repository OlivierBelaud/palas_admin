// Integration-style test for the cron rattrapage path's visitor-session
// dispatch. The actual command (syncPosthogEvents) is wrapped in a
// step.action and requires a runtime context — instead, we replay the
// SAME 3-event sequence through the pure planSessionUpsert planner that
// the command's dispatch would feed. This catches the chained-state
// correctness (carts_created counter, checkout_started transition, dedup)
// without booting the framework.
//
// Replayed sequence:
//   1. cart:product_added       — anonymous (no email)
//   2. checkout:started         — with email → marks email_acquired_via=checkout_started
//   3. checkout:completed       — same email, no new flag
//
// Plus an idempotency replay: feed the SAME 3 events a second time and
// verify counters/state don't change (event_uuid dedup).

import { describe, expect, it } from 'vitest'
import {
  type ExistingSession,
  type PlanSessionEventInput,
  planSessionUpsert,
} from '../../../modules/visitor-session/upsert-session'

function makeEvent(
  partial: Partial<PlanSessionEventInput> & { event_name: string; occurred_at: string; event_uuid: string },
): PlanSessionEventInput {
  return {
    distinct_id: 'd_alice',
    session_id: 'sess_x',
    event_uuid: partial.event_uuid,
    event_name: partial.event_name,
    occurred_at: partial.occurred_at,
    email_on_event: partial.email_on_event ?? null,
    current_url: 'https://shop.example.com/cart',
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    referring_domain: null,
  }
}

function applyIntent(prev: ExistingSession | undefined, intent: ReturnType<typeof planSessionUpsert>): ExistingSession {
  // Simulate the upsertWithReplace round-trip: the row produced by the
  // planner becomes the next "existing session" for the next event.
  return {
    id: prev?.id ?? 'sess_db_id',
    started_at: intent.row.started_at,
    last_event_at: intent.row.last_event_at,
    pageviews_count: intent.row.pageviews_count,
    email_at_session_start: intent.row.email_at_session_start,
    email_at_session_end: intent.row.email_at_session_end,
    contact_id: intent.row.contact_id,
    segment_at_session_start: intent.row.segment_at_session_start,
    first_url: intent.row.first_url,
    utm_source: intent.row.utm_source,
    utm_medium: intent.row.utm_medium,
    utm_campaign: intent.row.utm_campaign,
    referring_domain: intent.row.referring_domain,
    is_paid_session: intent.row.is_paid_session,
    carts_created_in_session: intent.row.carts_created_in_session,
    carts_updated_in_session: intent.row.carts_updated_in_session,
    cart_converted: intent.row.cart_converted,
    order_id: intent.row.order_id,
    email_acquired_in_session: intent.row.email_acquired_in_session,
    email_acquired_via: intent.row.email_acquired_via,
    seen_event_uuids: intent.row.seen_event_uuids,
  }
}

describe('sync-posthog-events visitor-session dispatch (replay)', () => {
  it('replays 3 events: cart:product_added → checkout:started → checkout:completed', () => {
    const identity = { contact_id: null, email: null, segment: 'unknown' as const }

    // ── Event 1: cart:product_added (anonymous) ────────────────
    const e1 = makeEvent({
      event_name: 'cart:product_added',
      occurred_at: '2026-05-12T10:00:00.000Z',
      event_uuid: 'evt-1',
    })
    const i1 = planSessionUpsert({ event: e1, existingSession: undefined, identityAtStart: identity })
    expect(i1.row.carts_created_in_session).toBe(1)
    expect(i1.row.email_acquired_in_session).toBe(false)
    expect(i1.row.email_at_session_start).toBeNull()

    let state = applyIntent(undefined, i1)

    // ── Event 2: checkout:started (with email) ────────────────
    const e2 = makeEvent({
      event_name: 'checkout:started',
      occurred_at: '2026-05-12T10:02:00.000Z',
      event_uuid: 'evt-2',
      email_on_event: 'alice@example.com',
    })
    const i2 = planSessionUpsert({ event: e2, existingSession: state, identityAtStart: identity })
    expect(i2.row.email_acquired_in_session).toBe(true)
    expect(i2.row.email_acquired_via).toBe('checkout_started')
    expect(i2.row.email_at_session_end).toBe('alice@example.com')
    expect(i2.row.email_at_session_start).toBeNull() // frozen
    expect(i2.row.carts_created_in_session).toBe(1) // no change
    state = applyIntent(state, i2)

    // ── Event 3: checkout:completed (same email, no new flag) ──
    const e3 = makeEvent({
      event_name: 'checkout:completed',
      occurred_at: '2026-05-12T10:05:00.000Z',
      event_uuid: 'evt-3',
      email_on_event: 'alice@example.com',
    })
    const i3 = planSessionUpsert({ event: e3, existingSession: state, identityAtStart: identity })
    expect(i3.row.carts_created_in_session).toBe(1)
    expect(i3.row.email_acquired_in_session).toBe(true)
    expect(i3.row.email_acquired_via).toBe('checkout_started')
    expect(i3.row.cart_converted).toBe(false) // cart_converted is owned by attributeSessionConversion, NOT this path
    state = applyIntent(state, i3)

    // ── Idempotency: replay all 3 ──────────────────────────────
    // Re-feeding the exact same events (same uuids) must not change
    // counters. event_uuid dedup via seen_event_uuids[].
    const before = JSON.stringify({
      carts_created: state.carts_created_in_session,
      pageviews: state.pageviews_count,
      seen: state.seen_event_uuids,
    })

    const r1 = planSessionUpsert({ event: e1, existingSession: state, identityAtStart: identity })
    state = applyIntent(state, r1)
    const r2 = planSessionUpsert({ event: e2, existingSession: state, identityAtStart: identity })
    state = applyIntent(state, r2)
    const r3 = planSessionUpsert({ event: e3, existingSession: state, identityAtStart: identity })
    state = applyIntent(state, r3)

    expect(state.carts_created_in_session).toBe(1) // unchanged
    expect(state.email_acquired_in_session).toBe(true) // unchanged
    expect(state.email_acquired_via).toBe('checkout_started')

    const after = JSON.stringify({
      carts_created: state.carts_created_in_session,
      pageviews: state.pageviews_count,
      seen: state.seen_event_uuids,
    })
    expect(after).toBe(before)
  })

  it('replays without event_uuid: counters DO double on re-run (no dedup signal)', () => {
    // Defensive: the dedup is keyed on event_uuid. If the cron's HogQL row
    // ships without uuid (shouldn't happen in practice — every PostHog row
    // has one), counters increment again on re-run. This test documents
    // the contract.
    const identity = { contact_id: null, email: null, segment: 'unknown' as const }
    const e = makeEvent({
      event_name: 'cart:product_added',
      occurred_at: '2026-05-12T10:00:00.000Z',
      event_uuid: '',
    })
    const i1 = planSessionUpsert({
      event: { ...e, event_uuid: null },
      existingSession: undefined,
      identityAtStart: identity,
    })
    let state = applyIntent(undefined, i1)
    const i2 = planSessionUpsert({
      event: { ...e, event_uuid: null },
      existingSession: state,
      identityAtStart: identity,
    })
    state = applyIntent(state, i2)
    expect(state.carts_created_in_session).toBe(2)
  })
})
