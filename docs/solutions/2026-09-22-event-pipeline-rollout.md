# Event pipeline cost reduction: rollout and evidence

## Scope and invariants
Admin-only change based on deployed main cde2fb7. Keep Manta0.2.0-beta.12; no deployment/domain changes. PostHog remains analytics storage. CRM projections, consent mappings and stable provider event IDs remain. Diagnostic retention is24h after terminal completion; active/disabled/error delivery payloads and compact dedup receipts survive. No cron that delivers or recovers commerce events is removed.

## Preparation and rollout
1. Use an isolated database for all automated tests. Set PALAS_TEST_DATABASE_URL only to localhost and a test database. CI provisions disposable PostgreSQL16; tests send no real advertising requests.
2. Apply additive migrations 20260922111000_event_dispatch_prepared.sql and20260922113000_posthog_recovery.sql before activating the new application. Review index creation against actual event_logs size; migration execution is separate from the Vercel build (--no-migrate). Never run a schema push that removes manual recovery tables.
3. Deploy through the existing Git-driven Vercel project only, after preview/runtime validation. No direct CLI production deployment. Do not share production credentials with preview jobs or run advertising-enabled preview ingestion.
4. Observe first two cron cycles: no undefined table/column errors, recovery busy only for genuinely active lease, forward cursor progress, failed rows retained, all3configured destinations drained. Observe24h before treating cost reduction as established. Compare source event IDs/purchase IDs and destination acceptance counts, not just HTTP200 on the cron.
5. Run lifecycle manual refresh on affected dates only if needed; scheduled refresh repairs differing days automatically, including earlier misleading ready snapshots (no source_signature).

## Retention behavior and backlog
Each purge pass handles at most1000rows per category; job admits at most50passes within10seconds. It is not a hard SQL execution timeout. Existing four-hour schedule remains; policy is24h eligibility, so deletion/compaction is eventual (normally up to28h plus backlog). Old history drains gradually; no bulk delete, table rewrite or VACUUM FULL. Normal PostgreSQL autovacuum can reuse freed space; do not promise immediate physical disk shrink.

Only succeeded tracking commands are removed: cmd:recordCanonicalEventLog, cmd:ingestCartEvent, cmd:refreshCart, cmd:refreshContact, cmd:syncPosthogEvents. Failed/pending/paused workflows and business commands survive. beta.12 source establishes checkpoint transaction_id=run.id; manager.resume does not resume succeeded workflows. Checkpoints and run removed in one SQLstatement. Old completed tracking workflow detail views can no longer show purged executions; commerce records remain.

Event IDs and destination receipts are never age-deleted: ingestion/replay has no maximum age. Terminal payloads are nulled; replay cannot resend a sent receipt. Partially provisioned envelopes remain until automatic recovery has persisted all destinations. Envelopes with unfinished deliveries retain data needed for recovery. Legacy malformed stored JSON is handled by repair; invalid payloads are visible rather than sent. Permanent provider errors are not automatically retried; explicit corrected replay can repair unsent errors.

## Operational validation and rollback
Owner: Palas operator. Compare perday public_network_transfer_bytes, CU-hours and workflow growth to Sept16–21 baseline (~36.26GB/day for Palas), plus cart/contact/session projections and per-destination purchase counts. No saving guarantee from unit tests.

Rollback if business projections diverge, required conversion destinations lose events, consent differs, or pending age increases without provider outage. Keep additive tables/receipts; stop automated destructive cleanup before reverting to old purge (old code deletes seven-day receipts regardless of status). Disable that purge route/schedule as part of rollback configuration, preserve all pending and compact receipts, and deploy rollback through Git. Already removed diagnostic history cannot be restored without a prior backup. New recovery cursor/receipts should not be dropped when rolling back: retained state avoids replay storms when retrying rollout.

## Evidence and known tooling limits
Local characterization: deployed4250actor refresh failed MAX_PARAMETERS_EXCEEDED before change. New realPostgreSQL tests verify4250success, injectedfailure preserves oldfacts+snapshot, metadata change hidden by future timestamp, unchangedskip, deletion and JSaggregate parity.

Delivery tests use actual SQL for concurrentclaims, staleattemptfencing, timeout/cancellation recovery, duplicate/correctedinvalid replay, incomplete45dayenvelope repair and all-destination atomicity. Recovery tests cover5003equal-microsecond events, frozen boundedpages,24hoverlap, poison retries, lease takeover, latearrival and swallowedrefresh failure. A live read-only PostHog constantquery verified microsecond toDateTime64 syntax; no customerdata queried.

Original fullsuite had one identity-resolver misscounter failure before modifications. Minimal metrics-only catch increment resolves its existing assertion without changing returned identity or caching. Standard Biome cannot load missing .claude/biome-plugins/no-raw-error.grit; changed files checked with identical temporaryconfig minus that unavailable plugin. Fulltypecheck runs with pinned dependencies.

Code review: harness-native fallback. FullCEpersona orchestration could not complete due to agentcapacity; independent source review identified three realdurability/replay findings, allcorrected and regressiontested. Separate finalsource rereview verifies closure. Simplification reuse/quality/efficiency pass performedinline under samecapacity limitation; retained correctnessguards, projected lifecycle sourcecolumns and batched no-op receipt cursor writes. Linear ticket unavailable: connector requires reauthentication.

## Durable lessons
- A display window is not a retention policy; queue state and diagnostic payload lifetimes must be separated.
- Deduplication can remove accidental recovery: confirm downstream business completion before issuing a successful receipt.
- Preserve prepared envelopes as an outbox recovery source; an early duplicate return can hide missing destination rows.
- With postgres.js raw bound JSON.stringify parameters, use ::text::jsonb to avoid storing a JSONstring where a JSONobject/array was intended.
- Pooled raw BEGIN/COMMIT calls are not a transaction. Atomic multiwrite CTEs avoid partial publication and parameter counts proportional to visitors.

Final local verification: 41 test files / 262 tests passed, including all isolated PostgreSQL cases; pnpm typecheck passed; 30 changed TypeScript files passed scoped Biome with the missing-plugin exception above; git diff --check passed. Vercel-preset local build was attempted and stopped on absent isolated DATABASE_URL/Upstash/QStash/Blob configuration and nondurable fallback file adapter. Code generation also emitted extensionless-import warnings; do not count this build as production-runtime validation. Preview build/runtime validation and production migrations remain release gates. No production schema/data changes or advertising calls were made.

## Follow-up verification, September 22

The independent review found a reproducible ordering regression: event A updated a cart but failed contact enrichment; newer event B succeeded; retrying A replaced B's items, amount and timestamp while B's successful receipt prevented another replay. The original 262 tests did not cover that same-cart sequence. The correction therefore protects snapshot ordering at the database write and fences cart/contact linking against the current cart identity; additional tests must exercise the actual command and concurrent PostgreSQL writes.

GitHub's initial verification failed before tests because its Docker argument parser did not preserve the single-quoted health command. Commit `2f77850` fixes the quoting; a clean GitHub runner then passed typecheck and all 262 existing tests. These results precede the ordering correction and are not its final validation.

A read-only production schema query confirmed that `dispatch_prepared_at`, `posthog_recovery_state` and `posthog_recovery_receipts` are absent. Apply both additive migrations before the production deployment. Preview and production share the configured database environment value, so preview mutation and cron execution are not an isolated test environment.

Both SQL migration files apply successfully twice on a disposable local PostgreSQL database. The actual Vercel handler can be exercised locally with external calls blocked: this avoids unrelated issues in the beta.12 Node-preset/Jiti test launcher. Static generation warnings alone do not prove missing runtime routes; inspect the booted handler and its registered commands/jobs instead. Any fixture or substitute cache used in that check is not evidence of live provider delivery.

After correction: 42 test files / 273 tests pass, including 11 PostgreSQL ordering cases. They cover failed A / successful B / retry A through the actual recovery and ingestion functions, cleared carts, late checkout completion, missing versus conflicting identity, microseconds, exact timestamp ties, 16 concurrent writers and 12 concurrent contact links. Exact timestamp ties retain the first snapshot, while compatible missing fields and conversion facts remain enrichable. Typecheck, scoped Biome and whitespace checks pass.

The Vercel-built handler was also exercised through authenticated HTTP on an isolated database derived from the published Manta model/link definitions: old email / 10 EUR, new email / 20 EUR, then replay old email / 10 EUR. All 12 resulting ingestion, contact and refresh workflows succeeded. Final HTTP/database reads retained 20 EUR, the newer timestamp and the sole link to the newer email. Upstash/QStash transport was simulated locally and outbound provider calls were blocked; this is not live advertising-provider verification. The three advertising crons with disabled connectors returned without delivery, and requests without a cron secret were rejected.

Independent source review found no remaining blocker in the correction. Reuse/quality review retained the concurrency guards and removed unused create-payload work from the update path; the efficiency pass ran inline after the agent thread limit was reached. Existing maintenance/Shopify link writers were not rewritten, so these tests establish ordering for event ingestion rather than global serialization of every application writer. Production remains unchanged and still requires the two additive migrations before activation.
