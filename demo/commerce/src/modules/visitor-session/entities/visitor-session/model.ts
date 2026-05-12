// VisitorSession — one row per `(distinct_id, $session_id)` tuple from
// PostHog. Snapshot of everything we knew about the visitor at the first
// event of the session (frozen) plus running counters and identity
// transitions across the lifetime of the session.
//
// Populated by:
//   - posthog-cart-tracker subscriber (live, every event with $session_id)
//   - syncPosthogEvents cron (rattrapage, same events from HogQL)
//   - backfill-visitor-sessions script (one-shot, 90d history) — Build 3
//
// Read by visitor-funnel queries — Build 3.
//
// Idempotency: the per-row `seen_event_uuids` array (FIFO cap 200) lets
// the live + cron + backfill paths dedupe counter increments across
// replays of the same event. See `upsert-session.ts`.

export default defineModel('VisitorSession', {
  // ── Identity ──────────────────────────────────────────────────────
  distinct_id: field.text().index(),
  session_id: field.text(),

  // ── Lifecycle timestamps ──────────────────────────────────────────
  started_at: field.dateTime().index(),
  last_event_at: field.dateTime(),

  // ── Counters (incremented per matching event) ─────────────────────
  pageviews_count: field.number().default(0),

  // ── Identity at the boundaries of the session ─────────────────────
  email_at_session_start: field.text().nullable(),
  email_at_session_end: field.text().nullable(),
  contact_id: field.text().nullable().index(),
  segment_at_session_start: field.enum(['unknown', 'known_no_purchase', 'returning_customer']).index(),

  // ── First-touch attribution (frozen on first event) ───────────────
  first_url: field.text().nullable(),
  utm_source: field.text().nullable(),
  utm_medium: field.text().nullable(),
  utm_campaign: field.text().nullable(),
  referring_domain: field.text().nullable(),
  is_paid_session: field.boolean().default(false).index(),

  // ── Cart activity within the session ──────────────────────────────
  carts_created_in_session: field.number().default(0),
  carts_updated_in_session: field.number().default(0),
  cart_converted: field.boolean().default(false).index(),
  order_id: field.text().nullable(),

  // ── Identity acquisition (newsletter / checkout_started) ──────────
  email_acquired_in_session: field.boolean().default(false),
  email_acquired_via: field.enum(['newsletter', 'checkout_started']).nullable(),

  // ── Idempotency (per-session dedup of counter increments) ─────────
  // FIFO-capped at 200 entries; replays of the same event_uuid are skipped.
  seen_event_uuids: field.json<string[]>().nullable(),
})
