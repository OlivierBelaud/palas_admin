# Vercel cron audit - 2026-06-22

## Verdict

The minute-by-minute test cron was real and should not have been scheduled in production.

Removed from the active Vercel schedule and from source so Manta cannot regenerate it:

- `/api/crons/test-abandoned-cart-random` - `* * * * *`
- `/api/crons/backfill-cart-abandoned-may-8` - `* 4-7 * * *`

The first one was a test email sender targeting a hardcoded personal inbox every minute. The second one was a dated one-off May 8 backfill whose own comment said it should be removed after a few days.

## Deployment clarification

Vercel crons do not deploy the app. They call HTTP routes on the already deployed production app.

The double-deploy risk came from having more than one local Vercel project link. That has been rationalized: only the repository root keeps `.vercel/project.json`.

## Active production crons kept

| Cron | Schedule | Verdict | Reason |
| --- | --- | --- | --- |
| `/api/crons/detect-abandoned-carts` | `0 * * * *` | Keep | Core abandoned cart campaign runner. |
| `/api/crons/flush-ga4-dispatches` | `* * * * *` | Keep/review | Real event dispatch queue. Minute cadence is valid for near-real-time analytics, but can be reduced to `*/5` if Vercel noise/cost matters. |
| `/api/crons/flush-google-ads-dispatches` | `* * * * *` | Keep/review | Real Google Ads dispatch queue. Same cadence tradeoff as GA4. |
| `/api/crons/purge-event-hub-logs` | `0 */4 * * *` | Keep | Cleanup of hot event/dispatch logs. |
| `/api/crons/reconcile-shopify-daily` | `30 6 * * *` | Keep | Daily safety reconciliation for Shopify orders. |
| `/api/crons/reconcile-shopify-orders` | `*/15 * * * *` | Keep | Recent paid order reconciliation; useful when webhooks/events are missed. |
| `/api/crons/refresh-visitor-lifecycle-facts` | `*/5 * * * *` | Keep/review | Keeps CRM visitor lifecycle facts fresh. Could be reduced to `*/15` if dashboard freshness does not need five minutes. |
| `/api/crons/run-system-audits-nightly` | `0 0 * * *` | Keep | Nightly CRM/system quality audits. |
| `/api/crons/send-daily-reporting-email` | `0 3 * * *` | Keep | Daily reporting email. |
| `/api/crons/sync-from-shopify` | `45 * * * *` | Keep | Hourly Shopify contacts/orders sync. |
| `/api/crons/sync-klaviyo-events` | `20 * * * *` | Keep | Hourly Klaviyo event ingestion. |
| `/api/crons/sync-posthog-events` | `*/5 * * * *` | Keep | Pulls recent PostHog cart/checkout events. |
| `/api/crons/sync-visitor-sessions` | `*/5 * * * *` | Keep | Materializes visitor session data for CRM views. |

## Source job not currently scheduled

| Job | Source schedule | Active in Vercel? | Action |
| --- | --- | --- | --- |
| `flush-meta-capi-dispatches` | `* * * * *` | No | Leave unscheduled until Meta CAPI is explicitly enabled, or delete if the Meta CAPI work is abandoned. |

## Guardrail added

`AGENTS.md` now states:

- Git-driven Vercel deployment only.
- Never run `vercel deploy`, `vercel deploy --prod`, or `vercel deploy --prebuilt`.
- No nested Vercel project links under `demo/commerce`.
- No Vercel cron for tests, personal-inbox emails, or temporary backfills.
- Temporary backfills must be manual scripts/commands with an operator decision.

## Verification

- Only one local Vercel link remains: `/home/olivier/BRUTAL/PALAS_WORKSPACE/crm/.vercel/project.json`.
- `demo/commerce/vercel.json` parses as valid JSON.
- All `vercel.json` files parse as valid JSON.
- No remaining source or active config reference to:
  - `test-abandoned-cart-random`
  - `testSendRandomAbandonedCart`
  - `test-send-random-abandoned-cart`
  - `backfill-cart-abandoned-may-8`
- `pnpm typecheck` passes.
