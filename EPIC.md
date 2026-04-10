# Epic

Espace d'input pour l'utilisateur. Colle ici un plan, une liste de features, un audit — puis dis "développe cette epic".

L'orchestrateur lit ce fichier, transforme les items en tâches dans `BACKLOG.md` (section "Epic en cours"), et les exécute séquentiellement.

---

## Epic en cours

### 2026-04-09 — Baseline Cleanup & Runtime Validation

**Objectif** : Restaurer une baseline 100% green (0 failures), ajouter validation runtime Playwright en CI, optimiser les hotspots connus, et boucher les gaps restants post-epics stabilization + TypeScript.

**Principe directeur** : Passer du "source tree est green" au "tout est green, runtime inclus". Après cette epic, le projet devrait avoir zéro failure connue, zéro watchpoint en suspens, et un CI qui catch les régressions runtime autant que statiques.

---

### Phase 1 — CLI dist/ integration failures (24 failures pré-existantes)

| # | Tâche | Type | Priorité |
|---|-------|------|----------|
| BC-01 | Diagnostiquer les 24 failures dans `dist/packages/cli/__tests__/integration/*` — toutes échouent avec `spawn dist/node_modules/.bin/tsx ENOENT`. Identifier root cause (build artefact stale, pnpm hoisting, ou vrai bug de spawn path) | P0 CLI | Diagnostic |
| BC-02 | Fix le spawn path (`tsx` doit résoudre depuis le bon node_modules) OU marquer les tests comme intentionnellement skipped avec raison | P0 CLI | Fix |
| BC-03 | Vérifier que `pnpm test` est 100% green après fix (0 failures, pas juste "pre-existing") | P0 CLI | Validation |

### Phase 2 — Runtime validation Playwright (CI smoke)

| # | Tâche | Type | Priorité |
|---|-------|------|----------|
| BC-04 | Créer un smoke test Playwright qui lance `demo/commerce && pnpm dev`, navigue vers `/admin`, vérifie que l'UI charge sans erreur console | P1 Framework | Test |
| BC-05 | Intégrer ce smoke test dans le script `check` root OU dans un script `check:runtime` dédié | P1 Config | Integration |
| BC-06 | Le smoke Playwright doit être lancé par l'auditor-agent en fin de chaque epic (final QA gate runtime, pas juste `pnpm test`) | P2 Process | Auditor contract |

### Phase 3 — `wire-contexts.ts` split (596 lignes)

| # | Tâche | Type | Priorité |
|---|-------|------|----------|
| BC-07 | Analyser les sous-phases de `wire-contexts.ts` (context ACL, user routes, SPA warnings, CQRS endpoints). Identifier les points de coupe naturels. | P2 Framework | Refactoring |
| BC-08 | Split en 3-4 sub-phase files dans `packages/cli/src/bootstrap/phases/wire/contexts/` (comme F1/F2) | P2 Framework | Refactoring |
| BC-09 | Vérifier runtime GREEN via Playwright post-split | P2 Validation | Validation |

### Phase 4 — Performance `findAndCountWithRelations`

| # | Tâche | Type | Priorité |
|---|-------|------|----------|
| BC-10 | Instrumenter `findAndCountWithRelations` pour mesurer le coût actuel (full scan vs SQL COUNT(*)) | P1 Framework | Perf |
| BC-11 | Remplacer le full-scan par une vraie SQL COUNT(*) parallèle (Drizzle `count()` ou `db.raw` avec COUNT) | P1 Framework | Perf fix |
| BC-12 | Ajouter un test conformance qui vérifie que `graphAndCount()` sur une table de 10k rows reste sous un seuil (e.g. <100ms avec pagination limite 20) | P2 Test | Regression guard |

### Phase 5 — Dashboard V2 migration

| # | Tâche | Type | Priorité |
|---|-------|------|----------|
| BC-13 | Lire `~/.claude/projects/.../memory/project_dashboard_migration.md` et `vite-plugin-override-v2-plan.md` pour contexte complet | P2 Framework | Context |
| BC-14 | Identifier les itérations restantes sur `defineSpa` / `definePage` / `defineForm` | P2 Framework | Scope |
| BC-15 | Exécuter les fixes séquentiellement (chaque item doit passer runtime Playwright via BC-04) | P2 Framework | Implementation |

### Phase 6 — PostHog event contracts

| # | Tâche | Type | Priorité |
|---|-------|------|----------|
| BC-16 | Lire `~/.claude/projects/.../memory/project_posthog_event_contracts.md` pour la liste des contrats `cart:*` / `checkout:*` à implémenter | P3 App | Context |
| BC-17 | Implémenter les event types manquants dans `demo/commerce` via `defineSubscriber` + `MantaEventMap` augmentation | P3 App | Implementation |
| BC-18 | Test conformance : chaque event PostHog doit avoir un subscriber Manta qui peut le recevoir | P3 Test | Coverage |

### Phase 7 — Cleanup final

| # | Tâche | Type | Priorité |
|---|-------|------|----------|
| BC-19 | Pass full audit : `pnpm check` doit être green (lint + typecheck + tests), 0 failure, 0 warning non-justifié | P1 Process | Gate |
| BC-20 | Mettre à jour BACKLOG.md "Fait" + EPIC.md "Epics terminées" avec résumé complet | P3 Docs | Closure |

---

## Critères de completion

L'epic est terminée quand :

- [ ] `pnpm test` → **0 failures** (pas "24 pre-existing", vraiment 0)
- [ ] `pnpm check` (lint + typecheck + tests) → GREEN
- [ ] Playwright smoke test : admin dashboard charge sans erreur console
- [ ] `wire-contexts.ts` sous 300 lignes OU split en sub-phases
- [ ] `findAndCountWithRelations` utilise une vraie SQL COUNT (mesurable)
- [ ] Dashboard V2 items résolus
- [ ] PostHog event contracts implémentés
- [ ] `BACKLOG.md` complètement vide

---

## Epics terminées

### 2026-04-09 — TypeScript / Quality Hardening (COMPLETE)
24 items TS-* + 5 fixes (F3..F7). État final : 0 erreur TypeScript sur les 6 tsc, 2752 tests GREEN, Biome clean, pre-commit hook installé, plugin Biome custom avec 4 rules actives, globals complets. Voir BACKLOG.md section "Fait" pour les détails.

### 2026-04-09 — Audit framework stabilization (COMPLETE)
29 items P0/P1/P2/P3 + F1/F2 (splits structurels) + tests + docs + process.
État final : 115/115 test files, 1347/1347 tests GREEN. `core/src/` zéro `require()`.
Détails dans BACKLOG.md section "Fait".

### 2026-04-09 — Audit P0 + P1 + ESM cleanup
27 items complétés (sous-ensemble de l'epic ci-dessus, sessions 1-7). Voir BACKLOG.md section "Fait".
