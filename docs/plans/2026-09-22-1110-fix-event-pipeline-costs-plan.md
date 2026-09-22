---
artifact_contract: ce-unified-plan/v1
product_contract_source: conversation-approved-proposal
execution: code
---
# Reliable event processing with bounded diagnostic retention

## Goal Capsule
Reduce Palas database work while preserving CRM projections and advertising delivery. Implement in the admin repository on the deployed main baseline; retain pinned Manta beta.12 and all production mappings. User authorized implementation of the discussed proposal. Root orchestrator owns verification and delivery; no production data deletion during development. Stop a rollout if conversion parity or durable recovery cannot be demonstrated. Prefer a reviewed PR with explicit rollout evidence over an unverified production cutover.

## Product Contract
### Problem Frame
PostHog recovery repeatedly reprocesses 24h of cart events; lifecycle rereads 36 days and can delete facts before an oversized insert fails. Delivery state doubles as diagnostic storage. Workflow history is much larger than the advertised 24h tracking display.
### Requirements
R1 Preserve carts, contact identity, consent, orders, visitor sessions, attribution and connector mapping semantics.
R2 Process canonical ad events promptly and durably, without resetting delivered events on replay; recover partial persistence and transient failures. Preserve retry fallback until delivery parity is verified.
R3 Keep detailed terminal tracking diagnostics for 24h; retain active delivery payloads and compact deduplication receipts separately. Never delete pending workflows or commerce business history. Pending delivery expiration is not silently introduced.
R4 PostHog recovery must progress with a durable cursor, skip already successful UUIDs, prevent overlap, retry failures without blocking healthy later events, and cover late arrivals. Preserve live ingestion and the safety-net schedule.
R5 Lifecycle recomputation must be atomic, support >4,250 actors, return aggregates rather than all sessions where practical, and skip unchanged historical days while recognizing late attribution changes.
R6 Verification uses isolated data, no real advertising sends. Delivery rollout requires before/after counters and rollback. No new infrastructure vendor or framework upgrade.
### Acceptance Examples
A replay of a delivered purchase must not queue it again. A failed destination write is repaired on replay. Two dispatchers must not claim the same active send. A transient provider failure remains recoverable beyond 24h. Expired successful diagnostics disappear while CRM data and delivery receipts remain. A poison recovery event must neither be forgotten nor block subsequent pages. A failed facts refresh leaves previous facts and snapshot consistent.

## Planning Contract
KTD1 Reuse existing event/dispatch tables and stable event_destination_key; atomic conditional claims with stale recovery, fencing on result writes, durable first persistence before external I/O. Keep minute crons as targeted recovery; immediate sends use the same runner. No claim of exactly-once external delivery after uncertain network acknowledgment.
KTD2 Compact successful terminal diagnostics 24h after terminal completion (not source event time), keep compact identifiers indefinitely for replay protection until an explicit replay-age limit is defined, never age-delete unfinished sends including not_configured/error. No destructive bulk purge; bounded batches. Workflow housekeeping limited to explicitly allowlisted completed high-volume tracking commands, never active/recoverable runs or business commands; inspect pinned storage references first.
KTD3 Dedicated PostHog cursor/receipt/lease state in an additive migration. Bounded pages, stable timestamp/UUID ordering, separate retry state; retain 24h overlap but dedup before invoking expensive commands. Existing scheduled fallback remains until live-path completeness can be proven, not disabled speculatively.
KTD4 Lifecycle SQL aggregation preserves existing fold semantics; single-statement atomic replacement or adapter-supported transaction (never BEGIN across pooled independent raw calls). Changed-day detection includes updated_at and deletions, not only last_event_at. Manual rebuild remains available.
KTD5 No production destructive cleanup or VACUUM FULL. PR documents staged activation and rollback; measure Neon/network and business counters after actual rollout. A pending Linear issue is blocked by connector reauthentication, not by code work.

## Implementation Units
### U1. Reliable immediate advertising delivery
Requirements R1,R2,R6. Dependencies none.
Files: event-hub dispatch-runner, canonical recording command, alternate ingest route, connector-related focused tests; additive schema only if necessary (own migration distinct from U2).
Approach: atomic claims and fenced finalization, preserve sent state, repair missing destination rows on duplicate event, prompt sending to configured destinations through shared runner, avoid repeated work for disabled destinations. Verify exception recovery, stale workers, duplicate/concurrent calls and partial persistence. Characterization/proof-first with existing dispatch tests.
### U2. Incremental PostHog recovery
Requirements R1,R4,R6. Dependencies none.
Files: sync-posthog-events command, posthog-sync helpers, new recovery module/migration, focused sync tests only.
Approach: durable bounded progress, successful UUID receipts, lease protection, independent bounded failed-event retries and late-arrival overlap. No alterations to CRM ingestion semantics. Test >5000 events, equal timestamps, repeated UUID, failed event retry, interruption, lease overlap and late arrivals. Migration/schema ownership separate from U1/U3.
### U3. Atomic incremental lifecycle facts
Requirements R1,R5,R6. Dependencies none.
Files: visitor-session/lifecycle-facts, corresponding job and focused tests only.
Approach: preserve fold semantics with SQL aggregation and atomic persistence, only refresh changed days including metadata-only changes. Keep manual rebuild mode. Test 4250 actors, atomic failure, empty/deleted sessions, late attribution, unchanged skip and aggregate parity.
### U4. Bounded diagnostics and workflow history
Requirements R1,R3,R6. Dependencies U1 behavior contract.
Files: purge-event-hub-logs job, retention helper, focused retention tests, tracking-health labels if needed; migration distinct from others.
Approach: scrub terminal payloads after24h; keep compact receipts and all active sends. Prune allowlisted completed tracking workflow records only after validating pinned checkpoint dependencies. Batches with bounded work. Expose true24h diagnostic retention rather than selected display window. Verify exact boundary and preservation of active/commercial workflows.
### U5. Verification and delivery
Requirements all. Dependencies U1–U4.
Files: verification/runbook under docs, necessary integration tests; orchestrator owns package/lock/config changes.
Run focused and full suites, targeted lint, typecheck, isolated PostgreSQL integration, browser tracking-health if UI changed. Simplify and independent code review. Prepare PR and attach; production activation only with concrete tested migration/rollback and no unexplained regression.

## Verification Contract
Use pnpm frozen install with pinned beta.12, pnpm exec vitest run demo/commerce/tests plus changed command tests, pnpm typecheck and targeted Biome. PostgreSQL tests against throwaway local DB only (explicit URL); no production connection inheritance. Inspect full checks for baseline failures. Real browser test of changed tracking-health display with seeded local fixture if required. Use existing connector fixtures; mock HTTP transport only, real PostgreSQL for persistence/concurrency/retention. Test cancellation and provider timeout; compare old/new business projection outputs for representative replay fixtures.

## Definition of Done
All U1–U4 behaviors implemented and exercised; no unrelated edits or discarded user changes. No upgrade to central Manta. Tests and independent review recorded, abandoned approaches removed. Migration and rollback documented with retention caveats. PR concrete and reviewable, live rollout state explicit; do not claim savings or production changes from local tests. Any unmet production rollout gate remains explicitly outstanding.

## Review follow-up: cart ordering and CI
The independent review reproduced an older failed event overwriting a newer cart snapshot on retry. Extend U2 verification to execute the actual cart command, rather than only a mocked ingest callback. Preserve the latest snapshot atomically under reordered and concurrent writes, while retaining late completion and retryable contact/attribution work. Old identities must not replace a newer cart/contact association. Cover old/new/retry ordering, clear-cart events, late completion, concurrent writes and failed follow-ups using isolated PostgreSQL where persistence matters.

U5 must also pass from a clean GitHub checkout. Fix the Docker health-check argument quoting, then inspect every CI step for further setup defects. Validate the application build and browser entry point; do not exercise mutation routes against a preview sharing production database credentials. Record any limitation of an isolated runtime's substitute adapters.
