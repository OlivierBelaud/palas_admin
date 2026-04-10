# Backlog

Source unique pour toutes les tâches. Maintenu par l'auditor-agent à chaque fin de pipeline.

## Comment ça marche

- **L'utilisateur crée une epic** dans `EPIC.md` (copie un plan, une liste de features)
- **L'orchestrateur transforme l'epic** en items ici, dans la section "Epic en cours"
- **Les items epic sont séquentiels** — on termine un item avant de passer au suivant
- **Les petits fixes (remontés par l'auditeur)** vont dans "Fixes en attente" — traités entre les items epic, parallélisables
- **Règle : tant que le backlog n'est pas vide, on continue.** L'orchestrateur ne s'arrête que quand tout est fait.
- **Items terminés** → déplacés dans "Fait" avec date/session

---

## Epic en cours

_Aucune epic en cours._

Pour lancer la prochaine epic : copier le plan dans `EPIC.md` section "Epic en cours", puis demander à l'orchestrateur de "développer cette epic".

---

## Fixes en attente

_Aucun fix en attente._

---

## Fait

### Epic "TypeScript / Quality Hardening" (2026-04-09)

| Tâche | Date | Session |
|-------|------|---------|
| TS-01: Canonicalize `DiscoveredModule` (name camelCase + dirName kebab) — 8 fichiers migrés + 2 tests (RL-14, RL-15) | 2026-04-09 | TS-1 |
| TS-02: `z` (Zod) ajouté aux globals — `const z: typeof _z` | 2026-04-09 | TS-1 |
| TS-03: Tous les globals déclarés (déjà complet avant TS-02, seul `z` manquait) | 2026-04-09 | TS-1 |
| TS-04: Validation de la sortie du codegen — 2 couches (input sanitization + `validateGeneratedTypeScript`) + 9 tests (VGT-01..04, GTS-01..05) | 2026-04-09 | TS-1 |
| TS-05: `demo/commerce/.manta/generated.d.ts` stale supprimé | 2026-04-09 | TS-1 |
| TS-06: `.manta/` → gitignore (déjà fait) | 2026-04-09 | TS-1 |
| TS-07: `lint`/`lint:fix`/`check`/`format` couvrent `packages/` + `demo/` | 2026-04-09 | TS-2 |
| TS-08: Root `tsconfig.json` exhaustif + script `typecheck` lance les 6 tsconfigs (révèle 157 erreurs réelles) | 2026-04-09 | TS-2 |
| TS-09: Uniformisation tsconfigs (21 packages : strict, ES2022, ESNext, bundler) | 2026-04-09 | TS-2 |
| TS-10: Pre-commit hook `simple-git-hooks` + `check:fast` (biome + tsc) | 2026-04-09 | TS-2 |
| TS-11: Fix tous les TypeScript errors — **157 → 0** en 4 batches + reshape monorepo typecheck architecture | 2026-04-09 | TS-3 |
| TS-12: Éliminer `as any` dans core — 10 → 0 casts runtime | 2026-04-09 | TS-3 |
| TS-13: Éliminer `as any` dans demo — 9 → 0, queries utilisent `query.graph<E>()` | 2026-04-09 | TS-3 |
| TS-14: Tightening adapter types (vercel-blob, Drizzle documentés) | 2026-04-09 | TS-3 |
| TS-15: Setup plugin Biome custom (inline via `biome.json` + `.claude/biome-plugins/*.grit`) | 2026-04-09 | TS-4 |
| TS-16: R-01 no `@manta/core` in demo — `noRestrictedImports` built-in | 2026-04-09 | TS-4 |
| TS-17: R-03 no raw `throw new Error` — GritQL plugin scoped to demo excl tests | 2026-04-09 | TS-4 |
| TS-18: R-02 no `fetch` in React SPA — `noRestrictedGlobals` built-in | 2026-04-09 | TS-4 |
| TS-19: R-04 no raw HTTP routes — **FERMÉ** (contrainted by design, host-nitro génère tout) | 2026-04-09 | TS-4 |
| TS-20: `.claude/RADAR.md` — 4 rules documentées + "Removable when" criteria | 2026-04-09 | TS-4 |
| TS-21: Smoke test parse all .ts/.tsx — `demo/commerce/tests/smoke.test.ts` | 2026-04-09 | TS-5 |
| TS-22: Smoke test globals available — tsc --noEmit sur tout le monorepo (5.5s) | 2026-04-09 | TS-5 |
| TS-23: SPIRIT.md Couche A vs Couche B — section "Two layers of enforcement" | 2026-04-09 | TS-6 |
| TS-24: `packages/core/docs/00-overview.md` Type safety guarantees — section ajoutée | 2026-04-09 | TS-6 |
| F3: `MantaError` global — ajouté à globals.d.ts + registerGlobals | 2026-04-09 | TS-fixes |
| F4: `defineCommandGraph` global — ajouté à globals.d.ts + registerGlobals | 2026-04-09 | TS-fixes |
| F5: `defineMiddlewares` global (pluriel, coexiste avec singulier) | 2026-04-09 | TS-fixes |
| F6: "9 primitives" stale — CLAUDE.md, SPIRIT.md, 00-overview.md mis à jour (16 define*) | 2026-04-09 | TS-fixes |
| F7: `defineContext` mention stale — retiré des 3 docs, noté "V2 filesystem-derived" | 2026-04-09 | TS-fixes |

### Epic "Audit framework stabilization" (2026-04-09)

| Tâche | Date | Session |
|-------|------|---------|
| P0 #1: Query Graph relations/JOIN — `RelationAlias` M:N flattening | 2026-04-09 | 1 |
| P0 #2: Bug `filters` undefined dans `graphAndCount()` | 2026-04-09 | 1 |
| P0: `extraColumns` sur tables pivot (`generateLinkPgTable`) | 2026-04-09 | 2 |
| P0: Bootstrap DDL + ALTER TABLE pour extraColumns | 2026-04-09 | 2 |
| P0: `buildDrizzleRelations` pluralisation cassée (address) | 2026-04-09 | 1 |
| P0: `require('./nullable')` ESM blocker dans `base.ts` | 2026-04-09 | 4 |
| P1 #3: Nitro externals manuels → dead code supprimé | 2026-04-09 | 3 |
| P1 #4: `upsertWithReplace` exposé sur `TypedRepository` | 2026-04-09 | 3 |
| P1 #5: Typage qui fuit — `MantaInfra.db`, `ctx: StepContext`, 11 `as any` éliminés | 2026-04-09 | 3 |
| P1 #6: Extraction helpers bootstrap (~300 lignes) | 2026-04-09 | 3 |
| P1: `require('../command')` ESM fix dans `app/index.ts` | 2026-04-09 | 5 |
| P1: `require('../workflows/step')` ESM fix dans `command/index.ts` | 2026-04-09 | 6 |
| P1: `generateLinkCommands` throw Error → MantaError | 2026-04-09 | 6 |
| P2: `require('./ai-step')` → `await import()` dans step.ts | 2026-04-09 | 7 |
| P3: `require('node:crypto')` redondant → top-level import | 2026-04-09 | 7 |
| P3: `pluralize()` dupliquée → import from naming.ts | 2026-04-09 | 7 |
| P2: Tests stale drizzle-relations + relation-generator | 2026-04-09 | 7 |
| P2: `vitest.config.ts` root — exclusion archive | 2026-04-09 | 7 |
| P2: `generated.d.ts` stale supprimé | 2026-04-09 | 7 |
| P3: Stale comment "via require()" dans step.ts | 2026-04-09 | 7 |
| Doc: `08-links.md` — extraColumns | 2026-04-09 | 2 |
| Doc: `06-queries.md` — relation field syntax | 2026-04-09 | 2 |
| Doc: `03-services.md` — upsertWithReplace | 2026-04-09 | 3 |
| Process: Symlink `demo/commerce/AGENT.md` → core docs | 2026-04-09 | 2 |
| Process: Auditor contract — framework doc sync, spirit check, final QA gate | 2026-04-09 | 2-7 |
| Process: BACKLOG.md + EPIC.md + SPIRIT.md system | 2026-04-09 | 5-7 |
| Tests: 51 tests ajoutés (SnapshotRepo, TypedRepo, bootstrap-helpers, table-generator, relational-query) | 2026-04-09 | 1-3 |
| P1 #6b: `BootstrapContext` typé + split `bootstrapApp()` (2497 → 279 lines, 5 phase files) | 2026-04-09 | 8 |
| P1 #4b: `db.raw()` escape hatch on IDatabasePort + 3 adapters (pg, neon, memory) | 2026-04-09 | 9 |
| P1 #6c: Rollback SQL — schema-first guidance + skeleton validation | 2026-04-09 | 10 |
| P2 #7: Query graph generics — `graph<E>()`, `graphAndCount<E>()`, `InferEntityResult<E>` | 2026-04-09 | 10 |
| F1: Split `assemble-modules.ts` (971 → 19 lines) — 4 sub-phases | 2026-04-09 | 11 |
| F2: Split `wire-http.ts` (1125 → 12 lines) — 4 sub-phases | 2026-04-09 | 11 |

---

## Résumé — Epic "TypeScript / Quality Hardening" (2026-04-09)

**Total**: 24 items TS-* + 5 fixes (F3..F7) = 29 items.

**État avant l'epic**:
- 157 erreurs TypeScript latentes (invisibles car le typecheck n'était pas exhaustif)
- Codegen cassé sur modules hyphen → generated.d.ts invalide (cart-tracking)
- `z` (Zod) non déclaré dans les globals → `as any` partout dans demo
- `lint`/`typecheck`/`check` scripts ne couvraient pas `demo/`
- 19 `as any` runtime dans core + 9 dans demo
- Aucun pre-commit hook
- Aucun plugin Biome custom pour les règles SPIRIT
- 5 primitives globales manquantes (`MantaError`, `defineCommandGraph`, `defineMiddlewares`)
- Docs stale ("9 primitives", mentions de `defineContext` v1)

**État après l'epic**:
- **0 erreur TypeScript** sur les 6 tsc invocations (root + 5 React packages)
- **2752 tests GREEN**, 12 skipped, 24 failures (pré-existants — intégration CLI `dist/`)
- **Biome** clean sur packages + demo
- **Pre-commit hook** installé (`simple-git-hooks` + `check:fast`)
- **Plugin Biome custom** inline (4 rules actives, documentées dans RADAR.md)
- **Globals** complets (16 define* + `z`, `field`, `many`, `service`, `MantaError`)
- **Docs** à jour (SPIRIT.md Couche A/B, 00-overview.md type safety, CLAUDE.md primitives)
- **Zero `as any`** runtime dans core/src + demo/commerce/src
- **Codegen** durci (input sanitization + output TS Compiler validation)
- **Smoke tests** `demo/commerce` (parse all + tsc --noEmit)

**Prochaine epic recommandée**: Voir section "Next epic candidates" dans EPIC.md. Les 24 failures CLI `dist/` intégration sont le candidat logique — pré-existantes, non bloquantes, mais polluent la baseline des futures epics.
