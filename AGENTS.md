# Palas Commerce CRM — Codex Instructions

## Compound Engineering context

This repository is the executable `admin` scope of the Palas multi-repository
workspace. Cross-repository strategy, baseline and integration contracts live
in `../platform` in the canonical workspace; this repository owns only its
implementation plans, code, tests and deployment evidence.

- Linear project: `PALAS_WORKSPACE`
- Linear label: `repo:admin`
- Canonical manifest: `../platform/workspace.manifest.json`
- One executable Linear issue = one Admin branch = one isolated worktree = one
  PR.
- If a feature also changes B2B, storefront B2C or Mantajs, work from a
  `cross-repo` parent and create a separate executable child for every repo.
- A framework gap is implemented and released in Mantajs first; Admin adopts
  the released contract in its own child issue and PR.
- Never put product implementation or multi-repo coordination commits in the
  workspace root.

This repo is an application workspace for the Palas commerce CRM pilot.

Manta framework code does not live here anymore. The single source of truth for
all `@mantajs/*` packages is:

```
/home/olivier/BRUTAL/mantajs
```

## Palas Tracking Architecture

Stable rule for `demo/commerce`: PostHog SDK events are the primary storefront analytics stream. The browser sends them to the first-party proxy at `admin.fancypalas.com/api/posthog`. The proxy resolves identity across Palas `muid`, PostHog `distinct_id`, Klaviyo, Shopify, and email signals, repairs anonymous-to-known links, updates CRM snapshot tables, and forwards the event to PostHog so PostHog remains the rich analytics store.

The Event Hub is downstream of that PostHog/proxy pipeline. It must filter, normalize, and hot-log only events that are dispatchable to external systems, then dispatch via CRM-owned connectors to GA4, Google Ads, Meta CAPI, TikTok, etc. Internal CRM/PostHog events such as `cart:updated`, `cart:closed`, and `checkout:address_info_submitted` are not dispatchable events and must not be shown as sendable events in tracking-health.

Do not treat Event Hub as a competing browser tracker. Do not reintroduce GTM/Stape or direct GA4/Ads/Meta/TikTok browser tags for the same events.

## Project Structure

```
demo/commerce/    Palas commerce CRM app
tests/runtime/    Playwright runtime smoke checks
```

There must be no local `packages/@manta` copy in this repo. If a `packages/`
directory appears here, treat it as drift and remove it unless the user
explicitly asks for a non-Manta app package.

## Change Classification

Classify every change before editing:

| Zone | Path | Rule |
|------|------|------|
| App | `demo/commerce/**` | Palas-only behavior |
| Runtime QA | `tests/runtime/**` | Palas runtime checks |
| App config | root config, `demo/commerce/*.config.ts` | Keep pointed at central Manta |
| Framework | `/home/olivier/BRUTAL/mantajs/packages/**` | Affects every Manta consumer |

Do not implement framework fixes inside this repo. If the app exposes a
framework gap, make the framework change in `/home/olivier/BRUTAL/mantajs`,
then verify this app against that central version.

## Commands

Run from this repo root unless noted:

| Command | Purpose |
|---------|---------|
| `pnpm install` | Refresh workspace links to central Manta |
| `pnpm lint` | Biome check for app/runtime files |
| `pnpm typecheck` | TypeScript check for app/runtime files |
| `pnpm test` | Vitest app tests |
| `pnpm check:fast` | Lint + typecheck |
| `pnpm check` | Full app gate including runtime checks |

For local app runtime:

```
cd demo/commerce
pnpm dev
```

## Deployment Rule

Production deploys for this CRM are Git-driven through the single Vercel
project linked at the repository root:

```
/home/olivier/BRUTAL/PALAS_WORKSPACE/crm/.vercel/project.json
```

Never run `vercel deploy`, `vercel deploy --prod`, or
`vercel deploy --prebuilt` from this repo or any subdirectory. Do not create or
keep nested Vercel links such as `demo/commerce/.vercel/project.json`.

`demo/commerce/vercel.json` is product deployment configuration only
(build command, routes, Vercel runtime cron routes). It must not be confused
with a Vercel project link. Vercel cron entries call application HTTP routes on
the deployed app; they must never be used to trigger deploys, Git pushes, or
release automation.

Vercel crons in this repo must be durable production jobs only. Do not keep
test crons, personal-inbox email tests, or one-off backfill jobs in
`demo/commerce/vercel.json` or `demo/commerce/src/jobs`. Temporary backfills
belong in explicit manual commands/scripts with an operator decision, not in
the production schedule.

## Manta Dependency Rule

`demo/commerce/package.json` uses `workspace:*` for `@mantajs/*`. The root
`pnpm-workspace.yaml` maps those workspace packages to
`../../mantajs/packages/*`. Keep it that way so Palas always runs against the
central framework.

## Code Style

- Follow the existing Biome config.
- Keep app code inside `demo/commerce`.
- Manta primitives such as `defineModel`, `defineCommand`, `defineQuery`,
  `defineUserModel`, `field`, and `MantaError` are framework concepts. Prefer
  the established app patterns and avoid adding one-off framework workarounds.
- If a workaround is unavoidable, document the framework gap and fix it in
  central Manta as a follow-up, not as hidden app glue.
