# Manta Framework — Audit (2026-04-09)

## P0 — Critiques

| # | Problème | Impact | Localisation | Status |
|---|----------|--------|--------------|--------|
| 1 | **Query graph ne supporte pas les relations/JOIN** | Toutes les queries dans demo/commerce font du N+1 en mémoire | `core/src/query/`, `adapter-database-pg/src/relational-query.ts` | **FIXED 2026-04-09** — `DrizzleRelationalQuery` + `RelationAlias` M:N flattening + alias generation in `bootstrap-app.ts` |
| 2 | **Bug `filters` non défini dans `graphAndCount()`** | Variable inexistante dans le scope, bug silencieux | `core/src/query/index.ts` | **FIXED 2026-04-09** — `config.filters` correctly passed through |

## P1 — Importants

| # | Problème | Impact | Localisation |
|---|----------|--------|--------------|
| 3 | **Nitro externals manuels** | Liste statique, chaque nouvelle dépendance = risque de "Cannot find module" en dev | `host-nitro/src/dev.ts:94-110` | **FIXED 2026-04-09** — Dead code removed. Nitro v3 `nitro-dev` preset auto-externalizes all `node_modules`. |
| 4 | **Pas d'opérations bulk/batch** dans le service layer | Force du SQL brut (`pg.unsafe()`) pour consolidate/purge | `demo/commerce/src/modules/cart-tracking/api/` | **FIXED 2026-04-09** — Bulk CRUD already existed. Real gap was `upsertWithReplace` not exposed on `TypedRepository`. Now exposed, with SnapshotRepository passthrough (no compensation — documented). |
| 5 | **Typage qui fuit** — `getClient()` retourne `unknown`, step.ts utilise `(ctx.app.infra as any).db` | 20+ `as any` dans demo/commerce, zéro type safety sur le path DB | `core/src/ports/database.ts`, `core/src/workflows/step.ts` | **FIXED 2026-04-09** — Added `db?: unknown` to `MantaInfra`, typed `ctx: StepContext` in auto-generated commands, removed 11 `as any` casts from framework. |
| 6 | **`bootstrap-app.ts` = 2754 lignes** | God file dans le CLI, impossible à maintenir | `cli/src/bootstrap/bootstrap-app.ts` | **PARTIAL 2026-04-09** — Extracted ~300 lines of standalone helpers into `bootstrap-helpers.ts`. Main function split deferred — needs typed `BootstrapContext` first. |

## P2 — Améliorations

| # | Problème | Impact | Localisation | Status |
|---|----------|--------|--------------|--------|
| 7 | **Query graph ne retourne pas de types génériques** | Cast `as any[]` systématique sur les retours | `core/src/query/` | |
| 8 | **Entités de link pas exposées** dans les types du query graph | Cast `entity: 'xxx' as any` pour accéder aux tables pivot | `core/src/query/` | |
| 9 | **Pas de "maintenance command"** déclaratif | Les actions admin (consolider, purger) pointent vers des routes HTTP brutes | `demo/commerce/` | |
| 10 | **`dashboard-core` exporte 116 symboles** | Barrel trop large, trop de responsabilités | `dashboard-core/src/index.ts` | |

## P3 — Nice to have / Quick wins

| # | Problème | Impact | Localisation | Status |
|---|----------|--------|--------------|--------|
| 11 | **Pas de hooks React** `useCommand`/`useQuery` dans le SDK | `fetch()` brut dans les composants | `sdk/` | |
| 12 | **Pas de helper formatage monétaire** | Mapping SYMBOLS dupliqué dans 3 fichiers de queries | `demo/commerce/src/queries/` | |
| 13 | **Types deprecated** non nettoyés | Dette technique (`StepResponse`, `WorkflowResponse`, etc.) | `core/src/workflows/types.ts:109-193` | |
| 14 | **`pluralize()` dupliquée** | Code dupliqué — import from `naming.ts` instead | `core/src/workflows/step.ts` vs `core/src/naming.ts` | |
| 15 | **Stale comment** "via require()" in agent step section | Comment says `require()` but code uses `await import()` | `core/src/workflows/step.ts:1036` | |

## Fait (completed this session)

| # | Problème | Resolution |
|---|----------|------------|
| ESM-1 | `require('./ai-step')` in step.ts | Converted to `await import('./ai-step')` |
| ESM-2 | `require('node:crypto')` in emailpass.ts | Moved to top-level import |
| ESM-3 | Stale drizzle-relations + relation-generator test expectations | Fixed test expectations |
| ESM-4 | No root vitest.config.ts — archive/ tests polluting suite | Created `vitest.config.ts` excluding `archive/` |
| ESM-5 | `demo/commerce/.manta/generated.d.ts` stale codegen artifact | Removed |
| ESM-6 | `packages/core/src/` had multiple `require()` calls | **ZERO require() calls remaining in core/src** |
