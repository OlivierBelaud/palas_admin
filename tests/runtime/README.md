# Runtime smoke tests

Scripted Playwright smoke that boots `demo/commerce` in production mode via an ephemeral Postgres database and asserts the admin SPA shell renders without uncaught errors. Wired as `pnpm check:runtime` and called from `pnpm check` after `vitest run`.

## First-time setup

1. Ensure Postgres is running locally: `pg_isready -h localhost -p 5432`
2. Install the browser: `pnpm exec playwright install chromium --with-deps`
3. Set `TEST_DATABASE_URL=postgresql://<user>@localhost:5432/postgres`

## Running locally

```
TEST_DATABASE_URL=postgresql://<user>@localhost:5432/postgres pnpm check:runtime
```

## Without `TEST_DATABASE_URL`

Tests skip silently (local dev mode) and exit 0. This is the default contributor experience when Postgres is not set up locally — `pnpm check` still exits 0.

## CI requirements

CI MUST set `TEST_DATABASE_URL`. Without it, `check:runtime` exits 1 with an explicit preflight error. To opt out explicitly, set `SKIP_RUNTIME_SMOKE=1`; the preflight will pass and the spec will skip because no database URL is provided.

## How the smoke boots

1. Copies `demo/commerce` into a tempdir (excluding `node_modules`, `.env`, `.env.local`)
2. Symlinks (or copies, as fallback) `demo/commerce/node_modules` into the tempdir
3. Writes a scrubbed `.env` containing only the minimum keys (no live API keys)
4. Runs `pnpm exec manta build --preset node` in the tempdir
5. Spawns `pnpm exec manta start`, waits for the `Server listening` log line
6. Polls `/health/live` until 200 (30s budget)
7. Runs Playwright against `/admin/`, asserts the SPA shell renders and no uncaught errors fire

## Troubleshooting

- **Chromium missing** → `pnpm exec playwright install chromium --with-deps`
- **Port collision** → the smoke uses a randomized port in 19500-19999; retry
- **Postgres unreachable** → check `pg_isready`
- **Build or start failure** → re-run with `TEST_DATABASE_URL=...` and inspect the captured stdout/stderr printed in the thrown error message
