# CLI_SPEC.md — Manta CLI Specification (v3)
> Specification complète de la CLI Manta
> Toutes les commandes, options, flows, erreurs, et comportements
> Référence : FRAMEWORK_SPEC.md (SPEC-070, 084→089, 100→101, 074, 135, 057f, 014)
> v2 : corrections après audit (10 points résolus)
> v3 : 10 gaps comblés (bootstrap séquence inline, config validation, DML scanning, HMR, renommage, allOrNothing, rollback erreurs, secrets prod, build erreurs, exec context)
> v4 : 6 gaps comblés (table d'erreurs bootstrap 18 étapes, adapter override introuvable, HMR suppression/renommage fichiers, format JSON manifeste build, secret temporaire dev algo, contenu templates manta init)
> v5 : 10 gaps comblés (HMR debouncing, lazy boot backoff complet, DML scan erreur TS, migration lock polling, --all-or-nothing DDL, manta exec args/container, manta init fichiers existants, workflow steps manifeste, migrations pendantes mécanisme, defaults prod résolution)

---

## Résumé exécutif

La CLI Manta est le **seul point d'entrée** pour le développeur. Il ne lance jamais le framework manuellement. La CLI lit la configuration, instancie les adapters, gère la DB, et lance le serveur.

**Référence DX : Medusa V2.** Le dev qui connaît Medusa retrouve les mêmes réflexes :
- `.env` pour les secrets et l'URL de la DB
- `manta.config.ts` pour la configuration déclarative
- Une seule commande `manta dev` pour développer

**Binaire** : `manta` (installé via `npx manta` ou `npm install -g @manta/cli`)

**Package** : `@manta/cli`

---

## 1. Architecture de la CLI

### 1.1 Résolution de la configuration

Toutes les commandes (sauf `manta init`) suivent ce flow au démarrage :

```
1. Charger .env depuis le répertoire courant
   → dotenv avec support .env.local, .env.{NODE_ENV}, .env.{NODE_ENV}.local
   → Ordre de priorité (dernier gagne) :
     .env → .env.local → .env.{NODE_ENV} → .env.{NODE_ENV}.local
   → Les variables déjà présentes dans process.env ne sont PAS écrasées

2. Chercher manta.config.ts (ou .js, .mjs)
   → Répertoire courant, puis remonte jusqu'à la racine du projet (détection package.json)
   → Si introuvable → MantaError(NOT_FOUND, 'manta.config.ts not found')

3. Importer et exécuter defineConfig()
   → Résout les env vars référencées (process.env.DATABASE_URL, etc.)
   → Applique les profils dev/prod (SPEC-010)
   → Valide les champs requis selon la commande (voir mapping ci-dessous)

4. Retourner la config résolue
```

#### 1.1.1 Champs requis par commande

| Commande | Champs requis | Notes |
|----------|---------------|-------|
| `manta init` | aucun | Ne charge PAS manta.config.ts (la commande le crée) |
| `manta dev` | `database.url` | Tous les autres ont des defaults dev (§3.1) |
| `manta start` | `database.url` + secrets prod (voir §2.7) | Erreur fatale si manquant |
| `manta build` | aucun | Ne connecte pas la DB. Valide seulement que manta.config.ts existe et parse |
| `manta db:generate` | `database.url` | Connecte la DB pour le diff |
| `manta db:migrate` | `database.url` | Connecte la DB pour appliquer les migrations |
| `manta db:rollback` | `database.url` | Connecte la DB |
| `manta db:diff` | `database.url` | Connecte la DB pour introspection |
| `manta db:create` | `database.url` | Extrait le nom de la DB depuis l'URL |
| `manta exec` | `database.url` | Bootstrap complet nécessaire |

**Règle** : si un champ requis est absent, la CLI affiche le message d'erreur spécifique et exit(1) immédiatement — pas de stack trace, juste le message humain.
```

### 1.2 Résolution du profil (dev/prod)

```
APP_ENV (explicite) → si absent :
  NODE_ENV === 'production' → 'prod'
  NODE_ENV === 'test' → 'dev'
  sinon → 'dev'
```

Le profil affecte :
- Les defaults des adapters (§3.1)
- Le comportement d'`autoMigrate` (autorisé en dev, interdit en prod — SPEC-135)
- Le format des logs (pretty vs JSON)
- La validation des secrets (erreur en prod, warning en dev)

### 1.3 defineConfig() — schema officiel

**IMPORTANT** : le schema ci-dessous est la **cible DX**. Le code actuel dans `packages/core/src/config/types.ts` utilise un format `projectConfig.databaseUrl` hérité de Medusa. La CLI DOIT implémenter le nouveau schema et le mapper vers le format interne. Le mapping est la responsabilité de `load-config.ts` dans la CLI — le dev ne voit jamais le format interne.

```typescript
import { defineConfig } from '@manta/core'

export default defineConfig({
  // Profil (optionnel — auto-détecté depuis APP_ENV / NODE_ENV)
  appEnv: process.env.APP_ENV,

  // Database (requis)
  database: {
    url: process.env.DATABASE_URL!,
    pool: { min: 2, max: 10 },      // defaults dépendent du profil (voir §3.1)
  },

  // HTTP (optionnel)
  http: {
    port: Number(process.env.PORT) || 9000,
    cors: {
      admin: { origin: '*' },
      store: { origin: 'https://mystore.com' },
    },
    rateLimit: {
      enabled: false,      // opt-in
      windowMs: 60_000,
      maxRequests: 100,
    },
  },

  // Auth (optionnel)
  auth: {
    jwtSecret: process.env.JWT_SECRET,
    session: {
      enabled: false,      // opt-in
      cookieName: 'manta.sid',
      ttl: 86400,
      cookie: { httpOnly: true, secure: true, sameSite: 'lax' },
    },
  },

  // Modules (optionnel — auto-découverts depuis src/modules/)
  modules: [],

  // Plugins (optionnel)
  plugins: [],

  // Feature flags (optionnel)
  featureFlags: {
    rbac: false,
    translation: false,
  },

  // Query (optionnel)
  query: {
    maxTotalEntities: 10000,
  },

  // Strict mode (optionnel)
  strict: false,

  // Boot (optionnel)
  boot: {
    lazyBootTimeoutMs: 30000,
    autoMigrate: true,       // auto en dev, interdit en prod (SPEC-135)
  },

  // Events (optionnel)
  events: {
    maxPayloadSize: 64000,
  },
})
```

**Mapping interne** : `load-config.ts` traduit ce format vers `MantaConfig` interne :
```
defineConfig.database.url      → projectConfig.databaseUrl
defineConfig.auth.jwtSecret    → projectConfig.jwtSecret
defineConfig.auth.session.cookie.secret → projectConfig.cookieSecret
defineConfig.http.port         → projectConfig.httpPort
// etc.
```

À terme, `MantaConfig` sera refactoré pour matcher le format `defineConfig` directement. Pour v1, le mapping est un pont de compatibilité.

---

## 2. Commandes

### 2.1 `manta dev`

**La commande principale du développeur.** Fait TOUT d'un bloc.

```bash
manta dev [--port <number>] [--no-migrate] [--verbose]
```

#### Options

| Option | Défaut | Description |
|--------|--------|-------------|
| `--port` | `9000` | Port du serveur HTTP |
| `--no-migrate` | `false` | Skip l'auto-migration |
| `--verbose` | `false` | Log level → debug |

#### Flow d'exécution

```
[1] Résoudre la configuration (§1.1)
    → Charge .env + manta.config.ts
    → Profil = dev (forcé — manta dev est toujours dev)

[2] Valider la configuration
    → database.url DOIT être présent → sinon :
      "❌ database.url is required. Set DATABASE_URL in .env or database.url in manta.config.ts"
    → Les autres champs ont des defaults dev (§3.1)

[3] Initialiser le logger
    → PinoLoggerAdapter({ pretty: true, level: 'info' })
    → Si --verbose → level: 'debug'
    → Affiche : "🚀 Manta dev server starting..."

[4] Connecter la DB
    → DrizzlePgAdapter.initialize({ url: config.database.url, pool: { min: 2, max: 10 } })
    → Si échec → log l'erreur + exit(1) avec message clair :
      "❌ Cannot connect to database at postgresql://localhost:5432/manta_demo
       Is PostgreSQL running? Check your DATABASE_URL in .env"
    → Si succès → log "✓ Database connected"

[5] Auto-migration (sauf si --no-migrate)
    → Utilise `drizzle-kit push` qui fait diff + apply en un shot
    → Concrètement :
      a. Scanner tous les modules DML (src/modules/**/models/*.ts)
      b. Générer le schema Drizzle dans drizzle/schema/ (SPEC-057f)
      c. Appeler drizzle-kit push (compare schema Drizzle vs DB réelle, applique les changements)
    → Si pas de changement → log "✓ Database schema up to date"
    → Si changements appliqués :
      "📋 Schema changes applied:
       + CREATE TABLE products (id, title, price, ...)
       ✓ Database schema updated"
    → Si échec → log warning + continue (le serveur démarre quand même) :
      "⚠ Auto-migration failed: [detail]. Server starting with current schema."
    → On ne bloque PAS le dev. Il peut corriger et relancer.
    → Timeout : 30s pour l'ensemble (SPEC-135)

[6] Bootstrap 18 étapes (SPEC-074)
    → Séquence complète (ref: BOOTSTRAP_SEQUENCE.md) :

      CORE BOOT (synchrone, bloque le démarrage) :
        [1]  Charger la configuration (defineConfig, profil dev/prod, merge env vars)
        [2]  Initialiser les feature flags (FlagRouter)
        [3]  Créer le container DI (Awilix + AsyncLocalStorage)
        [4]  Initialiser le logger (Pino pretty/JSON)
        [5]  Établir la connexion DB (pool + SELECT 1 healthcheck)
        [6]  Charger les modules requis (EVENT_BUS + CACHE — obligatoires)
        [7]  Activer le buffer d'events (emit() → buffered FIFO, subscribe() OK)
        [8]  Enregistrer les routes API (manifest ou scan filesystem)
      ──── serveur HTTP prêt, requêtes en attente sur lazyBootPromise ────
      [8.5] autoMigrate (dev uniquement, sauf --no-migrate, timeout 30s)

      LAZY BOOT (déclenché par la première requête) :
        [9]  Charger tous les modules restants (IModuleLoader.bootstrap())
        [10] Enregistrer QUERY + LINK + REMOTE_LINK
        [11] Charger les link modules (defineLink → tables de jointure)
        [12] Charger les workflows (WorkflowManager.register())
        [13] Charger les subscribers (IEventBusPort.subscribe())
        [14] Charger les policies RBAC (si flag rbac actif, sinon skip)
        [15] Charger les jobs planifiés (si triggers.cron actif, sinon skip)
        [16] Appeler onApplicationStart() sur tous les modules
        [17] Synchroniser les settings de traduction (si flag actif, sinon skip)
        [18] Libérer le buffer d'events (publish FIFO + lazyBootPromise.resolve())
      ──── framework 100% opérationnel ────

    → Comportement d'erreur par étape :

      CORE BOOT — toute erreur est FATALE (exit(1)) :
      | Étape | Erreur possible | Message | Comportement |
      |-------|----------------|---------|--------------|
      | [1] Config | defineConfig() parse error | "❌ Failed to load manta.config.ts: [detail]" | exit(1) |
      | [2] Feature flags | Flag inconnu | "❌ Unknown feature flag 'xyz' in defineConfig()" | exit(1) |
      | [3] Container | ALS indisponible (Node < 18) | "❌ AsyncLocalStorage not available. Node >= 18.x required." | exit(1) |
      | [4] Logger | Pino init fail (rare) | "❌ Logger initialization failed: [detail]" | exit(1) |
      | [5] DB | Connexion refuse / timeout | "❌ Cannot connect to database at [url]. Is PostgreSQL running?" | exit(1) |
      | [6] Modules requis | EVENT_BUS ou CACHE ne charge pas | "❌ Required module 'EVENT_BUS' failed to load: [detail]" | exit(1) |
      | [7] Event buffer | Échec activation (bug interne) | "❌ Event buffer activation failed: [detail]" | exit(1) |
      | [8] Routes | Scan filesystem échoue | "⚠ Route 'src/api/admin/x/route.ts' could not be parsed. Skipped." | WARNING, continue |
      | [8.5] autoMigrate | drizzle-kit push échoue | "⚠ Auto-migration failed: [detail]. Server starting with current schema." | WARNING, continue |

      LAZY BOOT — erreurs sont NON-FATALES sauf [9] :
      | Étape | Erreur possible | Message | Comportement |
      |-------|----------------|---------|--------------|
      | [9] Modules restants | Un module échoue à bootstrap | "❌ Module 'product' failed to load: [detail]" | FATAL — 503 + lazyBootPromise.reject(). Retry au prochain request (voir backoff ci-dessous) |
      | [10] QUERY/LINK | Enregistrement échoue | "❌ QUERY registration failed: [detail]" | FATAL — même comportement que [9] |
      | [11] Link modules | defineLink invalide | "⚠ Link 'product-category' failed to load: [detail]. Skipped." | WARNING, continue |
      | [12] Workflows | WorkflowManager.register() échoue | "⚠ Workflow 'create-product' failed to register: [detail]. Skipped." | WARNING, continue |
      | [13] Subscribers | subscribe() échoue | "⚠ Subscriber 'product-created.ts' failed to register: [detail]. Skipped." | WARNING, continue |
      | [14] RBAC | Policies invalides | "⚠ RBAC policy 'admin-products' invalid: [detail]. Skipped." | WARNING, continue |
      | [15] Jobs | Job register échoue | "⚠ Job 'cleanup-carts' failed to register: [detail]. Skipped." | WARNING, continue |
      | [16] onApplicationStart | Module throw | "⚠ Module 'product' onApplicationStart() failed: [detail]." | WARNING, continue |
      | [17] Traduction | Sync échoue | "⚠ Translation sync failed: [detail]." | WARNING, continue |
      | [18] Event release | Buffer release échoue | "❌ Event buffer release failed: [detail]" | FATAL — 503 |

      Règles :
      - CORE BOOT [1-8] : toute erreur = exit(1). Le serveur ne démarre pas.
        Exception : [8] routes et [8.5] autoMigrate sont best-effort (warning).
      - LAZY BOOT [9-18] : seules [9], [10], [18] sont fatales (503 + retry avec backoff).
        Les autres sont best-effort : le framework démarre avec les composants qui ont réussi.
      - En mode --verbose, chaque étape est loggée même en cas de succès.

      Lazy boot retry backoff (étapes fatales [9], [10], [18]) :
      - Exponentiel : 2s, 4s, 8s, 16s. Cap à 16s.
      - Retry infini (pas de max). Le serveur ne meurt jamais de lui-même.
      - Pendant le cooldown, toute requête reçoit 503 + header Retry-After: <secondes restantes>.
      - Chaque retry re-tente le lazy boot complet (étapes 9→18).
      - Si un retry réussit → backoff reset à 0, lazyBootPromise.resolve(), trafic normal.
      - En serverless (Vercel) : non pertinent — chaque invocation est un cold start indépendant.

    → En mode --verbose, log chaque étape :
      "[boot:1] Config loaded (3ms)"
      "[boot:5] Database connected (45ms)"
      "[boot:18] Event buffer released (1ms)"

[7] Lancer le serveur HTTP
    → NitroAdapter en mode dev (preset: node)
    → Écoute sur le port configuré
    → Log "✓ Server ready on http://localhost:9000"
    → Log "  Routes: 12 routes loaded (3 admin, 5 store, 4 auth)"

[8] Activer le file watching (HMR)
    → Utilise le file watcher intégré de Nitro (basé sur chokidar en interne)
    → Si Nitro ne gère pas un type de fichier, fallback sur chokidar directement
    → Watch patterns et comportement de rechargement :

      - src/api/**/*.ts → **route hot-reload** :
        Le routeur HTTP invalide les handlers concernés et re-importe le fichier.
        Nitro gère ce mécanisme nativement en mode dev (HMR intégré).
        Pas de restart du process. Les requêtes en cours finissent normalement.
        Log : "♻ Route reloaded: GET /admin/products"

      - src/subscribers/**/*.ts → **re-register** :
        1. Dispose les anciens listeners pour les events du fichier modifié
           (appel IEventBusPort.unsubscribe() pour chaque handler du fichier précédent)
        2. Re-importe le fichier
        3. Re-subscribe les nouveaux handlers
        → Sans le dispose, les anciens listeners continueraient à recevoir des events
        Log : "♻ Subscriber reloaded: product-created.ts (2 handlers)"

      - src/workflows/**/*.ts → **re-register** :
        1. WorkflowManager.unregister(workflowId) pour les workflows du fichier modifié
        2. Re-importe le fichier
        3. WorkflowManager.register() pour les nouveaux workflows
        → Les exécutions en cours de l'ancien workflow continuent jusqu'à completion
        Log : "♻ Workflow reloaded: create-product"

      - src/jobs/**/*.ts → **re-register** :
        1. IJobSchedulerPort.unregister(jobId) pour les jobs du fichier modifié
        2. Re-importe le fichier
        3. IJobSchedulerPort.register() pour les nouveaux jobs
        Log : "♻ Job reloaded: cleanup-expired-carts"

      - **Fichier supprimé** (tous types sauf models/) :
        → Traité comme un "unregister" complet :
          - Route supprimée → handler retiré du routeur HTTP.
            Log : "🗑 Route removed: DELETE /admin/products/:id"
          - Subscriber supprimé → tous les handlers du fichier sont unsubscribe'd.
            Log : "🗑 Subscriber removed: product-created.ts (2 handlers unregistered)"
          - Workflow supprimé → WorkflowManager.unregister(). Les exécutions en cours continuent.
            Log : "🗑 Workflow removed: create-product"
          - Job supprimé → IJobSchedulerPort.unregister().
            Log : "🗑 Job removed: cleanup-expired-carts"
        → Les handlers/listeners en cours d'exécution finissent normalement.

      - **Fichier renommé** (tous types) :
        → Le watcher voit un événement `unlink` (ancien nom) + `add` (nouveau nom).
        → Traité comme suppression + création. Pas de continuité.
        → Log : "🗑 Route removed: GET /admin/products"
                "♻ Route loaded: GET /admin/items"

      - **Debouncing et concurrence** :
        → Debounce de 100ms par fichier (pas global). Si le même fichier change N fois
          en 100ms, un seul reload est effectué.
        → Si un reload est en cours pour un fichier F et qu'un nouveau changement arrive sur F :
          le changement est queued. Quand le reload en cours finit, un nouveau reload démarre.
        → Les reloads de fichiers DIFFÉRENTS sont indépendants et concurrents.
        → Implémentation : chokidar watcher → Map<filePath, debounceTimer> → handler.

      - src/modules/**/models/*.ts → **pas de hot-reload** :
        Log warning :
        "⚠ Model changed — restart needed for DB migration. Press Ctrl+C and run manta dev again."

      - manta.config.ts → **full restart automatique** :
        Kill le serveur + relance manta dev depuis l'étape [1]
        Log : "♻ Config changed — restarting..."

    → Log "👀 Watching for changes..."

[9] Gérer le shutdown
    → SIGINT (Ctrl+C) ET SIGTERM → graceful shutdown :
      "Shutting down..."
      → container.dispose() (SPEC-071, timeout 500ms)
      → "Goodbye."
```

#### Output typique

```
🚀 Manta dev server starting...
✓ Database connected (postgresql://localhost:5432/manta_demo)
✓ Database schema up to date
✓ Modules loaded: product, order, customer (3 modules)
✓ Routes loaded: 12 routes (3 admin, 5 store, 4 auth)
✓ Subscribers: 5 registered
✓ Server ready on http://localhost:9000

👀 Watching for changes...
```

#### Erreurs fréquentes et messages

| Situation | Message | Exit ? |
|-----------|---------|--------|
| `.env` absent | Warning : "No .env file found. Using environment variables only." | Non |
| `manta.config.ts` absent | "❌ manta.config.ts not found. Run `manta init` to create one." | Oui (1) |
| `DATABASE_URL` absent | "❌ database.url is required. Set DATABASE_URL in .env" | Oui (1) |
| PG non joignable | "❌ Cannot connect to database. Is PostgreSQL running?" | Oui (1) |
| DB inexistante | "❌ Database 'manta_demo' does not exist. Run `manta db:create` or create it manually." | Oui (1) |
| Migration échoue | Warning + continue : "⚠ Auto-migration failed: [detail]." | Non |
| Port occupé | "❌ Port 9000 is already in use. Use --port to specify another." | Oui (1) |
| Module DML invalide | Warning : "⚠ Module 'product' has DML errors: [detail]. Skipped." | Non |

---

### 2.2 `manta db:generate`

**Génère les fichiers SQL de migration à partir des changements DML.**

```bash
manta db:generate [--name <string>]
```

#### Options

| Option | Défaut | Description |
|--------|--------|-------------|
| `--name` | auto-généré | Nom de la migration. Si absent, drizzle-kit génère un nom basé sur le diff. |

#### Flow d'exécution

```
[1] Résoudre la configuration (§1.1)

[2] Scanner les modules DML
    → Cherche src/modules/**/models/*.ts
    → Importe chaque fichier, extrait les model.define()
    → Si un fichier matche le pattern mais n'exporte PAS de model.define() :
      - Warning : "⚠ File 'src/modules/product/models/utils.ts' matches model pattern but exports no DML entity. Skipped."
      - Comportement identique dans manta dev ET db:generate — c'est un warning, JAMAIS une erreur fatale
      - Raison : le dev peut avoir des helpers/utils dans le répertoire models/
    → Si un fichier exporte un model.define() invalide (types incorrects, champs manquants) :
      - Warning : "⚠ Invalid DML in 'src/modules/product/models/product.ts': [detail]. Skipped."
    → Si l'import dynamique du fichier échoue (erreur de syntaxe TS, runtime error) :
      - Warning : "⚠ Cannot import 'src/modules/product/models/product.ts': [error message]. Skipped."
      - Comportement IDENTIQUE dans manta dev (étape 5) et db:generate (étape 2)
      - Ce n'est jamais une erreur fatale — le fichier est skipped, les autres continuent
    → Log "Found 3 DML entities: Product, Order, Customer"

[3] Générer le schema Drizzle
    → Pour chaque entité DML, exécute le pipeline DML→Drizzle (SPEC-057f)
    → Écrit les fichiers .ts dans drizzle/schema/
    → Log "Generated Drizzle schema: drizzle/schema/products.ts, ..."

[4] Appeler drizzle-kit generate
    → drizzle-kit compare le schema Drizzle avec les migrations existantes
    → Génère un fichier SQL dans drizzle/migrations/
    → Log "Generated migration: drizzle/migrations/0001_create_products.sql"

[5] Générer le fichier de rollback squelette (SPEC-014)
    → Crée 0001_create_products.down.sql
    → Contenu : "-- TODO: Write rollback SQL for this migration"

[6] Détection de renommage (SPEC-057f)
    → Si une colonne disparaît et une nouvelle apparaît (même type, même table) :
      "Column 'title' removed and 'name' (same type: text) added on table 'product'.
       Is this a rename? [y/N]"
    → Si oui → ALTER TABLE RENAME COLUMN
    → Si plusieurs paires de même type matchent (ex: drop title+description, add name+summary, tous text) :
      - Prompt par paire, présenté dans l'ordre alphabétique des colonnes supprimées :
        "Column 'description' removed and 'name' added (same type: text). Rename? [y/N]"
        "Column 'description' removed and 'summary' added (same type: text). Rename? [y/N]"
        (etc. — toutes les combinaisons possibles sont proposées)
      - Dès qu'une paire est acceptée, les deux colonnes sont retirées des candidats restants
      - Si aucune paire n'est acceptée → DROP + ADD classique
    → Détection CI / non-interactif :
      - Vérifie `process.stdin.isTTY === true` (Node.js standard)
      - Fallback : env var `CI=true` ou `MANTA_NON_INTERACTIVE=true`
      - Si non-interactif → jamais de rename auto → DROP + ADD
      - Log : "Non-interactive mode: treating column changes as drop+add (not rename)"

[7] Warning pour changements dangereux
    → Si le SQL contient DROP COLUMN, ALTER TYPE, DROP TABLE :
      "⚠ WARNING: This migration contains destructive changes:
       - DROP COLUMN legacy_sku on table products
       Review the SQL before applying with `manta db:migrate`"

[8] Résumé
    → "✓ Migration generated: 0001_create_products.sql
       Review the SQL, then apply with: manta db:migrate"
    → Si pas de changement : "✓ No schema changes detected."
```

---

### 2.3 `manta db:migrate`

**Applique les migrations SQL pendantes sur la DB.**

```bash
manta db:migrate [--force] [--dry-run] [--json] [--all-or-nothing]
```

#### Options

| Option | Défaut | Description |
|--------|--------|-------------|
| `--force` | `false` | Applique les changements dangereux sans confirmation |
| `--dry-run` | `false` | Affiche les SQL sans appliquer. Avec `--json` : output JSON parseable |
| `--json` | `false` | Output JSON sur stdout (utile en CI) |
| `--all-or-nothing` | `false` | Exécute TOUTES les migrations dans une seule transaction PG. Si une échoue → ROLLBACK total |
| `--force-unlock` | `false` | Supprime le lock de migration sans condition, puis exit(0). Usage : après un crash qui a laissé un lock orphelin |

#### Flow d'exécution

```
[1] Résoudre la configuration + connecter DB

[2] Acquérir le lock de migration (SPEC-014)
    → ILockingPort.acquire(['migration'], { expire: 3600000 }) — 1h TTL
    → Si lock déjà pris : "⏳ Another migration is in progress. Waiting..."
    → Mécanisme d'attente : polling simple, retry toutes les 2s pendant 60s max.
      Pas de notification PG (pg_notify serait une optimisation future, pas v1).
      Concrètement : while (!acquired && elapsed < 60s) { await sleep(2000); try acquire; }
    → Timeout 60s → "❌ Migration lock timeout. Another migration may still be running.
      Use `manta db:migrate --force-unlock` to release a stale lock."
    → --force-unlock : supprime le lock sans condition, puis exit(0). Usage : après un crash
      qui a laissé un lock orphelin. Log : "⚠ Migration lock force-released."

[3] Lire les migrations pendantes
    → Liste drizzle/migrations/*.sql vs table de tracking
    → Log "Found 2 pending migrations: 0001_..., 0002_..."

[4] Si aucune → "✓ Database is up to date." → exit(0)

[5] Si --dry-run → affiche le SQL (ou JSON si --json) → exit(0)

[6] Vérifier les changements dangereux (sans --force)
    → Si DROP/ALTER TYPE : demande confirmation
    → Si --force → skip

[7] Appliquer les migrations
    → Sans --all-or-nothing (défaut) : chaque migration est appliquée séquentiellement
      dans sa propre transaction implicite PG (le DDL est auto-commit en PG).
      Si une migration échoue en milieu de batch :
        - Les migrations précédentes sont commitées (irréversible)
        - La migration échouée est rollbackée
        - Le tracking est mis à jour pour les migrations réussies uniquement
        - Exit(1) avec message : "❌ Migration 0002_add_status.sql failed: [detail].
          2/3 migrations applied. Fix the issue and run `manta db:migrate` again."
    → Avec --all-or-nothing : toutes les migrations sont wrappées dans un seul
      BEGIN / COMMIT. Si une échoue → ROLLBACK total, rien n'est appliqué.
      Exit(1) avec message : "❌ Migration 0002_add_status.sql failed: [detail].
      All migrations rolled back (--all-or-nothing mode)."
      Note DDL transactionnel : PostgreSQL supporte le DDL dans des transactions
      (CREATE TABLE, ALTER TABLE, DROP TABLE fonctionnent dans BEGIN/COMMIT).
      EXCEPTION : CREATE INDEX CONCURRENTLY ne peut PAS être dans une transaction.
      Si --all-or-nothing est actif et qu'une migration contient CREATE INDEX CONCURRENTLY :
        "❌ Migration 0003_add_index.sql uses CREATE INDEX CONCURRENTLY which is
        incompatible with --all-or-nothing (transactional) mode.
        Either remove CONCURRENTLY or run without --all-or-nothing."
        Exit(1) — détection via regex avant exécution, AUCUNE migration n'est appliquée.
    → "Applying 0001_create_products.sql... ✓ (23ms)"

[8] Mettre à jour le tracking + module_versions (SPEC-135)

[9] Relâcher le lock

[10] "✓ 2 migrations applied successfully."
```

---

### 2.4 `manta db:rollback`

**Rollback la dernière migration.** Best-effort (SPEC-014).

```bash
manta db:rollback [--steps <number>]
```

| Option | Défaut | Description |
|--------|--------|-------------|
| `--steps` | `1` | Nombre de migrations à rollback |

#### Flow

```
[1] Résoudre config + connecter DB
[2] Lire les N dernières migrations appliquées (tracking, ordre inverse)
[3] Pour chaque (dans l'ordre inverse d'application) :
    → Chercher le fichier .down.sql correspondant
    → Si .down.sql absent :
      "❌ Rollback file not found: drizzle/migrations/0002_add_status.down.sql
       Create the rollback SQL manually and try again."
      → STOP immédiatement. Les rollbacks suivants NE sont PAS tentés.
      → Exit(1)
    → Si .down.sql contient seulement le TODO placeholder :
      "❌ Rollback file is empty: drizzle/migrations/0002_add_status.down.sql
       It contains only the TODO placeholder. Write the rollback SQL and try again."
      → STOP immédiatement. Exit(1)
    → Si .down.sql est valide : exécuter le SQL dans une transaction
    → Si l'exécution SQL échoue :
      "❌ Rollback failed for 0002_add_status.down.sql: [PG error detail]
       Database may be in an inconsistent state. Consider using a forward fix."
      → STOP immédiatement. Exit(1)
      → Le tracking N'est PAS modifié pour cette migration (elle reste "appliquée")
[4] Mettre à jour le tracking (retirer les migrations rollbackées avec succès)
[5] "✓ Rolled back 1 migration."
```

**Principe** : au premier échec, on s'arrête. On ne tente pas les rollbacks suivants pour éviter des états incohérents. Le dev doit corriger et relancer.

---

### 2.5 `manta db:diff`

**Compare le schema DML vs la DB réelle. Lecture seule.** (SPEC-087)

```bash
manta db:diff [--json]
```

| Option | Défaut | Description |
|--------|--------|-------------|
| `--json` | `false` | Output JSON sur stdout |

#### Flow

```
[1] Résoudre config + connecter DB
[2] Générer le schema Drizzle attendu depuis le DML (en mémoire)
[3] Introspecter la DB via information_schema + pg_indexes + pg_trigger
[4] Comparer : tables/colonnes manquantes (CREATE), extra (NOTIFY), type changé (NOTIFY + warning)
[5] Afficher le rapport (table console ou JSON)
[6] "✓ Diff complete. 1 change, 1 notification."
```

---

### 2.6 `manta db:create`

**Crée la database si elle n'existe pas.**

```bash
manta db:create
```

#### Flow

```
[1] Résoudre la configuration
[2] Extraire le nom de la DB depuis l'URL → "manta_demo"
[3] Connecter au serveur PG (base "postgres" par défaut)
[4] Si existe → "✓ Database 'manta_demo' already exists."
    Si n'existe pas → CREATE DATABASE → "✓ Database 'manta_demo' created."
```

---

### 2.7 `manta start`

**Lance le serveur en mode production.**

```bash
manta start [--port <number>]
```

#### Différences avec `manta dev`

| Aspect | `manta dev` | `manta start` |
|--------|-------------|---------------|
| Profil | Toujours `dev` | Toujours `prod` |
| Auto-migrate | Oui (sauf --no-migrate) | **Non** — si migrations pendantes → exit(1) |
| HMR/Watch | Oui (Nitro + chokidar) | Non |
| Logs | Pino pretty | Pino JSON |
| Secrets manquants | Warning | **Erreur fatale** |
| Pool DB | min: 2, max: 10 | Dépend du preset (voir note) |

**Note sur le pool DB en prod** : le pool dépend du preset Nitro :
- Preset `vercel` / `aws-lambda` (serverless) → `min: 0, max: 5` (connexion lazy, pas d'idle)
- Preset `node` / `bun` (long-running) → `min: 5, max: 20` (pool classique)
- Override possible dans defineConfig().database.pool

**Note sur Vercel** : en déploiement Vercel, `manta start` n'est PAS utilisé. Vercel invoque les fonctions directement. Le flow Vercel est : `manta build` (avec preset vercel) → Vercel déploie le bundle. `manta start` est pour les déploiements Node classiques (VPS, Docker, Railway).

#### Flow

```
[1] Résoudre la configuration (profil = prod)

[2] Valider les secrets requis (erreur fatale si manquant)
    → Les secrets requis dépendent de la configuration active :

    Toujours requis en prod :
      - JWT_SECRET (auth.jwtSecret) — TOUJOURS requis car les routes API
        admin utilisent l'auth JWT par défaut. Même sans module Auth custom,
        les routes protégées vérifient les JWT.
        "❌ JWT_SECRET is required in production. Set it in .env"

    Conditionnel :
      - COOKIE_SECRET (auth.session.cookie.secret) — requis SEULEMENT si
        auth.session.enabled === true dans defineConfig()
        "❌ COOKIE_SECRET is required when session auth is enabled. Set it in .env"

    Non requis si aucun module Auth :
      - Si le projet n'a AUCUNE route protégée (aucun namespace /admin ou /auth),
        JWT_SECRET est quand même requis — le framework ne fait pas d'analyse
        statique des routes pour déterminer si l'auth est utilisée. C'est un
        choix de sécurité : mieux vaut exiger un secret inutile que manquer
        un secret nécessaire.

    → En mode dev : ces mêmes checks sont faits mais en WARNING (pas erreur fatale).
      Le dev peut travailler sans secrets — le framework génère un secret temporaire
      en mémoire et log un warning :
      "⚠ JWT_SECRET not set. Using a random secret (sessions won't survive restart)."
      → Secret temporaire : crypto.randomBytes(32).toString('hex') — 64 chars hex.
        Généré une fois au boot, perdu au restart. Même algo pour COOKIE_SECRET temporaire.

[3] Connecter la DB
[4] Vérifier migrations pendantes (SPEC-135)
    → Mécanisme : comparaison fichiers drizzle/migrations/*.sql vs table de tracking
      (même logique que db:migrate étape [3]). Fichiers absents du tracking = pendants.
      Ce n'est PAS un db:diff (pas d'introspection schema). Simple diff fichiers vs tracking.
      Rapide (<50ms).
    → Si mismatch → "❌ Pending migrations. Run `manta db:migrate`." → exit(1)
[5] Bootstrap 18 étapes (SPEC-074)
[6] Lancer le serveur HTTP (Nitro, preset selon config)
[7] SIGINT ET SIGTERM → graceful shutdown (SPEC-071, timeout 500ms)
```

---

### 2.8 `manta build`

**Build le projet pour le déploiement.** (SPEC-074, SPEC-100)

```bash
manta build [--preset <string>]
```

#### Options

| Option | Défaut | Description |
|--------|--------|-------------|
| `--preset` | `node` | Preset Nitro : `node`, `vercel`, `aws-lambda`, `cloudflare`, `bun` |

#### Flow

```
[1] Résoudre la configuration

[2] Scanner le filesystem et générer le manifeste .manta/manifest/ :
    → Fichiers générés et leur schema JSON :

    routes.json :
    {
      "routes": [
        {
          "path": "/admin/products",
          "methods": ["GET", "POST"],
          "file": "src/api/admin/products/route.ts",
          "namespace": "admin",
          "middlewares": []
        }
      ]
    }

    subscribers.json :
    {
      "subscribers": [
        {
          "id": "product-created-handler",
          "file": "src/subscribers/product-created.ts",
          "events": ["product.created"]
        }
      ]
    }

    workflows.json :
    {
      "workflows": [
        {
          "id": "create-product",
          "file": "src/workflows/create-product.ts",
          "steps": ["validate-product", "create-product-record", "emit-event"]
        }
      ]
    }

    jobs.json :
    {
      "jobs": [
        {
          "id": "cleanup-expired-carts",
          "file": "src/jobs/cleanup-expired-carts.ts",
          "schedule": "0 */6 * * *"
        }
      ]
    }

    links.json :
    {
      "links": [
        {
          "id": "product-category",
          "file": "src/links/product-category.ts",
          "modules": ["product", "category"],
          "table": "product_category_link"
        }
      ]
    }

    modules.json :
    {
      "modules": [
        {
          "name": "product",
          "file": "src/modules/product/index.ts",
          "models": ["Product"],
          "service": "ProductService"
        }
      ]
    }

    → Extraction des steps dans workflows.json :
      - PAS d'analyse AST. Le manifeste importe et exécute le fichier workflow.
      - createWorkflow() et step() sont des fonctions déclaratives qui enregistrent
        les steps dans WorkflowManager au moment de l'import — sans les exécuter.
      - Concrètement : import('src/workflows/create-product.ts') → le code top-level
        appelle createWorkflow({ name, steps: [...] }) → les step IDs sont collectés.
      - Les steps conditionnels apparaissent dans le manifeste mais peuvent ne pas
        s'exécuter au runtime (le manifeste reflète la déclaration statique).

    → Contrat minimal pour les tests :
      - Chaque fichier JSON est un objet avec une clé racine (nom pluriel)
      - Chaque entrée a au minimum : un identifiant et un file (chemin relatif)
      - Les chemins sont relatifs à la racine du projet
      - Si aucun élément trouvé → tableau vide (PAS d'omission du fichier)

[3] Exécuter nitro build (PAS tsc — Nitro a son propre build system)
    → nitropack compile le projet avec le preset cible
    → Output dans .output/ (convention Nitro)
    → Pour Vercel : génère les serverless functions dans .vercel/output/

[4] Résumé :
    "✓ Build complete (preset: vercel)
     Manifest: 12 routes, 5 subscribers, 3 workflows, 2 jobs
     Output: .output/"
```

#### Erreurs

| Situation | Message | Exit ? |
|-----------|---------|--------|
| `manta.config.ts` absent | "❌ manta.config.ts not found. Run `manta init` to create one." | Oui (1) |
| `manta.config.ts` ne parse pas (erreur TS) | "❌ Failed to load manta.config.ts: [TS error detail]" | Oui (1) |
| Preset inconnu | "❌ Unknown preset 'xyz'. Available presets: node, vercel, aws-lambda, cloudflare, bun" | Oui (1) |
| Nitro build échoue (erreur TS dans le code app) | "❌ Build failed:\n[Nitro/rollup error output]\nFix the TypeScript errors and try again." | Oui (1) |
| Nitro build échoue (dépendance manquante) | "❌ Build failed: Cannot resolve module '[module]'.\nRun `npm install` and try again." | Oui (1) |
| Manifest generation échoue (fichier route invalide) | "⚠ Warning: Route 'src/api/admin/products/route.ts' could not be parsed. Skipped." | Non (warning, build continue) |
| Aucun module DML trouvé | "⚠ No DML entities found in src/modules/**/models/. Manifest will have no schema." | Non (warning) |
| Répertoire .output/ non writable | "❌ Cannot write to .output/: [OS error]. Check permissions." | Oui (1) |

**Note** : `manta build` ne connecte PAS la DB et ne valide PAS les secrets. C'est un build statique. Les erreurs sont donc limitées au parsing de la config et à la compilation Nitro.

---

### 2.9 `manta exec`

**Exécute un script avec le container framework chargé.** (SPEC-086)

```bash
manta exec <script> [--dry-run] [-- ...args]
```

| Option | Défaut | Description |
|--------|--------|-------------|
| `--dry-run` | `false` | Transaction rollback + aucun event émis |

#### Flow

```
[1] Résoudre la configuration

[2] Bootstrap complet (18 étapes)

[3] Créer un scoped container avec AuthContext system/cli
    → L'AuthContext "system/cli" est un contexte pré-défini avec :
      {
        actor_type: 'system',
        actor_id: 'cli',
        app_metadata: { source: 'manta-exec' }
      }
    → Ce contexte a des permissions implicites ADMIN — il bypass le RBAC
    → C'est le même type de contexte que les cron jobs (actor_type: 'system')
    → Enregistré comme AUTH_CONTEXT SCOPED dans le scope

[4] Si --dry-run → wrapper dans une transaction, clearMessages() après, ROLLBACK

[5] Importer et exécuter le script
    → Le script reçoit { container, args } où :
      - container : le SCOPED container (celui créé à l'étape [3] avec AuthContext system/cli).
        PAS le root container. Le script peut resolve des services SCOPED.
      - args : string[] — les arguments après `--` dans la commande. Tableau de strings brut.
        Exemple : `manta exec scripts/seed.ts -- --count 100 --env staging`
        → args = ['--count', '100', '--env', 'staging']
        Si pas de `--` → args = []
    → Le script DOIT exporter une default function :
      export default async ({ container, args }) => { ... }
    → Si le fichier n'existe pas :
      "❌ Script not found: scripts/seed.ts"
      Exit(1)
    → Si le fichier n'exporte PAS de default function :
      "❌ Script 'scripts/seed.ts' must export a default async function.
       Expected: export default async ({ container, args }) => { ... }"
      Exit(1)
    → Si le script throw une erreur :
      "❌ Script failed: [error message]
       [stack trace]"
      Exit(1)

[6] Succès → exit(0). dispose() le container.
```

---

### 2.10 `manta init`

**Initialise un nouveau projet Manta.**

```bash
manta init [--dir <path>]
```

#### Flow

```
[0] Vérifier les fichiers existants
    → manta init ne DÉTRUIT jamais un fichier existant.
    → Pour chaque fichier à générer (manta.config.ts, package.json, .env, tsconfig.json, drizzle.config.ts) :
      si le fichier existe → SKIP + log : "⊘ [fichier] already exists. Skipped."
    → Répertoires existants (src/modules/, etc.) → pas d'erreur, mkdir -p (idempotent).
    → Si TOUS les fichiers existent déjà :
      "✓ Project already initialized. Nothing to do." → exit(0)

[1] Créer la structure :
    src/{api/admin, api/store, modules, subscribers, workflows, jobs, links}

[2] Générer les fichiers avec contenu minimal (seulement ceux qui n'existent PAS) :

    → manta.config.ts :
      ```typescript
      import { defineConfig } from '@manta/core'

      export default defineConfig({
        database: {
          url: process.env.DATABASE_URL!,
        },
        http: {
          port: Number(process.env.PORT) || 9000,
        },
      })
      ```

    → .env :
      ```
      DATABASE_URL=postgresql://localhost:5432/manta_dev
      PORT=9000
      # JWT_SECRET=
      # COOKIE_SECRET=
      ```

    → .env.example : même contenu que .env (sans valeurs sensibles)

    → package.json :
      ```json
      {
        "name": "<nom-du-dossier>",
        "version": "0.1.0",
        "type": "module",
        "scripts": {
          "dev": "manta dev",
          "build": "manta build",
          "start": "manta start",
          "db:generate": "manta db:generate",
          "db:migrate": "manta db:migrate"
        },
        "dependencies": {
          "@manta/core": "^0.1.0",
          "@manta/cli": "^0.1.0"
        }
      }
      ```
      → Clés obligatoires pour les tests : name, type, scripts.dev, dependencies.@manta/core

    → tsconfig.json :
      ```json
      {
        "compilerOptions": {
          "target": "ES2022",
          "module": "ESNext",
          "moduleResolution": "bundler",
          "strict": true,
          "esModuleInterop": true,
          "outDir": "dist",
          "rootDir": "src"
        },
        "include": ["src/**/*.ts", "manta.config.ts"]
      }
      ```

    → drizzle.config.ts :
      ```typescript
      import { defineConfig } from 'drizzle-kit'

      export default defineConfig({
        schema: './drizzle/schema/*.ts',
        out: './drizzle/migrations',
        dialect: 'postgresql',
        dbCredentials: {
          url: process.env.DATABASE_URL!,
        },
      })
      ```

[3] "✓ Manta project initialized.
     Next steps:
     1. Edit .env and set DATABASE_URL
     2. Create your first module in src/modules/
     3. Run: manta dev"
```

---

## 3. Résolution des adapters

### 3.1 Defaults par profil

La CLI résout les adapters automatiquement selon le profil. Override possible dans defineConfig().adapters.

| Port | Dev (auto) | Prod (auto) |
|------|------------|-------------|
| ILoggerPort | PinoLoggerAdapter({ pretty: true }) | PinoLoggerAdapter({ pretty: false }) |
| IDatabasePort | DrizzlePgAdapter (PG local) | DrizzlePgAdapter (Neon) |
| ICachePort | InMemoryCacheAdapter | UpstashCacheAdapter |
| IEventBusPort | InMemoryEventBusAdapter | VercelQueueAdapter |
| ILockingPort | InMemoryLockingAdapter | NeonAdvisoryLockAdapter |
| IFilePort | LocalFilesystemAdapter (`./static/`) | VercelBlobAdapter |
| IJobSchedulerPort | InMemoryJobScheduler | VercelCronAdapter |
| IWorkflowStoragePort | DrizzlePgAdapter (même DB) | DrizzlePgAdapter (Neon, même DB) |
| IHttpPort | NitroAdapter (preset: node) | NitroAdapter (preset: vercel) |

**Notes corrections vs v1** :
- IFilePort dev : **LocalFilesystemAdapter** (stocke dans `./static/`, persistant entre restarts), PAS InMemoryFileAdapter
- IWorkflowStoragePort dev : **DrizzlePgAdapter** (même DB, schema `workflow`), PAS InMemoryWorkflowStorage. Le dev doit matcher la prod pour les workflows.

### 3.2 Override dans defineConfig

```typescript
export default defineConfig({
  database: { url: process.env.DATABASE_URL },
  adapters: {
    cache: { adapter: '@manta/adapter-cache-upstash', options: { url: process.env.UPSTASH_URL } },
  },
})
```

### 3.3 Résolution à l'exécution

**Les defaults prod (§3.1) sont ASPIRATIONNELS — ils ne sont PAS auto-instanciés si le package n'est pas installé.**

```
Pour chaque port :
  1. Si override dans defineConfig().adapters → utiliser
     → Si le package référencé n'est pas installé (require.resolve échoue) :
       "❌ Adapter '@manta/adapter-cache-upstash' not found.
        Run: npm install @manta/adapter-cache-upstash"
       Exit(1)
     → Si le package est installé mais n'exporte pas la classe attendue :
       "❌ Adapter '@manta/adapter-cache-upstash' does not export a valid adapter for ICachePort.
        Expected: a class implementing ICachePort with initialize() and dispose() methods."
       Exit(1)
  2. Sinon → défaut du profil (dev ou prod)
     → En DEV : les defaults sont toujours disponibles (in-memory via @manta/core,
       ou embarqués via @manta/cli pour Pino/Drizzle/Nitro). Aucun package supplémentaire.
     → En PROD : si le package du default prod n'est pas installé et qu'il n'y a pas
       d'override, erreur fatale :
       "❌ No adapter found for ICachePort.
        Default for production: @manta/adapter-cache-upstash (not installed).
        Either install it: npm install @manta/adapter-cache-upstash
        Or configure an alternative in defineConfig().adapters.cache"
       Exit(1)
     → Exception : IDatabasePort, ILoggerPort, IHttpPort sont TOUJOURS disponibles
       (embarqués par @manta/cli : adapter-drizzle-pg, adapter-logger-pino, adapter-nitro).
  3. Instancier l'adapter
     → Si initialize() throw :
       "❌ Adapter 'UpstashCacheAdapter' failed to initialize: [detail]"
       Exit(1)
  4. Enregistrer dans le container en SINGLETON
```

---

## 4. Fichier .env

### 4.1 Variables standard

| Variable | Requis | Description |
|----------|--------|-------------|
| `DATABASE_URL` | Oui | URL PostgreSQL |
| `APP_ENV` | Non | Profil : `dev` ou `prod`. Défaut : déduit de NODE_ENV |
| `LOG_LEVEL` | Non | error, warn, info, debug. Défaut : info |
| `COOKIE_SECRET` | Prod (si sessions actives) | Secret pour signer les cookies de session. Requis seulement si `auth.session.enabled: true` |
| `JWT_SECRET` | Prod | Secret pour signer les JWT. Toujours requis en prod. |
| `PORT` | Non | Port serveur. Défaut : 9000 |

### 4.2 Template .env

```bash
# Database
DATABASE_URL=postgresql://localhost:5432/manta_dev

# Server
PORT=9000

# Auth (required in production)
# JWT_SECRET=
# COOKIE_SECRET=
```

---

## 5. Structure de fichiers attendue

```
project/
├── .env
├── manta.config.ts
├── tsconfig.json
├── drizzle.config.ts           ← config drizzle-kit
├── package.json
├── drizzle/
│   ├── schema/                 ← générés par CLI (SPEC-057f)
│   └── migrations/             ← fichiers SQL
├── .manta/
│   └── manifest/               ← générés par manta build (SPEC-074)
├── static/                     ← fichiers uploadés (LocalFilesystemAdapter)
└── src/
    ├── api/
    │   ├── admin/
    │   │   └── products/
    │   │       └── route.ts    ← export GET, POST, PUT, DELETE
    │   ├── store/
    │   └── auth/
    ├── modules/
    │   └── product/
    │       ├── models/
    │       │   └── product.ts  ← model.define('Product', { ... })
    │       ├── service.ts
    │       └── index.ts        ← Module() export
    ├── subscribers/
    ├── workflows/
    ├── jobs/
    ├── links/
    └── middlewares.ts           ← defineMiddlewares()
```

---

## 6. Lifecycle complet d'un projet

```bash
# 1. Créer le projet
manta init
cd my-project

# 2. Configurer la DB
# Éditer .env : DATABASE_URL=postgresql://localhost:5432/myapp

# 3. Créer la DB
manta db:create

# 4. Développer (auto-migration + serveur)
manta dev

# 5. Gérer les migrations manuellement (CI/prod)
manta db:generate --name add_status_to_products
manta db:migrate

# 6. Voir le diff
manta db:diff

# 7. Exécuter un script
manta exec scripts/seed.ts

# 8. Builder pour la prod
manta build --preset vercel

# 9. Lancer en prod (VPS/Docker uniquement — pas Vercel)
manta start
```

---

## 7. Package @manta/cli

### 7.1 Structure

```
packages/cli/
├── package.json
├── tsconfig.json
├── bin/
│   └── manta.ts              ← #!/usr/bin/env node
└── src/
    ├── index.ts               ← parse argv, dispatch vers la commande
    ├── commands/
    │   ├── dev.ts
    │   ├── start.ts
    │   ├── build.ts
    │   ├── init.ts
    │   ├── exec.ts
    │   └── db/
    │       ├── generate.ts
    │       ├── migrate.ts
    │       ├── rollback.ts
    │       ├── diff.ts
    │       └── create.ts
    ├── config/
    │   ├── load-env.ts        ← dotenv loading
    │   ├── load-config.ts     ← find + import manta.config.ts + mapping vers format interne
    │   └── resolve-adapters.ts ← profil → adapters defaults + overrides
    ├── bootstrap/
    │   └── boot.ts            ← orchestrate les 18 étapes
    └── utils/
        ├── logger.ts          ← CLI logger (pas ILoggerPort — c'est le logger de la CLI)
        ├── spinner.ts         ← loading indicators
        └── prompts.ts         ← interactive prompts (rename detection, etc.)
```

### 7.2 package.json

```json
{
  "name": "@manta/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "manta": "./bin/manta.ts"
  },
  "dependencies": {
    "@manta/core": "workspace:*",
    "@manta/adapter-logger-pino": "workspace:*",
    "@manta/adapter-drizzle-pg": "workspace:*",
    "@manta/adapter-nitro": "workspace:*",
    "dotenv": "^16.4.0",
    "commander": "^12.0.0",
    "chokidar": "^4.0.0"
  }
}
```

### 7.3 Dépendances

La CLI embarque les adapters dev par défaut. Le dev n'installe PAS les adapters séparément :

```
@manta/cli
  → @manta/core
  → @manta/adapter-logger-pino
  → @manta/adapter-drizzle-pg
  → @manta/adapter-nitro
```

Pour la prod avec d'autres adapters :
```bash
npm install @manta/adapter-cache-upstash @manta/adapter-eventbus-vercel-queues
```

---

## 8. Contrats pour les tests

### 8.1 Exit codes

| Code | Signification |
|------|---------------|
| 0 | Succès |
| 1 | Erreur (config manquante, DB non joignable, migration échouée, bug interne) |

### 8.2 Signaux

Toutes les commandes long-running (`dev`, `start`) gèrent **les deux signaux** :
- SIGINT (Ctrl+C) → graceful shutdown
- SIGTERM (orchestrateur, Docker stop) → graceful shutdown

Même handler pour les deux. Timeout 500ms (SPEC-071).

### 8.3 Testabilité

Chaque commande est une **fonction exportable** :

```typescript
// commands/dev.ts
export async function devCommand(options: DevOptions): Promise<void> { ... }
```

Tests :
- **Unitaires** : chaque commande comme fonction, adapters mockés
- **Intégration** : spawn du process `manta` avec PG local, vérifie stdout/stderr/exit code

---

## 9. Commandes reportées en v1

| Commande | Raison du report |
|----------|-----------------|
| `manta plugin` (add/build/develop/publish) | Pas de plugin registry en v1 |
| `manta user` (création admin) | Dépend du module Auth complet |
| `manta migrate-from-medusa` | Migration tool, v2 |
| `manta db:sync-links` | Intégré dans le bootstrap (sync auto des link tables au boot) |
| `manta db:setup` | Remplacé par `manta db:create` + `manta db:migrate` (2 commandes explicites) |
| `manta db:run-scripts` | Remplacé par `manta exec` (plus générique) |

Si un dev tape une commande non disponible :
```
❌ Command 'manta plugin' is not available in v1. Coming soon.
```
