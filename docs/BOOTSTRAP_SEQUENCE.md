# Bootstrap Sequence — Manta Framework
> Document detaille de la sequence de demarrage en 18 etapes (SPEC-074)
> Deux phases : Core Boot (synchrone, chiffres realistes par profil — SPEC-074) + Lazy Boot (on-demand)
> Chaque etape est independamment testable et mockable

---

## Table des matieres

1. [Vue d'ensemble](#1-vue-densemble)
2. [Core Boot — Etapes 1 a 8](#2-core-boot--etapes-1-a-8)
3. [Lazy Boot — Etapes 9 a 18](#3-lazy-boot--etapes-9-a-18)
4. [Gestion des erreurs](#4-gestion-des-erreurs)
5. [Comportement serverless](#5-comportement-serverless)
6. [Manifeste pre-build](#6-manifeste-pre-build)
7. [Diagramme de sequence](#7-diagramme-de-sequence)
8. [Tester le bootstrap](#8-tester-le-bootstrap)

---

## 1. Vue d'ensemble

Le bootstrap Manta est concu pour le serverless. Il se decompose en deux phases distinctes :

| Phase | Etapes | Bloquant ? | Cible perf | Declencheur |
|-------|--------|------------|------------|-------------|
| **Core Boot** | 1 → 8 | Oui — bloque la premiere requete | < 10ms in-memory, < 50ms PG local, < 200ms Neon (guidelines, PAS contrat — SPEC-074) | Import du module / cold start |
| **Lazy Boot** | 9 → 18 | Oui — `await lazyBootPromise` | < 500ms total (core + lazy) | Premiere requete HTTP / queue / cron |

**Principe fondamental** : le Core Boot met en place le strict minimum pour accepter une requete. Le Lazy Boot charge tout le reste on-demand. Aucune requete n'est servie avec un boot partiel.

**Migrations** : completement decouplees du boot. Commande CLI dediee `manta db:migrate`. Jamais executees au cold start. **Exception unique** : `autoMigrate` (SPEC-135) s'execute entre l'etape 8 et 9 en mode dev uniquement — c'est la seule derogation au principe de decouplage, strictement interdite en prod.

**Invariant** : a la fin de l'etape 18, le framework est dans un etat 100% operationnel. Tout subscriber enregistre (y compris ceux de `onApplicationStart`) recevra les events emis pendant le boot.

---

## 2. Core Boot -- Etapes 1 a 8

Le Core Boot est **synchrone** et s'execute au moment de l'import du module principal (cold start). Il ne fait aucun I/O reseau lent — uniquement config, instanciation, et enregistrement.

---

### Etape 1 : Charger la configuration

**Entree** :
- Fichier `manta.config.ts` (ou `manta.config.js`)
- Variables d'environnement (prioritaires sur le fichier)
- `APP_ENV` (detection du profil) avec fallback `NODE_ENV`

**Operations** :
1. Charger `defineConfig()` depuis le fichier de configuration
2. Detecter le profil actif : `APP_ENV` → si absent, fallback sur `NODE_ENV` → si absent, `"development"`
3. Deux profils : `dev` et `prod` (mapping : development/test → dev, production/staging → prod)
4. Merger les env vars `MANTA_*` par-dessus la config fichier (env vars prioritaires — serverless-friendly)
5. Valider les secrets requis : erreur fatale en prod si manquants, warning en dev (SPEC-053)
6. Instancier `ConfigManager` singleton

**Sortie** : `ConfigManager` singleton avec config validee et resolue

**Erreur** :
- Config fichier introuvable → `MantaError(NOT_FOUND, 'Configuration file not found')`
- Secret manquant en prod → `MantaError(INVALID_DATA, 'Missing required secret: <key>')`
- Schema invalide → `MantaError(INVALID_DATA, 'Config validation failed: <details>')`

**Duree cible** : < 5ms (lecture fichier + merge)

---

### Etape 2 : Initialiser les feature flags

**Entree** : `ConfigManager` (etape 1)

**Operations** :
1. Instancier `FlagRouter`
2. Charger les flags dans l'ordre de priorite (SPEC-055) :
   - Priorite 1 : env vars `MANTA_FF_*` (ex: `MANTA_FF_RBAC=true`)
   - Priorite 2 : `projectConfig.featureFlags` depuis `defineConfig()`
   - Priorite 3 : defaults du framework
3. Supporte les flags nested (ex: `rbac.filter_fields`)

**Sortie** : `FlagRouter` singleton avec methodes `isFeatureEnabled()`, `setFlag()`, `listFlags()`

**Erreur** : aucune erreur fatale possible. Flags invalides sont ignores avec warning.

**Duree cible** : < 1ms

---

### Etape 3 : Creer le container DI

**Entree** : rien (factory pure)

**Operations** :
1. Appeler `createMedusaContainer()` (SPEC-129) — factory Awilix avec methodes custom
2. Le container supporte : `resolve<T>()`, `register()`, `createScope()`, `registerAdd()`, `aliasTo()`, `dispose()`
3. Configurer `AsyncLocalStorage` pour la detection de scope (SPEC-001)
4. Enregistrer `ConfigManager` sous `ContainerRegistrationKeys.CONFIG_MODULE`
5. Enregistrer `FlagRouter` sous `ContainerRegistrationKeys.FEATURE_FLAG_ROUTER`

**Sortie** : `IContainer` global singleton, pret pour les enregistrements

**Erreur** :
- Echec creation container → erreur fatale, le framework ne peut pas demarrer

**Duree cible** : < 2ms

---

### Etape 4 : Initialiser le logger

**Entree** : `IContainer` (etape 3), `ConfigManager` (etape 1)

**Operations** :
1. Instancier l'adapter logger configure (defaut : Pino)
2. Profil dev → Pino pretty print. Profil prod → Pino JSON structuire.
3. Appliquer `LOG_LEVEL` depuis env var ou config
4. Enregistrer sous `ContainerRegistrationKeys.LOGGER` en SINGLETON

**Sortie** : `ILoggerPort` disponible dans le container

**Erreur** :
- Logger custom invalide → fallback sur `console.*` avec warning stderr

**Duree cible** : < 2ms

**A partir de cette etape** : toutes les erreurs sont loguees via `ILoggerPort`.

---

### Etape 5 : Etablir la connexion DB

**Entree** : `IContainer` (etape 3), `ConfigManager` (etape 1)

**Operations** :
1. Instancier l'adapter database configure (ex: `DrizzlePgAdapter`)
2. Configurer le pool de connexions :
   - Dev : `min: 2, max: 10`
   - Serverless (prod) : `min: 0, max: 5` — le `min: 0` est critique pour serverless (pas de connexion idle)
3. Etablir la connexion initiale (validate avec un `SELECT 1`)
4. Enregistrer sous `ContainerRegistrationKeys.DB_CONNECTION` en SINGLETON

**Sortie** : `IDatabasePort` disponible dans le container, pool initialise

**Erreur** :
- Connexion echouee → `MantaError(UNEXPECTED_STATE, 'Database connection failed: <detail>')`
- Erreur fatale — le framework ne peut pas demarrer sans DB

**Duree cible** : < 20ms (connexion locale), < 50ms (Neon serverless driver)

**Note** : si la connexion prend trop longtemps, c'est le bottleneck principal du core boot. En serverless, utiliser le driver Neon HTTP (pas WebSocket) pour minimiser le round-trip.

---

### Etape 6 : Charger les modules requis (EVENT_BUS + CACHE)

**Entree** : `IContainer` (etape 3), `IDatabasePort` (etape 5), `ConfigManager` (etape 1)

**Operations** :
1. Charger le module `EVENT_BUS` : instancier l'adapter configure (InMemoryEventBusAdapter ou VercelQueueAdapter)
2. Enregistrer `IEventBusPort` dans le container en SINGLETON
3. Charger le module `CACHE` : instancier l'adapter configure (InMemoryCacheAdapter ou UpstashCacheAdapter)
4. Enregistrer `ICachePort` dans le container en SINGLETON
5. Ces deux modules sont **obligatoires** — le framework ne fonctionne pas sans eux

**Sortie** : `IEventBusPort` et `ICachePort` disponibles dans le container

**Erreur** :
- Module EVENT_BUS ou CACHE introuvable/echoue → erreur fatale
- `MantaError(UNEXPECTED_STATE, 'Required module <name> failed to load: <detail>')`

**Duree cible** : < 5ms (in-memory), < 15ms (Upstash/Vercel Queues — round-trip reseau)

---

### Etape 7 : Enregistrer le buffer d'events

**Entree** : `IEventBusPort` (etape 6)

**Operations** :
1. Activer le mode buffer sur `IEventBusPort` :
   - `subscribe()` fonctionne normalement — les subscribers peuvent s'enregistrer
   - `emit()` est **intercepte et buffered** — les events sont stockes en memoire dans l'ordre d'emission
2. Le buffer est une queue FIFO interne au bus
3. Le TTL du buffer est de 600s par defaut (configurable) — protection contre les fuites memoire si le lazy boot ne complete jamais

**Sortie** : `IEventBusPort` en mode buffer. Tout `emit()` est capture, rien n'est publie.

**Erreur** : aucune erreur possible (operation purement in-memory)

**Duree cible** : < 1ms

**Contrat critique** : les events emis pendant le boot (etapes 8-17) ne sont PAS perdus. Ils seront publies dans l'ordre a l'etape 18.

---

### Etape 8 : Enregistrer les routes API

**Entree** : `ConfigManager` (etape 1), manifest pre-build ou filesystem

**Operations** :
1. **Si manifest existe** (`routes.json` genere par `manta build`) :
   - Charger les routes depuis le manifeste. Zero scan filesystem.
2. **Sinon** (dev ou premier run) :
   - Scanner le filesystem : `src/api/**/*.ts` (convention)
   - Decouvrir les routes (GET, POST, PUT, DELETE handlers)
   - Decouvrir les middlewares (`defineMiddlewares()`)
3. Enregistrer toutes les routes dans le routeur HTTP (l'adapter `IHttpPort`)
4. Le pipeline middleware est configure pour chaque route (12 etapes, SPEC-037/SPEC-039b) :
   RequestID → CORS → RateLimit → Scope → BodyParser → Auth → PublishableKey → Validation → Custom → RBAC → Handler → ErrorHandler

**Sortie** : routeur HTTP pret a dispatcher les requetes

**Erreur** :
- Route invalide (handler manquant) → warning log, route ignoree
- Middleware invalide → `MantaError(INVALID_DATA, 'Invalid middleware: <detail>')`

**Duree cible** : < 5ms (manifest), < 20ms (filesystem scan)

---

**Fin du Core Boot.** Le framework peut maintenant accepter des requetes HTTP. Si le Lazy Boot n'a pas encore complete, les requetes sont mises en attente via `await lazyBootPromise`.

---

## 3. Lazy Boot -- Etapes 9 a 18

Le Lazy Boot est declenche par la premiere requete (HTTP, queue, ou cron). Il s'execute **une seule fois** — les requetes suivantes reutilisent le resultat. Pendant le Lazy Boot, toutes les requetes entrantes sont en attente sur `lazyBootPromise`.

**Timeout** : 30s par defaut, configurable via `defineConfig({ boot: { lazyBootTimeoutMs: 30000 } })`.

---

### Etape 9 : Charger tous les modules restants

**Entree** : `IContainer`, `ConfigManager`, manifest ou config modules

**Operations** :
1. Lire la liste des modules a charger (depuis manifest `modules.json` ou depuis config)
2. Exclure EVENT_BUS et CACHE (deja charges a l'etape 6)
3. Exclure les modules avec `disable: true` (SPEC-016)
4. Pour chaque module actif, appeler `IModuleLoader.bootstrap()` :
   - Instancier le module service
   - Enregistrer le module service dans le container en SINGLETON
   - Initialiser les repositories du module
5. Les modules internes (scope: internal) sont charges in-process
6. Les modules externes (scope: external) sont configures avec leur URL (SPEC-007)

**Sortie** : tous les module services enregistres dans le container

**Erreur** :
- Module individuel echoue → `ILoggerPort.error()` avec detail. Le boot continue si le module n'est pas critique.
- Si un module requis par un autre echoue → cascade d'erreurs, lazy boot echoue

**Duree cible** : < 100ms (selon nombre de modules)

---

### Etape 10 : Enregistrer QUERY, LINK, REMOTE_LINK

**Entree** : `IContainer` avec tous les modules charges (etape 9)

**Operations** :
1. Instancier le service `Query` — couche d'interrogation cross-module (SPEC-010)
2. Instancier le service `Link` — gestion des liens entre modules (SPEC-011)
3. Instancier le service `RemoteLink` — liens vers modules externes
4. Enregistrer sous `ContainerRegistrationKeys.QUERY`, `ContainerRegistrationKeys.LINK`, `ContainerRegistrationKeys.REMOTE_LINK`

**Sortie** : `Query`, `Link`, `RemoteLink` disponibles dans le container

**Erreur** :
- Echec → `MantaError(UNEXPECTED_STATE, 'Failed to register query/link services')`

**Duree cible** : < 5ms

---

### Etape 11 : Charger les modules de liens (defineLink)

**Entree** : `IContainer`, `IDatabasePort`, modules charges (etape 9)

**Operations** :
1. Decouvrir tous les `defineLink()` declares (depuis manifest `links.json` ou filesystem scan)
2. Pour chaque lien :
   - Creer la table de jointure Drizzle-compatible (SPEC-012)
   - Enregistrer le link module dans le container
3. Les joiner configs sont generes automatiquement (SPEC-128)

**Sortie** : toutes les tables de liens enregistrees, le graph de relations est complet

**Erreur** :
- Link entre modules inexistants → `MantaError(INVALID_DATA, 'Link references unknown module: <name>')`
- Table de jointure deja existante → skip silencieux (idempotent)

**Duree cible** : < 10ms

---

### Etape 12 : Charger les workflows

**Entree** : `IContainer`, manifest ou filesystem

**Operations** :
1. Decouvrir tous les workflows (depuis manifest `workflows.json` ou `src/workflows/**/*.ts`)
2. Pour chaque workflow, appeler `WorkflowManager.register(workflowId, flow, handlers, options)` (SPEC-130)
3. Les workflows sont enregistres globalement dans le `WorkflowManager` singleton

**Sortie** : tous les workflows enregistres et prets a etre executes

**Erreur** :
- Workflow avec ID duplique → `MantaError(INVALID_DATA, 'Duplicate workflow ID: <id>')`
- Workflow invalide (step sans handler) → warning log, workflow ignore

**Duree cible** : < 10ms

---

### Etape 13 : Charger les subscribers

**Entree** : `IEventBusPort` (etape 6), `IContainer`, manifest ou filesystem

**Operations** :
1. Decouvrir tous les subscribers (depuis manifest `subscribers.json` ou `src/subscribers/**/*.ts`)
2. Pour chaque subscriber :
   - Resoudre les dependances depuis le container
   - Appeler `IEventBusPort.subscribe(eventName, handler, options)`
3. Si `makeIdempotent()` n'est pas utilise sur un subscriber en mode at-least-once → warning log (SPEC-034)

**Sortie** : tous les subscribers enregistres dans le bus. Ils recevront les events des l'etape 18.

**Erreur** :
- Subscriber invalide (event name manquant) → warning log, subscriber ignore
- Subscriber avec dependance non resolue → `MantaError(NOT_FOUND, 'Cannot resolve <dep> for subscriber <name>')`

**Duree cible** : < 5ms

---

### Etape 14 : Charger les policies RBAC

**Entree** : `FlagRouter` (etape 2), `IContainer`, manifest ou filesystem

**Operations** :
1. Verifier si le feature flag `rbac` est actif via `FlagRouter.isFeatureEnabled('rbac')`
2. **Si actif** :
   - Decouvrir tous les `definePolicies()` (SPEC-051)
   - Enregistrer les policies dans le systeme RBAC
   - Cacher les policies via `ICachePort`
3. **Si inactif** :
   - Skip. L'etape RBAC du middleware pipeline (etape 9/11) reste un no-op.

**Sortie** : policies RBAC chargees et cachees (si flag actif)

**Erreur** :
- Policy invalide → warning log, policy ignoree
- Aucune erreur fatale — RBAC est optionnel

**Duree cible** : < 5ms

---

### Etape 15 : Charger les jobs planifies

**Entree** : `ConfigManager` (triggers), `IContainer`, manifest ou filesystem

**Operations** :
1. Verifier si le trigger `cron` est actif dans la config (`triggers.cron: true`)
2. **Si actif** :
   - Decouvrir tous les jobs planifies (depuis manifest `jobs.json` ou `src/jobs/**/*.ts`)
   - Pour chaque job, enregistrer dans `IJobSchedulerPort` (SPEC-063)
   - Chaque job declare : `schedule` (cron expression), `handler`, `options` (retry, concurrency)
   - Le `IJobSchedulerPort` a une dependance explicite sur `ILockingPort` pour le concurrency control
3. **Si inactif** :
   - Skip. Les jobs ne sont pas charges.

**Sortie** : jobs planifies enregistres dans le scheduler

**Erreur** :
- Cron expression invalide → `MantaError(INVALID_DATA, 'Invalid cron expression: <expr>')`
- Job avec ID duplique → warning log, deuxieme ignore

**Duree cible** : < 5ms

---

### Etape 16 : Appeler onApplicationStart sur tous les modules

**Entree** : `IContainer` avec tous les modules charges

**Operations** :
1. Pour chaque module charge qui definit `__hooks.onApplicationStart` (SPEC-005) :
   - Appeler le hook avec le container en parametre
   - Les hooks peuvent enregistrer des subscribers supplementaires
   - Les hooks peuvent emettre des events (qui seront buffered — pas encore publies)
2. Ordre d'appel : dans l'ordre de chargement des modules (deterministe)

**Sortie** : tous les hooks `onApplicationStart` appeles

**Erreur** :
- Hook echoue → `ILoggerPort.error()`. Ne bloque pas le boot des autres modules.
- Exception dans un hook → catch, log, continue

**Duree cible** : < 50ms (depend des hooks metier)

---

### Etape 17 : Synchroniser les settings de traduction

**Entree** : `FlagRouter`, `IContainer`

**Operations** :
1. Verifier si le feature flag `translation` est actif (SPEC-105-T8)
2. **Si actif** :
   - Charger les settings de traduction (locales supportees, locale par defaut)
   - Synchroniser avec le module Translation
3. **Si inactif** :
   - Skip. `applyTranslations()` reste un no-op partout.

**Sortie** : module Translation synchronise (si actif)

**Erreur** :
- Echec sync → warning log. Le module fonctionne avec les settings par defaut.
- Aucune erreur fatale.

**Duree cible** : < 5ms

---

### Etape 18 : Liberer le buffer d'events

**Entree** : `IEventBusPort` en mode buffer (depuis etape 7)

**Operations** :
1. Desactiver le mode buffer sur `IEventBusPort`
2. Publier tous les events buffered dans l'ordre FIFO d'emission
3. A partir de maintenant, `emit()` publie immediatement (comportement normal)
4. Resoudre `lazyBootPromise` — toutes les requetes en attente sont debloquees

**Sortie** : bus d'events en mode normal. Framework 100% operationnel.

**Erreur** :
- Echec de publication d'un event buffered → `ILoggerPort.error()`, continue avec les events suivants
- Un event ne bloque pas la publication des autres

**Duree cible** : < 5ms (depend du nombre d'events buffered)

**Garantie** : tout subscriber enregistre avant cette etape (y compris ceux enregistres dans `onApplicationStart`) recevra les events. Aucun event n'est perdu.

---

## 4. Gestion des erreurs

### Erreurs fatales (Core Boot)

Les erreurs fatales arretent le boot completement. Le framework ne demarre pas.

| Etape | Cause | Erreur |
|-------|-------|--------|
| 1 | Config introuvable | `MantaError(NOT_FOUND)` |
| 1 | Secret manquant en prod | `MantaError(INVALID_DATA)` |
| 3 | Container creation echouee | Erreur fatale runtime |
| 5 | DB connexion echouee | `MantaError(UNEXPECTED_STATE)` |
| 6 | Module EVENT_BUS ou CACHE echoue | `MantaError(UNEXPECTED_STATE)` |

### Erreurs recuperables (Lazy Boot)

Les erreurs du Lazy Boot ne sont PAS fatales pour le framework. Elles retournent 503 et le prochain appel retente.

| Scenario | Comportement |
|----------|-------------|
| Module non-critique echoue | Log error, boot continue sans ce module |
| Module critique echoue (dependance) | Cascade, lazy boot echoue |
| Timeout (30s defaut) | `MantaError(UNEXPECTED_STATE, 'Lazy boot timed out after <N>ms')` |
| N'importe quelle erreur | HTTP 503 Service Unavailable |
| Requete suivante | Retente le lazy boot (pas de cache de l'echec) |

### Comportement retry

```
Requete 1 arrive → declenche lazy boot → timeout/erreur → 503
Requete 2 arrive → retente lazy boot (fresh) → succes → 200
```

Le framework ne cache **jamais** un echec de lazy boot. Chaque nouvelle requete est une nouvelle tentative. Ceci permet la recovery automatique si l'echec etait transitoire (ex: DB lente au premier cold start).

### Logging

Toute erreur pendant le boot est loguee via `ILoggerPort.error()` avec :
- Etape du boot ou l'erreur s'est produite
- Message d'erreur complet
- Stack trace
- Temps ecoule depuis le debut du boot

---

## 5. Comportement serverless

### Cold start (premiere invocation)

```
Lambda/Vercel Function cree →
  Core Boot (etapes 1-8, < 50ms) →
  Premiere requete arrive →
  Lazy Boot (etapes 9-18, < 450ms) →
  Requete servie
```

Le cold start complet est Core Boot + Lazy Boot. Cible : < 500ms total.

### Warm invocation (invocations suivantes)

```
Requete arrive →
  Container global reutilise (SINGLETON persistent) →
  Nouveau scope cree via createScope() + AsyncLocalStorage.run() →
  SCOPED services recrees pour cette requete →
  Requete servie →
  Scope dispose
```

| Lifetime | Comportement warm | Notes |
|----------|-------------------|-------|
| SINGLETON | Persiste entre invocations | Module services, repositories, config |
| SCOPED | Recree a chaque requete | Message aggregator, contexte requete |
| TRANSIENT | Recree a chaque resolve() | Factories, builders |

### dispose()

`container.dispose()` n'est **jamais** appele en serverless. Les adapters doivent etre concus pour tolerer l'absence de cleanup. Le nettoyage repose sur :
- TTL pour le cache (cles expirent naturellement)
- Connection poolers cote infra (Neon, PgBouncer)
- Timeout des locks (TTL sur les advisory locks)

### SIGTERM

Certains runtimes serverless envoient `SIGTERM` avant le freeze (AWS Lambda). Le framework peut optionnellement ecouter ce signal pour un best-effort cleanup, mais ne DOIT PAS compter dessus. C'est un hint, pas une garantie.

### Secrets

Les secrets sont charges **une seule fois** au cold start (etape 1). Pas de rotation a chaud. C'est le comportement standard en serverless — pour rotater un secret, il faut forcer un nouveau cold start (redeploy ou invalider le cache Lambda/Vercel).

---

## 6. Manifeste pre-build

### Commande : `manta build`

La commande `manta build` genere un manifeste statique qui elimine tout scan filesystem au runtime. Elle etend le pattern de build Nitro.

### Fichiers generes

```
.manta/
  manifest/
    routes.json        — toutes les routes API avec leurs middlewares
    subscribers.json   — tous les subscribers avec leurs events
    jobs.json          — tous les jobs planifies avec leurs cron expressions
    modules.json       — tous les modules actifs avec leur config
    links.json         — tous les defineLink() avec leurs tables
    workflows.json     — tous les workflows avec leurs IDs
```

### Format type (routes.json)

```json
{
  "version": 1,
  "generatedAt": "2026-03-09T12:00:00Z",
  "routes": [
    {
      "method": "GET",
      "path": "/store/products",
      "handler": "./src/api/store/products/route.ts#GET",
      "middlewares": ["auth:optional", "publishable-key:required"],
      "validation": {
        "query": "./src/api/store/products/validators.ts#GetProductsQuery"
      }
    }
  ]
}
```

### Comportement runtime

| Mode | Comportement |
|------|-------------|
| Manifest present | Charger depuis `.manta/manifest/`. Zero scan FS. |
| Manifest absent | Scanner le filesystem (`src/api/`, `src/subscribers/`, etc.) |
| Dev mode | Toujours scanner le FS (hot reload necessaire) |

### Avantages serverless

- Elimination du scan filesystem → cold start plus rapide
- Determinisme : le manifest est genere au build, pas au runtime
- Verifiable : le manifest peut etre commite et review en PR

---

## 7. Diagramme de sequence

```
                    CORE BOOT (< 50ms, synchrone)
    ================================================================

    [1] defineConfig()
     |  APP_ENV → profil dev/prod
     |  Merge env vars MANTA_*
     |  Valider secrets
     v
    [2] FlagRouter
     |  MANTA_FF_* > config > defaults
     v
    [3] createMedusaContainer()
     |  Awilix + AsyncLocalStorage
     |  Register CONFIG_MODULE, FEATURE_FLAG_ROUTER
     v
    [4] ILoggerPort
     |  Pino pretty (dev) / JSON (prod)
     |  Register LOGGER
     v
    [5] IDatabasePort
     |  Pool: min=0 (serverless), max=5
     |  SELECT 1 → validate
     |  Register DB_CONNECTION
     v
    [6] IEventBusPort + ICachePort
     |  Modules OBLIGATOIRES
     |  Register dans container
     v
    [7] Event Buffer ON
     |  subscribe() = OK
     |  emit() = BUFFERED (FIFO, TTL 600s)
     v
    [8] Routes API
     |  Manifest → load JSON
     |  Sinon → scan src/api/**/*.ts
     |  Pipeline middleware 12 etapes

    ================================================================
         CORE BOOT TERMINE — le serveur accepte les requetes
    ================================================================

    Requete arrive → await lazyBootPromise
                          |
                    LAZY BOOT (on-demand, timeout 30s)
    ================================================================

    [9]  Modules restants
     |   IModuleLoader.bootstrap() pour chaque module actif
     |   Register en SINGLETON
     v
    [10] QUERY + LINK + REMOTE_LINK
     |   Services cross-module
     |   Register dans container
     v
    [11] Link modules (defineLink)
     |   Tables de jointure Drizzle
     |   Graph de relations complet
     v
    [12] Workflows
     |   WorkflowManager.register()
     |   Manifest ou src/workflows/**/*.ts
     v
    [13] Subscribers
     |   IEventBusPort.subscribe()
     |   Manifest ou src/subscribers/**/*.ts
     |   Warning si pas makeIdempotent()
     v
    [14] RBAC policies (si flag actif)
     |   definePolicies()
     |   Cache via ICachePort
     |   Si flag off → skip (no-op middleware)
     v
    [15] Jobs planifies (si triggers.cron=true)
     |   IJobSchedulerPort.register()
     |   Manifest ou src/jobs/**/*.ts
     |   Dependance ILockingPort pour concurrency
     v
    [16] onApplicationStart hooks
     |   Appel sequentiel sur chaque module
     |   Peut subscribe + emit (buffered)
     v
    [17] Translation sync (si flag actif)
     |   Locales, defaut locale
     |   Si flag off → skip (applyTranslations = no-op)
     v
    [18] EVENT BUFFER RELEASE
         Publish tous les events buffered (FIFO)
         emit() = mode normal
         lazyBootPromise.resolve()

    ================================================================
         FRAMEWORK 100% OPERATIONNEL
    ================================================================
```

---

## 8. Tester le bootstrap

### 8.1. Tests unitaires — chaque etape independamment

Chaque etape est implementee comme une fonction pure ou quasi-pure, avec des dependances injectees :

```typescript
// Exemple : tester l'etape 1 en isolation
import { loadConfig } from '@manta/core/bootstrap'

test('step 1: loads config and detects dev profile', () => {
  process.env.APP_ENV = 'development'
  const config = loadConfig('./fixtures/manta.config.ts')
  expect(config.profile).toBe('dev')
})

test('step 1: env vars override file config', () => {
  process.env.MANTA_DB_URL = 'postgres://override'
  const config = loadConfig('./fixtures/manta.config.ts')
  expect(config.database.url).toBe('postgres://override')
})

test('step 1: throws on missing secret in prod', () => {
  process.env.APP_ENV = 'production'
  expect(() => loadConfig('./fixtures/manta.config.no-secrets.ts'))
    .toThrow('Missing required secret')
})
```

### 8.2. Test d'integration — boot complet avec adapters in-memory

```typescript
import { bootstrap } from '@manta/core'
import { createTestConfig } from '@manta/testing'

test('full bootstrap completes with in-memory adapters', async () => {
  const config = createTestConfig({
    modules: {
      eventBus: { adapter: 'in-memory' },
      cache: { adapter: 'in-memory' },
      database: { adapter: 'drizzle-pg', url: process.env.TEST_DB_URL },
    },
  })

  const { container, lazyBootPromise } = await coreboot(config)

  // Core boot complete
  expect(container.resolve('logger')).toBeDefined()
  expect(container.resolve('eventBusService')).toBeDefined()
  expect(container.resolve('cacheService')).toBeDefined()

  // Trigger lazy boot
  await lazyBootPromise

  // Lazy boot complete
  expect(container.resolve('query')).toBeDefined()
  expect(container.resolve('link')).toBeDefined()
})
```

### 8.3. Benchmark cold start

```typescript
import { bootstrap } from '@manta/core'

test('cold start performance: core boot < 50ms', async () => {
  const start = performance.now()
  const { container } = await coreBoot(testConfig)
  const coreBootTime = performance.now() - start

  expect(coreBootTime).toBeLessThan(50)
  console.log(`Core boot: ${coreBootTime.toFixed(1)}ms`)
})

test('cold start performance: total boot < 500ms', async () => {
  const start = performance.now()
  const { container, lazyBootPromise } = await coreBoot(testConfig)
  await lazyBootPromise
  const totalBootTime = performance.now() - start

  expect(totalBootTime).toBeLessThan(500)
  console.log(`Total boot: ${totalBootTime.toFixed(1)}ms`)
})
```

### 8.4. Test du buffer d'events

```typescript
import { bootstrap } from '@manta/core'
import { createTestConfig, withScope } from '@manta/testing'

test('events emitted during boot are delivered after step 18', async () => {
  const receivedEvents: string[] = []

  const config = createTestConfig({
    modules: {
      myModule: {
        hooks: {
          onApplicationStart: async (container) => {
            const eventBus = container.resolve('eventBusService')
            // Cet emit sera buffered (on est entre etapes 7 et 18)
            await eventBus.emit('test.boot-event', { data: 'hello' })
          },
        },
      },
    },
  })

  const { container, lazyBootPromise } = await coreBoot(config)

  // Enregistrer un subscriber AVANT le lazy boot
  const eventBus = container.resolve('eventBusService')
  eventBus.subscribe('test.boot-event', (data) => {
    receivedEvents.push(data.data)
  })

  // Aucun event recu avant le release
  expect(receivedEvents).toHaveLength(0)

  // Trigger lazy boot → inclut le release du buffer
  await lazyBootPromise

  // Maintenant l'event est recu
  expect(receivedEvents).toEqual(['hello'])
})
```

### 8.5. Test du timeout lazy boot

```typescript
test('lazy boot timeout returns 503', async () => {
  const config = createTestConfig({
    boot: { lazyBootTimeoutMs: 100 }, // 100ms pour le test
    modules: {
      slowModule: {
        bootstrap: () => new Promise((resolve) => setTimeout(resolve, 5000)),
      },
    },
  })

  const { lazyBootPromise } = await coreBoot(config)

  await expect(lazyBootPromise).rejects.toThrow('Lazy boot timed out')
})
```

### 8.6. Test retry apres echec

```typescript
test('lazy boot retries on next request after failure', async () => {
  let attempt = 0

  const config = createTestConfig({
    modules: {
      flakyModule: {
        bootstrap: async () => {
          attempt++
          if (attempt === 1) throw new Error('DB was slow')
          // Deuxieme tentative reussit
        },
      },
    },
  })

  // Premier essai : echec
  const { lazyBootPromise: first } = await coreBoot(config)
  await expect(first).rejects.toThrow('DB was slow')

  // Deuxieme essai : succes (retry fresh)
  const { lazyBootPromise: second } = await coreBoot(config)
  await expect(second).resolves.not.toThrow()
  expect(attempt).toBe(2)
})
```

---

## Annexe : Reference croisee SPEC

| Etape | SPECs impliquees |
|-------|-----------------|
| 1 | SPEC-053 (ConfigManager), SPEC-054 (env vars), SPEC-055 (feature flags) |
| 2 | SPEC-055 (FlagRouter) |
| 3 | SPEC-001 (IContainer), SPEC-002 (ContainerRegistrationKeys), SPEC-129 (createMedusaContainer) |
| 4 | SPEC-067 (ILoggerPort), SPEC-082/083 (Logger config) |
| 5 | SPEC-056 (IDatabasePort) |
| 6 | SPEC-034 (IEventBusPort), SPEC-064/077 (ICachePort) |
| 7 | SPEC-074 (event buffer) |
| 8 | SPEC-037 (HTTP pipeline), SPEC-043 (middlewares), SPEC-100 (build) |
| 9 | SPEC-004/006 (modules, IModuleLoader), SPEC-016 (disable) |
| 10 | SPEC-010 (Query), SPEC-011 (Link) |
| 11 | SPEC-012 (defineLink), SPEC-128 (joiner configs) |
| 12 | SPEC-019 (workflows), SPEC-130 (WorkflowManager) |
| 13 | SPEC-034/036 (subscribers), SPEC-074 (buffer) |
| 14 | SPEC-051 (RBAC) |
| 15 | SPEC-063/091/092 (jobs), SPEC-066 (ILockingPort) |
| 16 | SPEC-005 (onApplicationStart) |
| 17 | SPEC-105-T/T8 (Translation) |
| 18 | SPEC-074 (buffer release) |
