# Prompt : Génération complète des tests pour @manta/cli

> **Usage** : Ce prompt est destiné à être donné à Claude Code (ou tout agent de code) pour qu'il génère, exécute et corrige en boucle l'intégralité des tests de la CLI Manta.

---

## Contexte

Tu travailles sur **Manta.js**, un meta-framework TypeScript. Le package `@manta/cli` est le seul point d'entrée développeur. Sa spécification complète est dans `CLI_SPEC.md` (jointe ou dans le repo).

Le monorepo utilise **pnpm workspaces**. Le package CLI se trouve dans `packages/cli/`.

## Structure du package @manta/cli

```
packages/cli/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── bin/
│   └── manta.ts
├── src/
│   ├── index.ts
│   ├── commands/
│   │   ├── dev.ts
│   │   ├── start.ts
│   │   ├── build.ts
│   │   ├── init.ts
│   │   ├── exec.ts
│   │   └── db/
│   │       ├── generate.ts
│   │       ├── migrate.ts
│   │       ├── rollback.ts
│   │       ├── diff.ts
│   │       └── create.ts
│   ├── config/
│   │   ├── load-env.ts
│   │   ├── load-config.ts
│   │   └── resolve-adapters.ts
│   ├── bootstrap/
│   │   └── boot.ts
│   └── utils/
│       ├── logger.ts
│       ├── spinner.ts
│       └── prompts.ts
└── __tests__/
    ├── unit/
    │   ├── config/
    │   │   ├── load-env.test.ts
    │   │   ├── load-config.test.ts
    │   │   └── resolve-adapters.test.ts
    │   ├── commands/
    │   │   ├── init.test.ts
    │   │   ├── dev.test.ts
    │   │   ├── start.test.ts
    │   │   ├── build.test.ts
    │   │   ├── exec.test.ts
    │   │   └── db/
    │   │       ├── generate.test.ts
    │   │       ├── migrate.test.ts
    │   │       ├── rollback.test.ts
    │   │       ├── diff.test.ts
    │   │       └── create.test.ts
    │   ├── bootstrap/
    │   │   └── boot.test.ts
    │   └── utils/
    │       └── prompts.test.ts
    └── integration/
        ├── cli-init.integration.test.ts
        ├── cli-dev.integration.test.ts
        ├── cli-db.integration.test.ts
        └── cli-lifecycle.integration.test.ts
```

## Ta mission

Génère **tous les fichiers de test** pour `@manta/cli` en respectant strictement la `CLI_SPEC.md`. Travaille en boucle : écris les tests, exécute-les, corrige jusqu'à ce que tout passe.

---

## Règles impératives

### 1. Stack technique

- **Test runner** : Vitest (déjà configuré dans le monorepo)
- **Langage** : TypeScript strict
- **Mocking** : `vi.mock()`, `vi.fn()`, `vi.spyOn()` de Vitest
- **Filesystem** : `memfs` ou `tmp` directories (jamais toucher au vrai filesystem hors du tmpdir)
- **Process** : Pour les tests d'intégration, utilise `execa` ou `child_process.spawn` avec le binaire `manta`
- **DB** : Aucune vraie DB pour les tests unitaires. Mock `IDatabasePort`. Pour l'intégration, utilise une DB PG locale via Docker si dispo, sinon mock.

### 2. Conventions de nommage

- Fichiers : `*.test.ts` (unit), `*.integration.test.ts` (intégration)
- `describe` blocks : nom de la commande ou du module (`describe('manta dev', ...)`)
- `it` blocks : comportement attendu en anglais (`it('should exit(1) if DATABASE_URL is missing', ...)`)

### 3. Philosophie de test

- **Chaque comportement documenté dans CLI_SPEC.md DOIT avoir un test.**
- **Chaque message d'erreur documenté DOIT être vérifié textuellement** (ou au moins par substring).
- **Chaque exit code DOIT être vérifié.**
- Les tests unitaires mockent TOUT sauf la logique de la commande elle-même.
- Les tests d'intégration spawent le vrai process `manta` et vérifient stdout/stderr/exit code.

### 4. Boucle d'exécution

Après avoir écrit chaque fichier de test :
1. Exécute `pnpm --filter @manta/cli test` (ou `vitest run` dans packages/cli/)
2. Si des tests échouent parce que **le code source n'existe pas encore** → crée un stub minimal du fichier source (juste assez pour que le test compile et échoue pour la bonne raison)
3. Si des tests échouent à cause d'une **erreur dans le test** → corrige le test
4. Itère jusqu'à ce que tous les tests soient dans l'un de ces états :
   - ✅ PASS (le code source implémente déjà le comportement)
   - ❌ FAIL avec le bon message (le test est correct, le code source est un stub → c'est attendu, c'est du TDD)
5. **Ne jamais modifier CLI_SPEC.md.** C'est la source de vérité.

---

## Matrice de tests à couvrir

### A. Config (`config/`)

#### A1. `load-env.test.ts`
| # | Test | Spec ref |
|---|------|----------|
| 1 | Charge `.env` depuis le répertoire courant | §1.1 step 1 |
| 2 | Ordre de priorité : `.env` → `.env.local` → `.env.{NODE_ENV}` → `.env.{NODE_ENV}.local` | §1.1 step 1 |
| 3 | Les variables déjà dans `process.env` ne sont PAS écrasées | §1.1 step 1 |
| 4 | Warning si aucun `.env` trouvé (pas d'erreur) | §2.1 erreurs |
| 5 | Support de `.env.development.local` quand `NODE_ENV=development` | §1.1 step 1 |

#### A2. `load-config.test.ts`
| # | Test | Spec ref |
|---|------|----------|
| 1 | Trouve `manta.config.ts` dans le répertoire courant | §1.1 step 2 |
| 2 | Remonte jusqu'à trouver `package.json` pour chercher la config | §1.1 step 2 |
| 3 | Erreur `NOT_FOUND` si config introuvable | §1.1 step 2 |
| 4 | Supporte `.ts`, `.js`, `.mjs` | §1.1 step 2 |
| 5 | Exécute `defineConfig()` et résout les env vars | §1.1 step 3 |
| 6 | Mapping `defineConfig.database.url` → `projectConfig.databaseUrl` | §1.3 mapping |
| 7 | Mapping `defineConfig.auth.jwtSecret` → `projectConfig.jwtSecret` | §1.3 mapping |
| 8 | Mapping `defineConfig.http.port` → `projectConfig.httpPort` | §1.3 mapping |
| 9 | Valide les champs requis selon la commande (table §1.1.1) | §1.1.1 |
| 10 | Erreur humaine (pas de stack trace) si champ requis absent | §1.1.1 règle |
| 11 | Profil `dev` par défaut, `prod` si `NODE_ENV=production` | §1.2 |
| 12 | `APP_ENV` a priorité sur `NODE_ENV` | §1.2 |
| 13 | `NODE_ENV=test` → profil `dev` | §1.2 |

#### A3. `resolve-adapters.test.ts`
| # | Test | Spec ref |
|---|------|----------|
| 1 | Profil `dev` → adapters in-memory par défaut | §3.1 |
| 2 | Profil `prod` → adapters prod par défaut | §3.1 |
| 3 | Override dans `defineConfig().adapters` prend la priorité | §3.2 |
| 4 | Erreur si package adapter override n'est pas installé | §3.3 step 1 |
| 5 | Erreur si adapter override n'exporte pas la bonne classe | §3.3 step 1 |
| 6 | Erreur en prod si adapter default n'est pas installé (sauf DB/Logger/HTTP) | §3.3 step 2 |
| 7 | DB, Logger, HTTP toujours disponibles (embarqués) | §3.3 step 2 exception |
| 8 | Erreur si `adapter.initialize()` throw | §3.3 step 3 |
| 9 | Adapter enregistré en SINGLETON dans le container | §3.3 step 4 |

### B. Commands (`commands/`)

#### B1. `init.test.ts`
| # | Test | Spec ref |
|---|------|----------|
| 1 | Crée la structure de dossiers `src/{api/admin, api/store, modules, ...}` | §2.10 step 1 |
| 2 | Génère `manta.config.ts` avec le bon contenu | §2.10 step 2 |
| 3 | Génère `.env` avec `DATABASE_URL` et `PORT` | §2.10 step 2 |
| 4 | Génère `package.json` avec `name` = nom du dossier, `type: "module"` | §2.10 step 2 |
| 5 | Génère `tsconfig.json` avec les bonnes options | §2.10 step 2 |
| 6 | Génère `drizzle.config.ts` | §2.10 step 2 |
| 7 | Ne détruit JAMAIS un fichier existant (skip + log) | §2.10 step 0 |
| 8 | Si tous les fichiers existent → "Nothing to do" + exit(0) | §2.10 step 0 |
| 9 | Répertoires existants → pas d'erreur (mkdir -p idempotent) | §2.10 step 0 |
| 10 | Option `--dir` crée dans le répertoire spécifié | §2.10 |
| 11 | Affiche "Next steps" à la fin | §2.10 step 3 |
| 12 | `package.json` contient les clés obligatoires (name, type, scripts.dev, dependencies.@manta/core) | §2.10 step 2 |

#### B2. `dev.test.ts`
| # | Test | Spec ref |
|---|------|----------|
| 1 | Profil forcé à `dev` | §2.1 flow step 1 |
| 2 | Exit(1) si `database.url` absent avec message spécifique | §2.1 flow step 2 |
| 3 | Exit(1) si `manta.config.ts` absent | §2.1 erreurs |
| 4 | Exit(1) si PG non joignable avec message clair | §2.1 flow step 4 |
| 5 | Exit(1) si DB inexistante avec message suggérant `manta db:create` | §2.1 erreurs |
| 6 | Exit(1) si port occupé | §2.1 erreurs |
| 7 | `--port` change le port d'écoute | §2.1 options |
| 8 | `--verbose` passe le log level à `debug` | §2.1 options |
| 9 | `--no-migrate` skip l'auto-migration | §2.1 options |
| 10 | Auto-migration exécute `drizzle-kit push` | §2.1 flow step 5 |
| 11 | Auto-migration failure → warning, serveur démarre quand même | §2.1 flow step 5 |
| 12 | Bootstrap 18 étapes est appelé | §2.1 flow step 6 |
| 13 | Log "Server ready on http://localhost:9000" | §2.1 output |
| 14 | SIGINT → graceful shutdown (container.dispose) | §2.1 flow step 9 |
| 15 | SIGTERM → graceful shutdown (container.dispose) | §2.1 flow step 9 |
| 16 | Warning si `.env` absent (pas exit) | §2.1 erreurs |
| 17 | Module DML invalide → warning, pas exit | §2.1 erreurs |

#### B3. `start.test.ts`
| # | Test | Spec ref |
|---|------|----------|
| 1 | Profil forcé à `prod` | §2.7 |
| 2 | Exit(1) si `JWT_SECRET` absent en prod | §2.7 step 2 |
| 3 | Exit(1) si `COOKIE_SECRET` absent quand `auth.session.enabled: true` | §2.7 step 2 |
| 4 | Pas d'erreur si `COOKIE_SECRET` absent quand sessions désactivées | §2.7 step 2 |
| 5 | Exit(1) si migrations pendantes | §2.7 step 4 |
| 6 | Pas d'auto-migration | §2.7 diff table |
| 7 | Pas de HMR/watch | §2.7 diff table |
| 8 | Logs en JSON (pas pretty) | §2.7 diff table |
| 9 | Secret temporaire en dev avec warning | §2.7 step 2 note dev |
| 10 | Pool DB adapté au preset (serverless vs long-running) | §2.7 note pool |

#### B4. `build.test.ts`
| # | Test | Spec ref |
|---|------|----------|
| 1 | Ne connecte PAS la DB | §2.8 note |
| 2 | Ne valide PAS les secrets | §2.8 note |
| 3 | Génère le manifeste `.manta/manifest/` | §2.8 flow step 2 |
| 4 | `routes.json` contient path, methods, file, namespace | §2.8 flow step 2 schema |
| 5 | `subscribers.json` contient id, file, events | §2.8 flow step 2 schema |
| 6 | `workflows.json` contient id, file, steps | §2.8 flow step 2 schema |
| 7 | `jobs.json` contient id, file, schedule | §2.8 flow step 2 schema |
| 8 | `links.json` contient id, file, modules, table | §2.8 flow step 2 schema |
| 9 | `modules.json` contient name, file, models, service | §2.8 flow step 2 schema |
| 10 | Tableaux vides si aucun élément (pas d'omission du fichier JSON) | §2.8 flow step 2 contrat |
| 11 | `--preset node` (défaut) | §2.8 options |
| 12 | `--preset vercel` génère pour serverless | §2.8 options |
| 13 | Exit(1) si preset inconnu avec message listant les presets valides | §2.8 erreurs |
| 14 | Exit(1) si `manta.config.ts` absent | §2.8 erreurs |
| 15 | Exit(1) si config ne parse pas (erreur TS) | §2.8 erreurs |
| 16 | Warning si route invalide (build continue) | §2.8 erreurs |
| 17 | Warning si aucun module DML trouvé | §2.8 erreurs |

#### B5. `exec.test.ts`
| # | Test | Spec ref |
|---|------|----------|
| 1 | Bootstrap complet avant exécution | §2.9 flow step 2 |
| 2 | Script reçoit `{ container, args }` | §2.9 flow step 5 |
| 3 | Container est SCOPED avec AuthContext `system/cli` | §2.9 flow step 3 |
| 4 | AuthContext a `actor_type: 'system'`, `actor_id: 'cli'` | §2.9 flow step 3 |
| 5 | `--dry-run` → transaction ROLLBACK + clearMessages | §2.9 flow step 4 |
| 6 | Args après `--` passés en tableau de strings | §2.9 flow step 5 |
| 7 | `args = []` si pas de `--` | §2.9 flow step 5 |
| 8 | Exit(1) si fichier script n'existe pas | §2.9 flow step 5 |
| 9 | Exit(1) si script n'exporte pas de default function | §2.9 flow step 5 |
| 10 | Exit(1) si script throw avec stack trace | §2.9 flow step 5 |
| 11 | Exit(0) + dispose() en cas de succès | §2.9 flow step 6 |

#### B6. `db/generate.test.ts`
| # | Test | Spec ref |
|---|------|----------|
| 1 | Scanne `src/modules/**/models/*.ts` | §2.2 flow step 2 |
| 2 | Warning si fichier matche mais n'exporte pas de `model.define()` | §2.2 flow step 2 |
| 3 | Warning si DML invalide (pas exit) | §2.2 flow step 2 |
| 4 | Warning si import dynamique échoue (erreur TS) | §2.2 flow step 2 |
| 5 | Génère le schema Drizzle dans `drizzle/schema/` | §2.2 flow step 3 |
| 6 | Appelle `drizzle-kit generate` | §2.2 flow step 4 |
| 7 | Génère le fichier `.down.sql` squelette | §2.2 flow step 5 |
| 8 | Détection de renommage : prompt si colonne drop+add même type | §2.2 flow step 6 |
| 9 | Renommage : une paire acceptée retire les colonnes des candidats | §2.2 flow step 6 |
| 10 | Non-interactif (`CI=true`) → pas de rename, toujours drop+add | §2.2 flow step 6 |
| 11 | `process.stdin.isTTY === false` → non-interactif | §2.2 flow step 6 |
| 12 | `MANTA_NON_INTERACTIVE=true` → non-interactif | §2.2 flow step 6 |
| 13 | Warning pour changements dangereux (DROP COLUMN, ALTER TYPE, DROP TABLE) | §2.2 flow step 7 |
| 14 | "No schema changes detected" si rien à faire | §2.2 flow step 8 |
| 15 | `--name` personnalise le nom de la migration | §2.2 options |

#### B7. `db/migrate.test.ts`
| # | Test | Spec ref |
|---|------|----------|
| 1 | Acquiert le lock de migration | §2.3 flow step 2 |
| 2 | Attente si lock pris (polling 2s, timeout 60s) | §2.3 flow step 2 |
| 3 | Exit(1) si timeout lock avec message suggérant `--force-unlock` | §2.3 flow step 2 |
| 4 | `--force-unlock` supprime le lock et exit(0) | §2.3 flow step 2 |
| 5 | "Database is up to date" si aucune migration pendante | §2.3 flow step 4 |
| 6 | `--dry-run` affiche le SQL sans appliquer | §2.3 flow step 5 |
| 7 | `--dry-run --json` affiche en JSON | §2.3 flow step 5 |
| 8 | Demande confirmation pour changements dangereux (sans `--force`) | §2.3 flow step 6 |
| 9 | `--force` skip la confirmation | §2.3 flow step 6 |
| 10 | Sans `--all-or-nothing` : échec milieu de batch → migrations précédentes commitées | §2.3 flow step 7 |
| 11 | `--all-or-nothing` : échec → ROLLBACK total | §2.3 flow step 7 |
| 12 | `--all-or-nothing` + `CREATE INDEX CONCURRENTLY` → exit(1) avant exécution | §2.3 flow step 7 |
| 13 | Met à jour le tracking après succès | §2.3 flow step 8 |
| 14 | Relâche le lock en fin (succès ou échec) | §2.3 flow step 9 |
| 15 | `--json` output JSON sur stdout | §2.3 options |

#### B8. `db/rollback.test.ts`
| # | Test | Spec ref |
|---|------|----------|
| 1 | Rollback la dernière migration par défaut | §2.4 |
| 2 | `--steps N` rollback N migrations | §2.4 options |
| 3 | Exit(1) si `.down.sql` absent | §2.4 flow step 3 |
| 4 | Exit(1) si `.down.sql` contient seulement le TODO placeholder | §2.4 flow step 3 |
| 5 | Exit(1) si exécution SQL échoue avec message "inconsistent state" | §2.4 flow step 3 |
| 6 | STOP au premier échec (pas de rollback suivant) | §2.4 principe |
| 7 | Tracking mis à jour seulement pour les migrations rollbackées avec succès | §2.4 flow step 4 |

#### B9. `db/diff.test.ts`
| # | Test | Spec ref |
|---|------|----------|
| 1 | Lecture seule (ne modifie pas la DB) | §2.5 |
| 2 | Compare schema DML vs DB réelle | §2.5 flow |
| 3 | `--json` output JSON | §2.5 options |
| 4 | Détecte tables/colonnes manquantes | §2.5 flow step 4 |
| 5 | Détecte tables/colonnes en trop | §2.5 flow step 4 |

#### B10. `db/create.test.ts`
| # | Test | Spec ref |
|---|------|----------|
| 1 | Crée la DB si elle n'existe pas | §2.6 flow step 4 |
| 2 | "Already exists" si DB existe déjà | §2.6 flow step 4 |
| 3 | Extrait le nom de la DB depuis l'URL | §2.6 flow step 2 |
| 4 | Se connecte via la base `postgres` | §2.6 flow step 3 |

### C. Bootstrap (`bootstrap/`)

#### C1. `boot.test.ts`
| # | Test | Spec ref |
|---|------|----------|
| 1 | Exécute les 18 étapes dans l'ordre | §2.1 flow step 6 |
| 2 | CORE BOOT [1-8] : toute erreur = exit(1) | §2.1 bootstrap erreurs |
| 3 | Exception : étape [8] routes → warning, continue | §2.1 bootstrap erreurs |
| 4 | Exception : étape [8.5] autoMigrate → warning, continue | §2.1 bootstrap erreurs |
| 5 | LAZY BOOT [9] module échoue → 503 + lazyBootPromise.reject() | §2.1 bootstrap erreurs |
| 6 | LAZY BOOT [10] QUERY échoue → FATAL 503 | §2.1 bootstrap erreurs |
| 7 | LAZY BOOT [11-17] échec → warning, continue | §2.1 bootstrap erreurs |
| 8 | LAZY BOOT [18] event buffer release échoue → FATAL 503 | §2.1 bootstrap erreurs |
| 9 | Retry backoff exponentiel : 2s, 4s, 8s, 16s (cap 16s) | §2.1 lazy boot backoff |
| 10 | Pendant cooldown → 503 + header `Retry-After` | §2.1 lazy boot backoff |
| 11 | Retry réussi → backoff reset, lazyBootPromise.resolve() | §2.1 lazy boot backoff |
| 12 | `--verbose` log chaque étape avec timing | §2.1 flow step 6 verbose |

### D. HMR / File Watching (dans `dev.test.ts` ou fichier dédié)

| # | Test | Spec ref |
|---|------|----------|
| 1 | `src/api/**/*.ts` → route hot-reload (pas de restart) | §2.1 flow step 8 |
| 2 | `src/subscribers/**/*.ts` → dispose anciens listeners + re-subscribe | §2.1 flow step 8 |
| 3 | `src/workflows/**/*.ts` → unregister + re-register | §2.1 flow step 8 |
| 4 | `src/jobs/**/*.ts` → unregister + re-register | §2.1 flow step 8 |
| 5 | Fichier supprimé → unregister complet | §2.1 flow step 8 fichier supprimé |
| 6 | Fichier renommé → traité comme suppression + création | §2.1 flow step 8 renommé |
| 7 | `src/modules/**/models/*.ts` → PAS de hot-reload, warning "restart needed" | §2.1 flow step 8 |
| 8 | `manta.config.ts` → full restart automatique | §2.1 flow step 8 |
| 9 | Debounce 100ms par fichier (pas global) | §2.1 flow step 8 debouncing |
| 10 | Reloads de fichiers différents sont concurrents | §2.1 flow step 8 debouncing |
| 11 | Changement queued si reload en cours sur le même fichier | §2.1 flow step 8 debouncing |

### E. Utils (`utils/`)

#### E1. `prompts.test.ts`
| # | Test | Spec ref |
|---|------|----------|
| 1 | Détecte TTY via `process.stdin.isTTY` | §2.2 flow step 6 |
| 2 | Fallback `CI=true` → non-interactif | §2.2 flow step 6 |
| 3 | Fallback `MANTA_NON_INTERACTIVE=true` → non-interactif | §2.2 flow step 6 |

### F. Commandes non disponibles

| # | Test | Spec ref |
|---|------|----------|
| 1 | `manta plugin` → "not available in v1" | §9 |
| 2 | `manta user` → "not available in v1" | §9 |
| 3 | `manta migrate-from-medusa` → "not available in v1" | §9 |

### G. Tests d'intégration

| # | Test | Spec ref |
|---|------|----------|
| 1 | `manta init` dans un dossier vide → crée tous les fichiers | §2.10 |
| 2 | `manta init` dans un dossier existant → skip les fichiers existants | §2.10 step 0 |
| 3 | `manta dev` sans `.env` → warning + exit(1) (pas de DATABASE_URL) | §2.1 |
| 4 | `manta build` génère le manifeste complet | §2.8 |
| 5 | `manta db:create` + `manta db:migrate` + `manta db:rollback` → cycle complet | §6 lifecycle |
| 6 | Exit codes : 0 pour succès, 1 pour erreur | §8.1 |
| 7 | SIGINT/SIGTERM → graceful shutdown | §8.2 |

---

## Instructions d'exécution

### Phase 1 : Setup

```bash
# Vérifie que le package existe
ls packages/cli/package.json

# Si vitest n'est pas configuré dans packages/cli/
cat > packages/cli/vitest.config.ts << 'EOF'
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    exclude: ['__tests__/**/*.integration.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'bin/**'],
    },
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
EOF

# Assure les dépendances de test
cd packages/cli && pnpm add -D vitest memfs execa @types/node
```

### Phase 2 : Écriture des tests (boucle)

Pour chaque section de la matrice (A → G) :

1. **Écris le fichier de test complet** selon la matrice ci-dessus
2. **Exécute** : `pnpm --filter @manta/cli vitest run __tests__/unit/config/load-env.test.ts`
3. **Si erreur d'import** (fichier source inexistant) → crée le stub :
   ```typescript
   // Stub minimal — juste assez pour compiler
   export async function loadEnv(cwd: string): Promise<void> {
     throw new Error('Not implemented')
   }
   ```
4. **Si erreur de test** (assertion fausse, mauvais mock) → corrige le test
5. **Passe au fichier suivant** quand tous les tests du fichier sont soit PASS soit FAIL-pour-la-bonne-raison

### Phase 3 : Vérification finale

```bash
# Tous les tests unitaires
pnpm --filter @manta/cli vitest run

# Couverture
pnpm --filter @manta/cli vitest run --coverage

# Les tests d'intégration (séparément, plus lents)
pnpm --filter @manta/cli vitest run __tests__/integration/
```

### Phase 4 : Rapport

À la fin, affiche :
- Nombre total de tests
- Nombre PASS / FAIL / SKIP
- Couverture par fichier source
- Liste des stubs créés (fichiers source à implémenter)

---

## Exemple de test (référence de style)

```typescript
// __tests__/unit/config/load-env.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { vol } from 'memfs'
import path from 'path'

// Mock fs avec memfs
vi.mock('fs', () => import('memfs').then(m => m.fs))
vi.mock('fs/promises', () => import('memfs').then(m => m.fs.promises))

describe('load-env', () => {
  const cwd = '/project'

  beforeEach(() => {
    vol.reset()
    // Reset process.env modifié
    delete process.env.DATABASE_URL
    delete process.env.NODE_ENV
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should load DATABASE_URL from .env file', async () => {
    vol.fromJSON({
      '/project/.env': 'DATABASE_URL=postgresql://localhost:5432/test_db',
      '/project/package.json': '{}',
    })

    const { loadEnv } = await import('@/config/load-env')
    await loadEnv(cwd)

    expect(process.env.DATABASE_URL).toBe('postgresql://localhost:5432/test_db')
  })

  it('should not overwrite existing process.env variables', async () => {
    process.env.DATABASE_URL = 'existing_value'
    vol.fromJSON({
      '/project/.env': 'DATABASE_URL=new_value',
      '/project/package.json': '{}',
    })

    const { loadEnv } = await import('@/config/load-env')
    await loadEnv(cwd)

    expect(process.env.DATABASE_URL).toBe('existing_value')
  })

  it('should apply priority: .env < .env.local < .env.development < .env.development.local', async () => {
    process.env.NODE_ENV = 'development'
    vol.fromJSON({
      '/project/.env': 'MY_VAR=base',
      '/project/.env.local': 'MY_VAR=local',
      '/project/.env.development': 'MY_VAR=dev',
      '/project/.env.development.local': 'MY_VAR=dev_local',
      '/project/package.json': '{}',
    })

    const { loadEnv } = await import('@/config/load-env')
    await loadEnv(cwd)

    expect(process.env.MY_VAR).toBe('dev_local')
  })
})
```

---

## Checklist finale

Avant de considérer la tâche terminée, vérifie :

- [ ] Chaque commande de CLI_SPEC.md a son fichier de test
- [ ] Chaque message d'erreur documenté est vérifié (au moins par substring)
- [ ] Chaque exit code est vérifié
- [ ] Chaque option (`--port`, `--verbose`, `--dry-run`, etc.) est testée
- [ ] Les 18 étapes du bootstrap ont des tests individuels
- [ ] Le HMR/file watching a des tests pour chaque type de fichier
- [ ] Les tests d'intégration couvrent le lifecycle complet
- [ ] Tous les stubs source nécessaires sont créés
- [ ] `pnpm --filter @manta/cli vitest run` exécute sans crash
- [ ] Le rapport final est affiché
