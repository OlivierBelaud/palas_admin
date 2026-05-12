// Unit tests for the pure `planSessionUpsert` planner.
// No framework globals required — exercises the rules listed in
// plan §Phase C2 directly.

import { describe, expect, it } from 'vitest'
import {
  type ExistingSession,
  type IdentityAtStart,
  type PlanSessionEventInput,
  planSessionUpsert,
  SEEN_EVENT_UUIDS_CAP,
} from '../upsert-session'

const OCCURRED = '2026-05-12T10:00:00.000Z'
const LATER = '2026-05-12T10:05:00.000Z'

function makeEvent(overrides: Partial<PlanSessionEventInput> = {}): PlanSessionEventInput {
  return {
    distinct_id: 'd_1',
    session_id: 's_1',
    event_uuid: 'evt_1',
    event_name: 'cart:product_added',
    occurred_at: OCCURRED,
    ...overrides,
  }
}

function makeIdentity(overrides: Partial<IdentityAtStart> = {}): IdentityAtStart {
  return { contact_id: null, email: null, segment: 'unknown', ...overrides }
}

function makeExisting(overrides: Partial<ExistingSession> = {}): ExistingSession {
  return {
    id: 'sess_db_1',
    started_at: new Date(OCCURRED),
    last_event_at: new Date(OCCURRED),
    pageviews_count: 0,
    email_at_session_start: null,
    email_at_session_end: null,
    contact_id: null,
    segment_at_session_start: 'unknown',
    first_url: 'https://example.com/start',
    utm_source: 'newsletter',
    utm_medium: 'email',
    utm_campaign: 'spring',
    referring_domain: 'klaviyo.com',
    is_paid_session: false,
    carts_created_in_session: 0,
    carts_updated_in_session: 0,
    cart_converted: false,
    order_id: null,
    email_acquired_in_session: false,
    email_acquired_via: null,
    seen_event_uuids: null,
    ...overrides,
  }
}

describe('planSessionUpsert — first event of session', () => {
  it('freezes started_at, attribution, segment, email_at_session_start', () => {
    const out = planSessionUpsert({
      event: makeEvent({
        event_name: '$pageview',
        current_url: 'https://example.com/?utm_source=google_ads&utm_medium=cpc',
        utm_source: 'google_ads',
        utm_medium: 'cpc',
        utm_campaign: 'spring',
        referring_domain: 'google.com',
        email_on_event: null,
      }),
      existingSession: undefined,
      identityAtStart: makeIdentity({ segment: 'known_no_purchase', contact_id: 'c_1', email: 'a@b.com' }),
    })
    expect(out.row.started_at).toEqual(new Date(OCCURRED))
    expect(out.row.last_event_at).toEqual(new Date(OCCURRED))
    expect(out.row.first_url).toBe('https://example.com/?utm_source=google_ads&utm_medium=cpc')
    expect(out.row.utm_source).toBe('google_ads')
    expect(out.row.utm_medium).toBe('cpc')
    expect(out.row.utm_campaign).toBe('spring')
    expect(out.row.referring_domain).toBe('google.com')
    expect(out.row.is_paid_session).toBe(true)
    expect(out.row.segment_at_session_start).toBe('known_no_purchase')
    expect(out.row.contact_id).toBe('c_1')
    expect(out.row.email_at_session_start).toBe('a@b.com')
    expect(out.row.email_at_session_end).toBe('a@b.com')
    expect(out.row.pageviews_count).toBe(1)
    expect(out.row.carts_created_in_session).toBe(0)
    expect(out.row.cart_converted).toBe(false)
    expect(out.row.order_id).toBeNull()
  })

  it('uses event.email_on_event when identity has none', () => {
    const out = planSessionUpsert({
      event: makeEvent({ email_on_event: 'shopper@test.com' }),
      existingSession: undefined,
      identityAtStart: makeIdentity(),
    })
    expect(out.row.email_at_session_start).toBe('shopper@test.com')
    expect(out.row.email_at_session_end).toBe('shopper@test.com')
  })

  it('starts seen_event_uuids with the first event_uuid', () => {
    const out = planSessionUpsert({
      event: makeEvent({ event_uuid: 'evt_42' }),
      existingSession: undefined,
      identityAtStart: makeIdentity(),
    })
    expect(out.row.seen_event_uuids).toEqual(['evt_42'])
  })

  it('leaves seen_event_uuids null when event has no event_uuid', () => {
    const out = planSessionUpsert({
      event: makeEvent({ event_uuid: null }),
      existingSession: undefined,
      identityAtStart: makeIdentity(),
    })
    expect(out.row.seen_event_uuids).toBeNull()
  })

  it('returns the correct conflict target', () => {
    const out = planSessionUpsert({
      event: makeEvent(),
      existingSession: undefined,
      identityAtStart: makeIdentity(),
    })
    expect(out.conflictTarget).toEqual(['distinct_id', 'session_id'])
  })

  it('replaceFields excludes cart_converted and order_id (owned by attribution path)', () => {
    const out = planSessionUpsert({
      event: makeEvent(),
      existingSession: undefined,
      identityAtStart: makeIdentity(),
    })
    expect(out.replaceFields).not.toContain('cart_converted')
    expect(out.replaceFields).not.toContain('order_id')
    // Frozen fields are also excluded
    expect(out.replaceFields).not.toContain('started_at')
    expect(out.replaceFields).not.toContain('first_url')
    expect(out.replaceFields).not.toContain('segment_at_session_start')
  })
})

describe('planSessionUpsert — subsequent events (counters)', () => {
  it('cart:product_added increments carts_created_in_session', () => {
    const out = planSessionUpsert({
      event: makeEvent({ event_uuid: 'evt_new', event_name: 'cart:product_added' }),
      existingSession: makeExisting({ carts_created_in_session: 2 }),
      identityAtStart: makeIdentity(),
    })
    expect(out.row.carts_created_in_session).toBe(3)
    expect(out.row.carts_updated_in_session).toBe(0)
  })

  it.each([
    'cart:product_removed',
    'cart:updated',
    'cart:cleared',
    'cart:discount_applied',
  ])('%s increments carts_updated_in_session', (eventName) => {
    const out = planSessionUpsert({
      event: makeEvent({ event_uuid: `evt_${eventName}`, event_name: eventName }),
      existingSession: makeExisting({ carts_updated_in_session: 5 }),
      identityAtStart: makeIdentity(),
    })
    expect(out.row.carts_updated_in_session).toBe(6)
    expect(out.row.carts_created_in_session).toBe(0)
  })

  it('$pageview increments pageviews_count', () => {
    const out = planSessionUpsert({
      event: makeEvent({ event_uuid: 'evt_pv', event_name: '$pageview' }),
      existingSession: makeExisting({ pageviews_count: 7 }),
      identityAtStart: makeIdentity(),
    })
    expect(out.row.pageviews_count).toBe(8)
  })

  it('unknown event names do not increment any counter', () => {
    const out = planSessionUpsert({
      event: makeEvent({ event_uuid: 'evt_x', event_name: 'random:event' }),
      existingSession: makeExisting({
        pageviews_count: 1,
        carts_created_in_session: 2,
        carts_updated_in_session: 3,
      }),
      identityAtStart: makeIdentity(),
    })
    expect(out.row.pageviews_count).toBe(1)
    expect(out.row.carts_created_in_session).toBe(2)
    expect(out.row.carts_updated_in_session).toBe(3)
  })
})

describe('planSessionUpsert — frozen fields on subsequent events', () => {
  it('preserves started_at, attribution, segment, email_at_session_start', () => {
    const existing = makeExisting({
      started_at: new Date(OCCURRED),
      first_url: 'https://example.com/landing',
      utm_source: 'newsletter',
      utm_medium: 'email',
      utm_campaign: 'spring',
      referring_domain: 'klaviyo.com',
      is_paid_session: false,
      contact_id: 'c_1',
      segment_at_session_start: 'returning_customer',
      email_at_session_start: 'frozen@test.com',
    })
    const out = planSessionUpsert({
      event: makeEvent({
        occurred_at: LATER,
        event_uuid: 'evt_2',
        // Try to "change" attribution — these should be IGNORED on subsequent events.
        current_url: 'https://example.com/?utm_source=google_ads',
        utm_source: 'google_ads',
        utm_medium: 'cpc',
        referring_domain: 'google.com',
      }),
      existingSession: existing,
      identityAtStart: makeIdentity({ segment: 'unknown' }), // would-be different segment
    })
    expect(out.row.started_at).toEqual(existing.started_at)
    expect(out.row.first_url).toBe('https://example.com/landing')
    expect(out.row.utm_source).toBe('newsletter')
    expect(out.row.utm_medium).toBe('email')
    expect(out.row.utm_campaign).toBe('spring')
    expect(out.row.referring_domain).toBe('klaviyo.com')
    expect(out.row.is_paid_session).toBe(false)
    expect(out.row.contact_id).toBe('c_1')
    expect(out.row.segment_at_session_start).toBe('returning_customer')
    expect(out.row.email_at_session_start).toBe('frozen@test.com')
  })

  it('preserves cart_converted and order_id (owned by attribution command)', () => {
    const out = planSessionUpsert({
      event: makeEvent({ event_uuid: 'evt_2', event_name: '$pageview' }),
      existingSession: makeExisting({ cart_converted: true, order_id: 'order_42' }),
      identityAtStart: makeIdentity(),
    })
    expect(out.row.cart_converted).toBe(true)
    expect(out.row.order_id).toBe('order_42')
  })

  it('bumps last_event_at monotonically (never goes backwards)', () => {
    const startedAt = new Date('2026-05-12T10:00:00.000Z')
    const lastSeenAt = new Date('2026-05-12T11:00:00.000Z')
    const out = planSessionUpsert({
      event: makeEvent({
        occurred_at: '2026-05-12T09:00:00.000Z', // earlier than lastSeenAt
        event_uuid: 'evt_old',
        event_name: '$pageview',
      }),
      existingSession: makeExisting({ started_at: startedAt, last_event_at: lastSeenAt }),
      identityAtStart: makeIdentity(),
    })
    expect(out.row.last_event_at).toEqual(lastSeenAt)
  })

  it('updates last_event_at when event is newer', () => {
    const startedAt = new Date(OCCURRED)
    const out = planSessionUpsert({
      event: makeEvent({ occurred_at: LATER, event_uuid: 'evt_new', event_name: '$pageview' }),
      existingSession: makeExisting({ started_at: startedAt, last_event_at: startedAt }),
      identityAtStart: makeIdentity(),
    })
    expect(out.row.last_event_at).toEqual(new Date(LATER))
  })
})

describe('planSessionUpsert — idempotency via seen_event_uuids', () => {
  it('skips counter increment when event_uuid is already in seen_event_uuids', () => {
    const out = planSessionUpsert({
      event: makeEvent({ event_uuid: 'dup_1', event_name: 'cart:product_added' }),
      existingSession: makeExisting({
        carts_created_in_session: 5,
        seen_event_uuids: ['dup_1'],
      }),
      identityAtStart: makeIdentity(),
    })
    expect(out.row.carts_created_in_session).toBe(5)
    // seen_event_uuids unchanged (no append)
    expect(out.row.seen_event_uuids).toEqual(['dup_1'])
  })

  it('appends event_uuid to seen_event_uuids on new events', () => {
    const out = planSessionUpsert({
      event: makeEvent({ event_uuid: 'evt_new', event_name: '$pageview' }),
      existingSession: makeExisting({
        pageviews_count: 1,
        seen_event_uuids: ['a', 'b'],
      }),
      identityAtStart: makeIdentity(),
    })
    expect(out.row.seen_event_uuids).toEqual(['a', 'b', 'evt_new'])
    expect(out.row.pageviews_count).toBe(2)
  })

  it('FIFO-caps seen_event_uuids at 200 entries', () => {
    const existing = makeExisting({
      seen_event_uuids: Array.from({ length: SEEN_EVENT_UUIDS_CAP }, (_, i) => `evt_${i}`),
    })
    const out = planSessionUpsert({
      event: makeEvent({ event_uuid: 'evt_NEW', event_name: '$pageview' }),
      existingSession: existing,
      identityAtStart: makeIdentity(),
    })
    expect(out.row.seen_event_uuids?.length).toBe(SEEN_EVENT_UUIDS_CAP)
    // Oldest (evt_0) is dropped, newest (evt_NEW) is appended at the end.
    expect(out.row.seen_event_uuids?.[0]).toBe('evt_1')
    expect(out.row.seen_event_uuids?.[SEEN_EVENT_UUIDS_CAP - 1]).toBe('evt_NEW')
  })

  it('handles events with no event_uuid (no dedup, counter still fires)', () => {
    const out = planSessionUpsert({
      event: makeEvent({ event_uuid: null, event_name: 'cart:product_added' }),
      existingSession: makeExisting({ carts_created_in_session: 2, seen_event_uuids: ['x'] }),
      identityAtStart: makeIdentity(),
    })
    expect(out.row.carts_created_in_session).toBe(3)
    expect(out.row.seen_event_uuids).toEqual(['x']) // unchanged — no uuid to append
  })
})

describe('planSessionUpsert — identity transitions', () => {
  it('checkout:started on anonymous session with email → email_acquired_via=checkout_started', () => {
    const out = planSessionUpsert({
      event: makeEvent({
        event_uuid: 'evt_checkout',
        event_name: 'checkout:started',
        email_on_event: 'newbie@test.com',
      }),
      existingSession: makeExisting({ email_at_session_start: null, email_acquired_in_session: false }),
      identityAtStart: makeIdentity(),
    })
    expect(out.row.email_acquired_in_session).toBe(true)
    expect(out.row.email_acquired_via).toBe('checkout_started')
    expect(out.row.email_at_session_end).toBe('newbie@test.com')
    // email_at_session_start stays null — that's the whole point of the transition.
    expect(out.row.email_at_session_start).toBeNull()
  })

  it('checkout:started on known session does NOT overwrite email_acquired_via', () => {
    const out = planSessionUpsert({
      event: makeEvent({
        event_uuid: 'evt_checkout',
        event_name: 'checkout:started',
        email_on_event: 'known@test.com',
      }),
      existingSession: makeExisting({
        email_at_session_start: 'known@test.com',
        email_acquired_in_session: false,
      }),
      identityAtStart: makeIdentity(),
    })
    // Session was NOT previously anonymous — no transition fires.
    expect(out.row.email_acquired_in_session).toBe(false)
    expect(out.row.email_acquired_via).toBeNull()
  })

  it('preserves a prior email_acquired_via=newsletter (set by the Klaviyo subscriber)', () => {
    const out = planSessionUpsert({
      event: makeEvent({ event_uuid: 'evt_pv', event_name: '$pageview' }),
      existingSession: makeExisting({
        email_acquired_in_session: true,
        email_acquired_via: 'newsletter',
      }),
      identityAtStart: makeIdentity(),
    })
    expect(out.row.email_acquired_in_session).toBe(true)
    expect(out.row.email_acquired_via).toBe('newsletter')
  })

  it('checkout:started with no email_on_event does NOT mark acquired', () => {
    const out = planSessionUpsert({
      event: makeEvent({
        event_uuid: 'evt_checkout',
        event_name: 'checkout:started',
        email_on_event: null,
      }),
      existingSession: makeExisting({ email_at_session_start: null }),
      identityAtStart: makeIdentity(),
    })
    expect(out.row.email_acquired_in_session).toBe(false)
    expect(out.row.email_acquired_via).toBeNull()
  })
})

describe('planSessionUpsert — segment classification at first event', () => {
  it('uses the resolved segment from identityAtStart', () => {
    for (const segment of ['unknown', 'known_no_purchase', 'returning_customer'] as const) {
      const out = planSessionUpsert({
        event: makeEvent({ event_uuid: `evt_${segment}` }),
        existingSession: undefined,
        identityAtStart: makeIdentity({ segment }),
      })
      expect(out.row.segment_at_session_start).toBe(segment)
    }
  })
})
