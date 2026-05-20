// Pure planner for visitor-session upserts.
//
// `planSessionUpsert` takes:
//   1. The event we're processing (already normalised: event_name, occurred_at,
//      email_on_event?, event_uuid?, attribution fields).
//   2. The existing session row (if any) — `undefined` means this is the
//      first event of `(distinct_id, session_id)` we've ever seen.
//   3. The resolved identity-at-session-start (`contact_id`, `email`,
//      `segment_at_session_start`) — computed by the caller via a Contact
//      lookup. The pure planner does NOT do any I/O.
//
// Returns a `SessionUpsertIntent` describing the row to upsert. The caller
// applies it via `step.service.visitorSession.upsertWithReplace(...)`.
//
// Rules (locked, see plan §Phase C2):
//   - FIRST event of session (existingSession undefined): freeze
//     started_at, email_at_session_start, contact_id,
//     segment_at_session_start, first_url, utm_*, referring_domain,
//     is_paid_session.
//   - ALWAYS update: last_event_at, email_at_session_end.
//   - Counters by event_name:
//       cart:viewed                                                 → carts_viewed_in_session += 1
//       cart:product_added                                          → carts_created_in_session += 1
//       cart:product_removed | cart:updated | cart:cleared
//         | cart:discount_applied                                   → carts_updated_in_session += 1
//       $pageview                                                   → pageviews_count += 1
//   - Identity transition: if existing.email_at_session_start IS NULL
//     AND event === 'checkout:started' AND email_on_event is present
//     ⇒ email_acquired_in_session=true, email_acquired_via='checkout_started',
//        email_at_session_end=email_on_event.
//   - Idempotency: if event_uuid is in existing.seen_event_uuids,
//     skip ALL counter increments (we've already counted this event).
//     Otherwise append to the array and FIFO-cap at 200 entries.

import { extractAttribution } from './attribution'

export type SessionSegment = 'unknown' | 'known_no_purchase' | 'returning_customer'

export type EmailAcquisitionVia = 'newsletter' | 'checkout_started'

/**
 * Normalised event input — already extracted from PostHog. The caller
 * is responsible for pulling these out of `evt.properties`.
 */
export interface PlanSessionEventInput {
  /** Required: the (distinct_id, session_id) keys are checked upstream. */
  distinct_id: string
  session_id: string
  /** PostHog event uuid, used for per-session dedup of counter increments. */
  event_uuid?: string | null
  /** Event name (`cart:product_added`, `$pageview`, `checkout:started`, …). */
  event_name: string
  /** ISO-8601 timestamp of the event. */
  occurred_at: string
  /** Email observed on this event (from $set.email or checkout payload). */
  email_on_event?: string | null
  /** First-url + utm_* + referring_domain — frozen on first event. */
  current_url?: string | null
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  referring_domain?: string | null
}

/**
 * Resolved identity at the start of the session. Computed once by the
 * orchestration command (`upsertVisitorSessionFromEvent`) — the pure
 * planner reads it as data.
 */
export interface IdentityAtStart {
  contact_id: string | null
  email: string | null
  segment: SessionSegment
}

/**
 * Existing session row (subset of fields read by the planner). When this
 * is `undefined`, we know we're the first event of the session.
 */
export interface ExistingSession {
  id: string
  started_at: Date | string
  last_event_at: Date | string
  pageviews_count: number
  email_at_session_start: string | null
  email_at_session_end: string | null
  contact_id: string | null
  segment_at_session_start: SessionSegment
  first_url: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  referring_domain: string | null
  is_paid_session: boolean
  carts_created_in_session: number
  carts_viewed_in_session?: number
  carts_updated_in_session: number
  cart_converted: boolean
  order_id: string | null
  became_customer_in_session?: boolean
  became_customer_at?: Date | string | null
  email_acquired_in_session: boolean
  email_acquired_via: EmailAcquisitionVia | null
  email_acquired_at?: Date | string | null
  seen_event_uuids: string[] | null
}

/**
 * The output of `planSessionUpsert` — a row ready for
 * `upsertWithReplace([row], replaceFields, ['distinct_id', 'session_id'])`.
 * Includes the conflict-target columns so the upsert knows where to land.
 */
export interface SessionUpsertIntent {
  row: SessionUpsertRow
  /** Columns to overwrite on conflict. Includes counter increments. */
  replaceFields: string[]
  /** Conflict target — always `['distinct_id', 'session_id']` for v1. */
  conflictTarget: ['distinct_id', 'session_id']
}

export interface SessionUpsertRow {
  distinct_id: string
  session_id: string
  started_at: Date
  last_event_at: Date
  pageviews_count: number
  email_at_session_start: string | null
  email_at_session_end: string | null
  contact_id: string | null
  segment_at_session_start: SessionSegment
  first_url: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  referring_domain: string | null
  is_paid_session: boolean
  carts_created_in_session: number
  carts_viewed_in_session: number
  carts_updated_in_session: number
  cart_converted: boolean
  order_id: string | null
  became_customer_in_session: boolean
  became_customer_at: Date | null
  email_acquired_in_session: boolean
  email_acquired_via: EmailAcquisitionVia | null
  email_acquired_at: Date | null
  seen_event_uuids: string[] | null
}

/** FIFO cap on `seen_event_uuids`. See plan §C2 — "no event_uuid storage in
 * posthog_event_log; per-session array is V1 dedup". */
export const SEEN_EVENT_UUIDS_CAP = 200

/** Event names that should bump `carts_created_in_session`. */
const CART_CREATE_EVENTS = new Set(['cart:product_added'])

/** Event names that should bump `carts_viewed_in_session`. */
const CART_VIEW_EVENTS = new Set(['cart:viewed'])

/** Event names that should bump `carts_updated_in_session`. */
const CART_UPDATE_EVENTS = new Set(['cart:product_removed', 'cart:updated', 'cart:cleared', 'cart:discount_applied'])

export interface PlanSessionUpsertArgs {
  event: PlanSessionEventInput
  existingSession: ExistingSession | undefined
  identityAtStart: IdentityAtStart
}

export function planSessionUpsert(args: PlanSessionUpsertArgs): SessionUpsertIntent {
  const { event, existingSession, identityAtStart } = args
  const occurredAt = new Date(event.occurred_at)

  // ── 1. Idempotency: if we've already seen this event_uuid for this
  //      session, do NOT increment counters again. We still bump
  //      last_event_at because a duplicate is still "alive" signal.
  const alreadySeen = event.event_uuid != null && existingSession?.seen_event_uuids?.includes(event.event_uuid) === true

  // ── 2. Build attribution (frozen on first event only) ────────────
  const attribution = extractAttribution({
    properties: {
      $current_url: event.current_url ?? undefined,
      utm_source: event.utm_source ?? undefined,
      utm_medium: event.utm_medium ?? undefined,
      utm_campaign: event.utm_campaign ?? undefined,
      $referring_domain: event.referring_domain ?? undefined,
    },
  })

  // ── 3. seen_event_uuids — append + FIFO cap ─────────────────────
  let nextSeen: string[] | null = existingSession?.seen_event_uuids ?? null
  if (event.event_uuid && !alreadySeen) {
    const base = nextSeen ?? []
    nextSeen = [...base, event.event_uuid]
    if (nextSeen.length > SEEN_EVENT_UUIDS_CAP) {
      nextSeen = nextSeen.slice(nextSeen.length - SEEN_EVENT_UUIDS_CAP)
    }
  }

  // ── 4. Counter increments — skipped on duplicate event_uuid ────
  let cartsCreated = existingSession?.carts_created_in_session ?? 0
  let cartsViewed = existingSession?.carts_viewed_in_session ?? 0
  let cartsUpdated = existingSession?.carts_updated_in_session ?? 0
  let pageviews = existingSession?.pageviews_count ?? 0
  if (!alreadySeen) {
    if (CART_VIEW_EVENTS.has(event.event_name)) cartsViewed += 1
    else if (CART_CREATE_EVENTS.has(event.event_name)) cartsCreated += 1
    else if (CART_UPDATE_EVENTS.has(event.event_name)) cartsUpdated += 1
    else if (event.event_name === '$pageview') pageviews += 1
  }

  // ── 5. Identity at boundaries ────────────────────────────────────
  // email_at_session_start: frozen on first event (existing wins).
  const emailAtSessionStart = existingSession
    ? existingSession.email_at_session_start
    : (identityAtStart.email ?? event.email_on_event ?? null)

  // email_at_session_end: the most recent email we've seen on any event.
  // Tracks transitions across the session lifetime.
  const emailAtSessionEnd =
    event.email_on_event ?? existingSession?.email_at_session_end ?? identityAtStart.email ?? null

  // Identity acquisition rules:
  //   - newsletter is set by a separate command (markSessionEmailAcquired)
  //     when the Klaviyo bridge resolves an email.
  //   - checkout_started fires inline here: if the previously-anonymous
  //     session emits checkout:started with an email, stamp the flag.
  let emailAcquired = existingSession?.email_acquired_in_session ?? false
  let emailAcquiredVia: EmailAcquisitionVia | null = existingSession?.email_acquired_via ?? null
  let emailAcquiredAt = existingSession?.email_acquired_at ? toDate(existingSession.email_acquired_at) : null

  const previouslyAnon = existingSession ? existingSession.email_at_session_start == null : false
  if (previouslyAnon && event.email_on_event != null && event.email_on_event.length > 0 && !emailAcquired) {
    emailAcquired = true
    emailAcquiredVia = event.event_name === 'checkout:started' ? 'checkout_started' : 'newsletter'
    emailAcquiredAt = occurredAt
  }

  // ── 6. Build the row ─────────────────────────────────────────────
  if (!existingSession) {
    // First event of the session — freeze attribution + segment + identity.
    const row: SessionUpsertRow = {
      distinct_id: event.distinct_id,
      session_id: event.session_id,
      started_at: occurredAt,
      last_event_at: occurredAt,
      pageviews_count: pageviews,
      email_at_session_start: emailAtSessionStart,
      email_at_session_end: emailAtSessionEnd,
      contact_id: identityAtStart.contact_id,
      segment_at_session_start: identityAtStart.segment,
      first_url: attribution.first_url,
      utm_source: attribution.utm_source,
      utm_medium: attribution.utm_medium,
      utm_campaign: attribution.utm_campaign,
      referring_domain: attribution.referring_domain,
      is_paid_session: attribution.is_paid_session,
      carts_viewed_in_session: cartsViewed,
      carts_created_in_session: cartsCreated,
      carts_updated_in_session: cartsUpdated,
      cart_converted: false,
      order_id: null,
      became_customer_in_session: false,
      became_customer_at: null,
      email_acquired_in_session: emailAcquired,
      email_acquired_via: emailAcquiredVia,
      email_acquired_at: emailAcquiredAt,
      seen_event_uuids: nextSeen,
    }
    return { row, replaceFields: ALL_REPLACE_FIELDS, conflictTarget: ['distinct_id', 'session_id'] }
  }

  // Subsequent event — preserve frozen fields, update the rest.
  const startedAt = toDate(existingSession.started_at)
  const lastEventAt =
    occurredAt.getTime() >= toDate(existingSession.last_event_at).getTime()
      ? occurredAt
      : toDate(existingSession.last_event_at)

  const row: SessionUpsertRow = {
    distinct_id: event.distinct_id,
    session_id: event.session_id,
    started_at: startedAt, // frozen
    last_event_at: lastEventAt, // monotonic
    pageviews_count: pageviews,
    email_at_session_start: emailAtSessionStart, // frozen
    email_at_session_end: emailAtSessionEnd,
    contact_id: existingSession.contact_id, // frozen
    segment_at_session_start: existingSession.segment_at_session_start, // frozen
    first_url: existingSession.first_url, // frozen
    utm_source: existingSession.utm_source, // frozen
    utm_medium: existingSession.utm_medium, // frozen
    utm_campaign: existingSession.utm_campaign, // frozen
    referring_domain: existingSession.referring_domain, // frozen
    is_paid_session: existingSession.is_paid_session, // frozen
    carts_viewed_in_session: cartsViewed,
    carts_created_in_session: cartsCreated,
    carts_updated_in_session: cartsUpdated,
    cart_converted: existingSession.cart_converted, // updated by attributeSessionConversion only
    order_id: existingSession.order_id, // ditto
    became_customer_in_session: existingSession.became_customer_in_session ?? false,
    became_customer_at: existingSession.became_customer_at ? toDate(existingSession.became_customer_at) : null,
    email_acquired_in_session: emailAcquired,
    email_acquired_via: emailAcquiredVia,
    email_acquired_at: emailAcquiredAt,
    seen_event_uuids: nextSeen,
  }
  return { row, replaceFields: ALL_REPLACE_FIELDS, conflictTarget: ['distinct_id', 'session_id'] }
}

/**
 * The columns we want the upsert ON CONFLICT to overwrite. Excludes
 * `cart_converted` and `order_id` — those are owned by
 * `attributeSessionConversion` and we must NOT clobber them from the
 * event-driven path (cohort late-update can fire BEFORE all session
 * events have been ingested).
 */
const ALL_REPLACE_FIELDS: string[] = [
  'last_event_at',
  'pageviews_count',
  'email_at_session_end',
  'carts_viewed_in_session',
  'carts_created_in_session',
  'carts_updated_in_session',
  'email_acquired_in_session',
  'email_acquired_via',
  'email_acquired_at',
  'seen_event_uuids',
]

function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v)
}
