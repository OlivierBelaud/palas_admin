# Prompt : Implémenter ce qui reste — Priorités 1 et 2

## Contexte

L'audit du 2026-03-10 montre :
- 687 tests pass, 0 fail, core à 98%, adapters production-ready
- **Gap principal** : CLI lazy boot steps 9-18 sont des stubs → le module loading est hardcodé
- ~43 comportements spec sans code ni test

On implémente les Priorités 1 et 2. Les Priorités 3 et 4 sont documentées mais pas dans le scope de cette session.

## Specs de référence

- `docs/FRAMEWORK_SPEC.md` — pour chaque SPEC-XXX mentionné
- `docs/CLI_SPEC.md` — pour le bootstrap et les commandes

---

## PRIORITÉ 1 — Bloquant pour que `manta dev` fonctionne avec n'importe quel projet

### P1.1 — ResourceLoader

Le ResourceLoader scanne le filesystem du projet et découvre dynamiquement les modules, subscribers, workflows, jobs, links et middlewares.

**Fichier** : `packages/cli/src/resource-loader.ts`

**Comportement** :
```typescript
export interface DiscoveredResources {
  modules: Array<{ name: string; path: string; models: string[]; service: string }>
  subscribers: Array<{ id: string; path: string; events: string[] }>
  workflows: Array<{ id: string; path: string }>
  jobs: Array<{ id: string; path: string; schedule?: string }>
  links: Array<{ id: string; path: string; modules: string[] }>
  middlewares: { path: string } | null
}

export async function discoverResources(projectRoot: string): Promise<DiscoveredResources>
```

**Scan patterns** (depuis CLI_SPEC §5) :
- `src/modules/*/index.ts` → modules (importe et exécute Module())
- `src/modules/**/models/*.ts` → models DML au sein de chaque module
- `src/subscribers/*.ts` → subscribers (importe, lit l'export `event`)
- `src/workflows/*.ts` → workflows (importe, lit createWorkflow name)
- `src/jobs/*.ts` → jobs (importe, lit name + schedule)
- `src/links/*.ts` → links (importe, lit defineLink)
- `src/middlewares.ts` → middlewares (si existe)
- `src/api/**/*.ts` → routes (déjà implémenté dans route-discovery.ts)

**Tests** :
- Crée un tmpdir avec une structure de projet type
- Vérifie que discoverResources() trouve tout
- Vérifie qu'un dossier vide retourne des tableaux vides
- Vérifie qu'un fichier malformé est skippé avec warning (pas d'erreur fatale)

### P1.2 — Lazy boot steps 9-18

Les 8 stubs dans `packages/cli/src/bootstrap/boot.ts` doivent devenir réels.

**Pour chaque step, le comportement attendu** (réf: CLI_SPEC §2.1 flow step 6) :

**Step 9 — stepLoadModules** :
- Utilise ResourceLoader pour découvrir les modules
- Pour chaque module : import dynamique → appelle Module().bootstrap()
- Enregistre le service du module dans le container
- Si un module échoue → FATAL (503 + lazyBootPromise.reject)

**Step 10 — stepRegisterQueryLink** :
- Enregistre les services QUERY, LINK, REMOTE_LINK dans le container
- Initialise QueryService avec les modules chargés
- Si échoue → FATAL

**Step 11 — stepLoadLinks** :
- Import dynamique de chaque fichier dans src/links/
- Appelle defineLink() → crée les tables de jointure
- Si un link échoue → WARNING, continue

**Step 12 — stepLoadWorkflows** :
- Import dynamique de chaque fichier dans src/workflows/
- WorkflowManager.register() pour chaque workflow découvert
- Si un workflow échoue → WARNING, continue

**Step 13 — stepLoadSubscribers** :
- Import dynamique de chaque fichier dans src/subscribers/
- eventBus.subscribe(event, handler) pour chaque subscriber
- Si un subscriber échoue → WARNING, continue

**Step 15 — stepLoadJobs** :
- Import dynamique de chaque fichier dans src/jobs/
- jobScheduler.register(job) pour chaque job
- Si un job échoue → WARNING, continue

**Step 16 — stepOnApplicationStart** :
- Appelle onApplicationStart() sur chaque module chargé
- Si un module throw → WARNING, continue

**Step 18 — stepReleaseEventBuffer** :
- Flush le buffer d'events (publish tous les events accumulés pendant le boot)
- Resolve la lazyBootPromise
- Si échoue → FATAL (503)

**Tests** : pour chaque step, au minimum :
- Test unitaire : mock le ResourceLoader et les services, vérifie que le step appelle les bonnes méthodes
- Test que les steps FATAL rejettent lazyBootPromise
- Test que les steps WARNING logguent et continuent

### P1.3 — Supprimer le hardcode ProductService

Dans `packages/cli/src/server-bootstrap.ts`, remplacer le code hardcodé ProductService par le résultat du ResourceLoader + lazy boot.

**Concrètement** :
- `server-bootstrap.ts` appelle `discoverResources(projectRoot)`
- Passe les ressources découvertes au boot steps 9-18
- Les routes sont déjà dynamiques (route-discovery.ts) — les handlers doivent résoudre les services depuis le container (pas en dur)

**Test** : le smoke test e2e existant (`dev-smoke.integration.test.ts`) doit continuer à passer — c'est le test de non-régression.

---

## PRIORITÉ 2 — Bloquant pour production

### P2.1 — Pipeline HTTP steps manquants (NitroAdapter)

Actuellement les steps 3-4, 6-10 du pipeline HTTP sont no-op. Implémenter :

**Step 3 — Auth** :
- Lit le header Authorization (Bearer token)
- Vérifie le JWT via IAuthPort
- Injecte authContext dans le scope
- Routes /admin/* et /auth/* → auth obligatoire (401 si absent)
- Routes /store/* → auth optionnelle

**Step 4 — Body parsing** :
- Parse JSON body
- Si Content-Type n'est pas application/json → 415

**Step 6 — Scope creation** :
- Crée un scoped container pour la requête
- Injecte authContext, requestId, params, query

**Step 7 — Zod validation** (SPEC-043) :
- Si la route exporte un `schema` (Zod), valide le body
- Si invalide → 400 avec détails Zod

**Step 8 — RBAC** (basique, pas le système complet) :
- Vérifie que l'acteur a accès au namespace (admin → admin only)
- Si non autorisé → 403

**Tests** : tests conformance NitroAdapter pour chaque step.

### P2.2 — Strict mode (12 tests todo)

Le strict mode valide la configuration au boot et rejette les champs inconnus, les modules mal configurés, etc.

Référence : les 12 tests dans `strict-mode.test.ts` décrivent exactement le comportement attendu. Déskippe-les un par un et implémente.

### P2.3 — Service decorators (SPEC-059)

Les decorators de service permettent l'injection de contexte et l'émission automatique d'events :

```typescript
@InjectManager()       // injecte le DB manager dans la méthode
@InjectTransactionManager()  // injecte un tx manager (dans une transaction)
@EmitEvents()          // émet automatiquement les events après la méthode
```

**Implémentation** : ces "decorators" sont en réalité des higher-order functions (pas des decorators TS expérimentaux) qui wrappent les méthodes de service.

### P2.4 — Module versioning (SPEC-135)

Au boot, vérifier que la version des modules en DB (table module_versions) correspond aux modules chargés. Si mismatch → erreur ou auto-migration selon la config.

---

## Ordre d'implémentation

```
Phase 1 — ResourceLoader (P1.1)
  → tests unitaires + implémentation
  → pnpm test → tout vert

Phase 2 — Lazy boot steps 9-18 (P1.2)
  → step par step, dans l'ordre 9 → 18
  → tests unitaires pour chaque step
  → pnpm test après chaque step

Phase 3 — Supprimer le hardcode (P1.3)
  → modifier server-bootstrap.ts
  → smoke test e2e doit toujours passer
  → pnpm test:all → tout vert

Phase 4 — Pipeline HTTP (P2.1)
  → step par step (3, 4, 6, 7, 8)
  → tests conformance NitroAdapter
  → smoke test e2e avec auth

Phase 5 — Strict mode (P2.2)
  → déskipper les 12 tests un par un
  → implémenter chaque validation

Phase 6 — Service decorators (P2.3)
  → tests unitaires
  → intégration avec createService()

Phase 7 — Module versioning (P2.4)
  → tests unitaires
  → intégration avec boot step
```

## Boucle

Pour chaque phase :
1. Écris les tests (ou déskippe les existants)
2. Exécute → rouge
3. Implémente → vert
4. `pnpm test` → tout vert (y compris les tests précédents)
5. Passe à la phase suivante

## Vérification finale

```bash
pnpm test        # tous les unitaires + conformance
pnpm test:all    # + intégration + e2e

# Objectif :
# - 0 fail
# - Les 12 strict mode todo → pass
# - Les 8 boot stubs → implémentés
# - Le hardcode ProductService → supprimé
# - manta dev charge dynamiquement n'importe quel projet
```
