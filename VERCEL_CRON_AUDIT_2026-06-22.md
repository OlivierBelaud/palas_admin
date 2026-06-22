# Vercel cron audit - 2026-06-22

## Verdict

The minute-by-minute test cron was real and should not have been scheduled in production.

Removed from source so Manta cannot regenerate it:

- `/api/crons/test-abandoned-cart-random` - `* * * * *`
- `/api/crons/backfill-cart-abandoned-may-8` - `* 4-7 * * *`

The first one was a test email sender targeting a hardcoded personal inbox every minute. The second one was a dated one-off May 8 backfill whose own comment said it should be removed after a few days.

After the production push, the Vercel Git deployment still failed on the test
project. The remaining active crons were all removed from `demo/commerce/vercel.json`
as well, because this Vercel project must not run automatic schedules from Git
deployments. The business job source files remain available, but Vercel will not
schedule them automatically from this project.

## Deployment clarification

Vercel crons do not deploy the app. They call HTTP routes on the already deployed production app.

The double-deploy risk came from having more than one local Vercel project link. That has been rationalized: only the repository root keeps `.vercel/project.json`.

## Business jobs kept in source, not scheduled by Vercel

| Job | Previous Vercel schedule | Verdict | Reason |
| --- | --- | --- | --- |
| `detect-abandoned-carts` | `0 * * * *` | Keep source only | Core abandoned cart campaign runner. |
| `flush-ga4-dispatches` | `* * * * *` | Keep source only | Real event dispatch queue. |
| `flush-google-ads-dispatches` | `* * * * *` | Keep source only | Real Google Ads dispatch queue. |
| `purge-event-hub-logs` | `0 */4 * * *` | Keep source only | Cleanup of hot event/dispatch logs. |
| `reconcile-shopify-daily` | `30 6 * * *` | Keep source only | Daily safety reconciliation for Shopify orders. |
| `reconcile-shopify-orders` | `*/15 * * * *` | Keep source only | Recent paid order reconciliation; useful when webhooks/events are missed. |
| `refresh-visitor-lifecycle-facts` | `*/5 * * * *` | Keep source only | Keeps CRM visitor lifecycle facts fresh. |
| `run-system-audits-nightly` | `0 0 * * *` | Keep source only | Nightly CRM/system quality audits. |
| `send-daily-reporting-email` | `0 3 * * *` | Keep source only | Daily reporting email. |
| `sync-from-shopify` | `45 * * * *` | Keep source only | Hourly Shopify contacts/orders sync. |
| `sync-klaviyo-events` | `20 * * * *` | Keep source only | Hourly Klaviyo event ingestion. |
| `sync-posthog-events` | `*/5 * * * *` | Keep source only | Pulls recent PostHog cart/checkout events. |
| `sync-visitor-sessions` | `*/5 * * * *` | Keep source only | Materializes visitor session data for CRM views. |

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
- `demo/commerce/vercel.json` parses as valid JSON and contains no `crons` array.
- All `vercel.json` files parse as valid JSON.
- No remaining source or active config reference to:
  - `test-abandoned-cart-random`
  - `testSendRandomAbandonedCart`
  - `test-send-random-abandoned-cart`
  - `backfill-cart-abandoned-may-8`
- `pnpm typecheck` passes.
