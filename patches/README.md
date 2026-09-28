# Palas runtime patches

The beta.12 package versions remain pinned. `pnpm install` applies these tracked patches locally and on Vercel; no new registry release or framework checkout is required. The lockfile records their hashes.

The 28 September 2026 Neon incident patch ports the bounded-read changes from upstream commit `b4b207c7bb6dcfd45d9aeba42341b580a4554fb3` into the installed core, CLI and PostgreSQL adapter artifacts (including declarations and source maps). HTTP fallback queries and AI tools push filters, projection and pagination into storage; entity counts use SQL COUNT and schema inspection samples one row. Generated business `list()` is unchanged; custom list policies cannot be bypassed. Query Graph errors never trigger a full-table fallback.

The existing core refresh-token and dashboard authentication patches are retained. Do not replace the core patch with the bounded-read diff alone. No email, cron or destination connector behavior is changed.

Tests `demo/commerce/tests/neon-bounded-*.test.ts` import installed package artifacts, not a framework source checkout. PostgreSQL tests require `PALAS_TEST_DATABASE_URL` pointing to a disposable local database ending in `_test`. The existing event-pipeline CI executes them.

Removal: only remove the bounded-read portions when adopting a published package version with equivalent tests passing. Preserve authentication fixes until independently superseded. Rollback this application commit to restore the previous package hashes and read behavior; no database migration is involved.

The incident audit observed an unlimited full-table read in production, but did not prove which caller generated it or attribute all Neon transfer to these paths. Measure actual transfer after deployment before claiming a cost reduction.
