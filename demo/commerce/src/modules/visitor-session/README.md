# visitor-session

One row per `(distinct_id, $session_id)` from PostHog. Captures everything
we knew about a visitor at the start of their session (frozen: attribution,
segment, email_at_start) plus running counters and identity transitions
across the session's lifetime.

## What it is

A **snapshot table**, not an event log. PostHog remains the source of
truth for individual events. `visitor_sessions` is the folded state used
to answer questions like "how many unique paid-source visitors converted
on day D?" without paying the cost of a HogQL aggregation every time.

Conceptually parallel to `carts` for cart events: PostHog → folded
snapshot in Postgres, queried by the admin dashboard.

## Who populates it

Three paths, all idempotent (per-row `seen_event_uuids` FIFO cap 200):

1. **Live** — `subscribers/posthog-cart-tracker.ts` dispatches
   `upsertVisitorSessionFromEvent` for every event with `$session_id` and
   `distinct_id` (cart events AND others, e.g. `$pageview`,
   `checkout:started`).
2. **Cron rattrapage** — `commands/admin/sync-posthog-events.ts` (every
   5min) replays the same events from PostHog HogQL to recover anything
   that bypassed our proxy (e.g. Shopify Web Pixel direct ingestion).
3. **Backfill** (Build 3) — `scripts/backfill-visitor-sessions.ts`
   reconstructs the last 90 days from PostHog event history.

## Late-update flows

Two writes happen *after* the session has already been created:

- **Cohort conversion attribution**: when a cart transitions to
  `checkout:completed`, `commands/admin/attribute-session-conversion.ts`
  finds the session active at `cart_birth_at` and stamps
  `cart_converted = true, order_id = X`.
- **Newsletter identity acquisition**: when the Klaviyo bridge in
  `plugin-posthog-proxy` resolves an email, it emits
  `posthog.klaviyo_identity_resolved`. The
  `klaviyo-identity-to-session` subscriber dispatches
  `markSessionEmailAcquired` which stamps the currently-open session.

The checkout-started identity transition is detected inline by
`planSessionUpsert` (no separate subscriber).

## Who reads it

- `queries/admin/visitor-session-daily-stats.ts` (Build 3) — daily KPIs
  split by `segment_at_session_start` and `is_paid_session`.
- Admin dashboard page `/admin/visitor-stats` (Build 3).

## Session close

There is no explicit close. `last_event_at` is the proxy for "alive".
Queries that need closed sessions filter
`WHERE last_event_at < NOW() - INTERVAL '30 minutes'`.

## Bootstrap

Schema is created by `scripts/bootstrap-visitor-sessions.ts` — idempotent,
registers itself in `_manta_migrations`. Olivier runs it manually
(local + prod) per the Build 1 / Build 2 pattern.
