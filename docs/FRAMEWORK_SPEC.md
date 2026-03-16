# Framework Spec -- Ports & Contracts
> Framework backend TypeScript agnostique, inspire de Medusa V2
> Architecture hexagonale : Ports (interfaces) / Adapters (implementations)
> 155+ features | Confiance globale : 100% | Couverture : modules + features + contrats de ports verifies exhaustivement + generateur DML (23 tests unitaires), propagation auth (cascade e2e), db:diff, dispose serverless (active scopes + MantaError apres dispose), upsertWithReplace, conflits plugins, pagination relations (comptage iteratif), AuthContext/Context/StepExecutionContext/Message<T> types definis, transaction Drizzle inter-services, translation T3/T4 exclusion mutuelle, queue trigger subscriber retry/DLQ (ordre d'appel specifie), defineLink tree-shaking (test build + plugin discovery statique), Query.graph() seuil dur 10k entites (fail-fast) + timeout modules externes + withDeleted propagation externe + withDeleted compte dans seuil + beforeFetch hook + OAuth state/PKCE/CSRF, checkpoint recovery apres crash, RelationPagination type, clearGroupedEvents staging/commit, enum numerique filtre, dispose drain, PluginConfig type, IJobSchedulerPort 3 deps explicites + AuthContext cron (J-10), healthcheck /live /ready, module versioning + autoMigrate timing explicite, multi-tenant hooks + createTestContext helper, strict mode testing, migration testing (convention .down.sql) + rename detection, MantaErrorResponse format HTTP, IMessageAggregator SCOPED (8 tests), thundering herd documente + retry backoff, bootstrap perf=chiffres realistes par profil, softDelete withDeleted propagation FK directes + links + modules externes, ALS scope activation contrat explicite + self-test boot + scope lifecycle fin normale (CT-17), subscriber→workflow transactionId derive (template string deterministe) + fallback idempotencyKey absent, compensation failure parallel rollback, DML re-generation delegation drizzle-kit, rate limiting ICachePort pipeline 12 etapes, cursor-based pagination (v1 non-nullable only), multipart upload + dependance presigned URLs, grouped events observabilite hooks + assertions temporelles e2e-only + TTL in-memory obligatoire, cookie session contrat (IAuthModuleService), plugin path resolution ESM/CJS formalise, OpenTelemetry W3C TraceContext inter-modules, secrets rotation limitation documentee, module loader idempotence, Conformance Suite versioning, circuit breaker beforeFetch hook, IWorkflowStoragePort interface formalisee (save/load/list/delete), @EmitEvents mecanisme explicite (save() par logique metier pas auto-detection), IAuthGateway Bearer sk_ prefix check contractualise (AG-12/AG-13), IWorkflowEnginePort.subscribe contrat + tests (W-16/W-19), permanentSubscriberFailure seule voie permanente (pas MantaError direct), Context hors pipeline (manta exec) documente + scope ALS + AuthContext system/cli + events clears en --dry-run, event payload size inclut metadata, job history schema workflow.job_executions, createService() payload convention { id } only + eventBuilderFactory mapping explicite, subscribe() timing notification apres checkpoint persistance, withDeleted+RelationPagination orthogonaux, TRANSIENT non-tracked par container (CT-18), db:diff table absente=CREATE table extra=NOTIFY (M-15/M-16), session AuthContext serialisation JSON-safe constraint, DLQ grouped events = standalone re-processing, @EmitEvents lifecycle clarifie (no-op succes + pipeline publie + transition MA→EB documentee), IWorkflowStoragePort transactionId vs workflowId explicite (nested workflows), softDelete retour Record<string,string[]> teste (R-15/R-16/R-17), IAuthGateway rejet definitif Bearer invalide (AG-10 clarifie + AG-14), grouped events maxActiveGroups limite serverless warm (E-13), T3/T4 conditions cumulatives explicites (filtre+locale), --dry-run isolation READ COMMITTED inter-process documentee, DML Generator→drizzle-kit interface fichiers .ts explicite, createService() SPEC-058-OVERRIDE sous-classe canonique (CS-01), autoMigrate exception unique au decouplage boot/migrations, ALS middlewares custom warning setTimeout/setImmediate, nested workflows WS-11 transactionIds distincts, plugin resolution tests PL-01→PL-05, rate limiting algorithme=detail adapter (test contrat externe uniquement), E-04 reformule (FIFO events pas FIFO handlers), beforeFetch hook tests (3 scenarios: short-circuit/normal/throw), eventBuilderFactory regle nommage explicite (model.define name lowercased), R-18 transaction inter-services rollback, R-19 cursor pagination traversal complet, E-14 serialisation JSON validation, CT-15 mecanisme simulation clarifie (deferred gate), SPEC-052b ICachePort-down behavior par consommateur (fail-open/fail-closed), DEGRADED module recovery (POST /health/recheck + redeploy), IEventBusPort serialisation JSON validation (symetrique WS-09), --dry-run + workflows limitation documentee (workflow events non rollback), reloadSingleModule idempotence contrat (ML-01), Query.gql() erreur explicite NOT_IMPLEMENTED (QG-01), bootstrap pipeline corrige 11→12 etapes

---

## Resume executif

Ce document decrit un framework backend TypeScript **completement agnostique de l'infrastructure**. Le framework definit des **Ports** (interfaces pures) que le code metier utilise. Les **Adapters** implementent ces interfaces pour chaque plateforme cible (Vercel, AWS, local dev, etc.).

Le framework ne connait ni Express, ni Redis, ni PostgreSQL, ni MikroORM. Il definit `IHttpPort`, `ICachePort`, `IDatabasePort`, `ILoggerPort`, etc. Changer de plateforme = changer d'adapter, pas de code metier.

### Convention de nommage : 2 types d'interfaces, zero ambiguite

| Suffixe | Role | Exemple | Cardinalite |
|---------|------|---------|-------------|
| **IXxxPort** | Contrat infrastructure du framework. Ce que le code metier consomme. | `ICachePort`, `IEventBusPort`, `ILoggerPort` | **1 seule** implementation active |
| **IXxxProvider** | Extension metier pluggable. Ce que le dev peut creer lui-meme. | `INotificationProvider`, `IPaymentProvider`, `IAuthProvider` | **Plusieurs** simultanement |

Les implementations concretes des Ports sont des classes (pas des interfaces) : `UpstashCacheAdapter implements ICachePort`, `VercelQueueAdapter implements IEventBusPort`, etc. Le dev les declare dans sa config et les oublie.

**Infrastructure Ports** (le framework en a besoin pour tourner, 1 implementation active) :
`ICachePort`, `IEventBusPort`, `IFilePort`, `ILockingPort`, `IJobSchedulerPort`, `IWorkflowEnginePort`, `IWorkflowStoragePort`, `IDatabasePort`, `IHttpPort`, `ILoggerPort`, `ITracerPort`

**Business Providers** (extensions metier, N implementations simultanees) :
`INotificationProvider`, `IPaymentProvider`, `IAuthProvider`, `ISearchProvider`, `IAnalyticsProvider`, `IFulfillmentProvider`, `IFileProvider`

Un Port a une seule implementation active. Un Provider peut en avoir plusieurs simultanement (ex: Resend pour les emails + Twilio pour les SMS).

### Retro-compatibilite Medusa

Pour la migration, le framework exporte des type aliases vers les noms Medusa :
```typescript
// @manta/compat-medusa — aliases Medusa → Manta
export type ICacheService = ICachePort
export type IEventBusService = IEventBusPort
export type ILockingService = ILockingPort
export type IDatabaseAdapter = IDatabasePort
export type ILogger = ILoggerPort
export type IJobScheduler = IJobSchedulerPort
export type ISearchService = ISearchProvider
export type IAnalyticsService = IAnalyticsProvider
// etc.
```

Les quatre piliers : un **container DI** avec resolution typee, un **module system** avec lifecycle hooks et providers pluggables, un **workflow engine** implementant le pattern Saga avec checkpoints et compensation, et une **couche HTTP** utilisant les Web Standards (Request/Response).

La cible de demonstration : **Next.js + Vercel en serverless**. Le dev local fonctionne avec des adapters in-memory/filesystem simples.

## Principes architecturaux

1. **Hexagonal** : le framework ne connait que ses ports. Aucune technologie concrete dans le core.
2. **Web Standards** : Request/Response natifs, pas de dependance a un framework HTTP specifique.
3. **Serverless-first** : tout est concu pour fonctionner en serverless (cold start rapide, stateless, lazy loading).
4. **Adapters swappables** : changer d'infra = changer d'adapter, pas de code metier ni framework.
5. **Convention over configuration** : filesystem-based discovery (routes, subscribers, jobs) avec pre-build possible.
6. **Type safety** : resolution typee du container, schemas Zod, declaration merging TypeScript.
7. **Strict mode** (optionnel) : `defineConfig({ strict: true })` desactive toutes les conventions implicites (auto-discovery filesystem, joiner config auto-generation, event name auto-generation). En strict mode, tout doit etre declare explicitement. Utile pour les tests (comportement 100% predictible et inspectable) et les projets qui preferent la configuration explicite. Defaut : `false`.

---

## PARTIE 1 -- PORTS (Interfaces pures)

### 1. Container & Dependency Injection

#### Port : IContainer

**SPEC-001 : Container DI avec singleton global et scoped containers**
- Contrat : le framework fournit un container DI global singleton. Chaque requete recoit un scoped container.
- Methodes : `resolve<T>(key)`, `register(key, value, lifetime?)`, `createScope()`, `registerAdd(key, value)` (enregistrements en tableau), `aliasTo(alias, target)`, `dispose()`, `id: string` (identifiant unique du scope, UUID v4 genere a la creation du scope — utile pour debug, correlation logs, et tests d'isolation entre requetes concurrentes)
- **Note sur `registerAdd` et `aliasTo`** : ces methodes font partie du contrat IContainer (pas specifiques a Awilix). `registerAdd` permet d'enregistrer plusieurs implementations sous la meme cle (tableau — utile pour plugins). `aliasTo` permet de creer des alias (utile pour compat et DX). Tout adapter de container DOIT les implementer. SPEC-129 definit la factory du container par defaut (basee sur Awilix), mais IContainer est le port — l'adapter est swappable.
- **ServiceLifetime** : 3 modes de lifetime explicites pour chaque service enregistre :
  - `SINGLETON` : une seule instance par container global. Partagee entre toutes les requetes. Utilise pour : module services, repositories, config. **Ne doit PAS stocker d'etat request-level.**
  - `SCOPED` : une instance par scope (= par requete HTTP / par workflow step). Cree via `createScope()`. Isolee entre scopes. Utilise pour : message aggregator, contexte de requete.
  - `TRANSIENT` : nouvelle instance a chaque `resolve()`. Utilise pour : factories, builders. **Le container ne track PAS les instances TRANSIENT** — elles ne sont pas referencees apres creation. `container.dispose()` n'appelle PAS `dispose()` sur les instances TRANSIENT (il n'a aucune reference vers elles). C'est la responsabilite de l'appelant de gerer le lifecycle des instances TRANSIENT. Raison : tracker les TRANSIENT impliquerait une Map croissante a chaque `resolve()` → fuite memoire garantie en serverless avec warm invocations.
- **Scope lifecycle** :
  - `createScope()` cree un child scope qui herite des singletons du parent. Les resolutions SCOPED dans un child scope sont isolees — elles n'existent que dans ce scope.
  - Un service SCOPED ne peut pas etre resolu hors d'un scope actif. Tenter de resoudre un SCOPED depuis le container global leve une `MantaError(INVALID_STATE)`.
  - Un service SINGLETON ne doit jamais dependre d'un service SCOPED (inversion de lifecycle). Le container doit detecter cette inversion au moment du `register()` et lever une erreur.
  - En serverless avec warm invocations : les SINGLETON persistent entre invocations (meme instance Lambda). Les SCOPED sont recrees a chaque requete. Les TRANSIENT sont recrees a chaque resolution.
- **Detection de scope actif — mecanisme** :
  - Le container utilise **`AsyncLocalStorage`** (Node.js `node:async_hooks`) pour tracker le scope actif. `createScope()` appelle `asyncLocalStorage.run(scopedContainer, callback)` — toute resolution dans le callback resout depuis le scoped container.
  - Detection SCOPED hors scope : si `asyncLocalStorage.getStore()` retourne `undefined` au moment d'un `resolve()` sur un service SCOPED, le container leve `MantaError(INVALID_STATE, "Cannot resolve SCOPED service outside of an active scope")`.
  - En serverless : chaque invocation HTTP/queue/cron appelle `createScope()` avec `asyncLocalStorage.run()`. Les warm invocations reutilisent le container global (SINGLETON OK) mais creent un nouveau scope ALS par requete (SCOPED isole).
  - **Activation du scope dans le pipeline HTTP — contrat explicite** :
    - L'etape 4 du pipeline (SPEC-039 "Scope") est responsable de l'activation. Concretement : le middleware cree un scope via `container.createScope()`, puis wrape TOUT le downstream (etapes 5 a 12) dans `asyncLocalStorage.run(scopedContainer, async () => { await next() })`. Le `next()` s'execute dans le contexte ALS — toute resolution SCOPED dans les etapes 5 a 12 resout depuis le scoped container.
    - **Risque avec Nitro/H3** : si le framework HTTP (Nitro, H3, ou autre) dispatche le handler via un mecanisme qui brise la chain ALS (pool de workers internes, `setImmediate`, `queueMicrotask` non-ALS-aware), le scope sera perdu. Le contrat du framework est : le middleware Scope DOIT wraper le downstream complet dans `asyncLocalStorage.run()`, et l'adapter HTTP DOIT garantir que le handler s'execute dans le meme call stack ALS. Si l'adapter HTTP brise le call stack (ex: re-dispatch via un pool), c'est un bug de l'adapter, pas du framework.
    - **Validation au boot** : le framework execute un self-test au premier cold start : cree un scope, enregistre une valeur SCOPED, wrape un handler factice dans `asyncLocalStorage.run()`, et verifie que la resolution retourne la bonne valeur. Si le test echoue (ALS non-fonctionnel ou brise par l'adapter), le boot leve `MantaError(INVALID_STATE, 'AsyncLocalStorage scope propagation failed. The HTTP adapter may be breaking the async context chain.')`. Ce test coute < 1ms et detecte les incompatibilites adapter/ALS immediatement.
    - **Risques connus ALS** : certains patterns Node.js brisent silencieusement la chaine ALS : `Promise.all()` traversant des boundaries de modules ESM dynamiques, Worker Threads internes de certains drivers DB, `queueMicrotask` dans des contexts non-ALS-aware. Le self-test au boot ne couvre que le cas basique (callback simple). Pour les cas avances, le framework documente les versions Node.js et adapters testes dans une matrice de compatibilite. Versions minimales : Node.js >= 18.x (ALS stable depuis v16.4, fiable depuis v18). Le framework NE fournit PAS de fallback vers explicit context passing — ALS est un prerequis non-negociable. Raison : un fallback dual-mode (ALS + explicit) doublerait la complexite de chaque adapter et du pipeline HTTP, avec des bugs subtils de mode-switching. Si ALS echoue au self-test, la seule resolution est de fixer l'adapter HTTP ou de changer de version Node.js.
    - **Risque specifique : middlewares custom du dev avec async detache** : si un middleware custom (declare dans `defineMiddlewares()`) utilise `setTimeout`, `setImmediate`, ou `queueMicrotask` pour du travail asynchrone, la chaine ALS est **brisee** — les callbacks asynchrones detaches s'executent hors du contexte `asyncLocalStorage.run()`. Ce n'est pas un bug du framework (le middleware custom est responsable de ses propres appels async), mais le dev ne le saura pas sans avertissement. **Mesures** : (1) la documentation du pipeline DOIT inclure un avertissement explicite : "Ne pas utiliser setTimeout/setImmediate/queueMicrotask dans les middlewares custom — utilisez des fonctions async/await classiques pour preserver le contexte ALS." (2) En strict mode, le framework PEUT instrumenter les middlewares custom avec un `AsyncLocalStorage` check apres execution : si le scope ALS est absent a la sortie du middleware alors qu'il etait present a l'entree, le framework log un warning : `Warning: Middleware "{name}" may have broken the ALS chain. Avoid setTimeout/setImmediate in middlewares.` Ce check n'est PAS bloquant (le middleware a deja execute) mais alerte le dev en dev mode.
    - **Desactivation du scope — lifecycle complet** : le scope est "desactive" naturellement quand `asyncLocalStorage.run()` complete (le callback se termine). Le scoped container n'est PAS explicitement dispose — il est eligible au GC. Les services SCOPED sont des instances legeres sans ressources a liberer (le cleanup est gere par les SINGLETON au `dispose()` global).
    - **Fin normale d'un scope** : quand le callback passe a `asyncLocalStorage.run(scope, callback)` retourne (resolve ou reject), le scope est "termine". Concretement : (1) `asyncLocalStorage.getStore()` retourne `undefined` apres la sortie du callback, (2) les references vers le scoped container et ses services SCOPED sont eligibles au GC si plus aucune closure n'y fait reference, (3) `dispose()` n'est PAS appele sur le scoped container — il n'y a rien a disposer (les SCOPED n'ont pas de ressources, les SINGLETON sont partages avec le parent). Le seul cleanup est le GC JavaScript standard.
    - **Consequence pour les tests** : `withScope(container, fn)` de `@manta/testing` wrape le callback dans `asyncLocalStorage.run()`. A la fin du callback, le scope est simplement abandonne (pas de dispose()). Le commentaire "dispose automatiquement" dans `withScope` signifie "le scope n'est plus actif" — PAS que `dispose()` est appele sur le scoped container. La distinction est importante : `container.dispose()` est un appel destructeur sur le container GLOBAL qui ferme les SINGLETON. `withScope` ne fait jamais ca.
    - **Risque de fuite memoire avec captures implicites** : bien que le container interdise les dependances SINGLETON→SCOPED au `register()`, des captures implicites a l'execution peuvent empecher le GC d'un scope : une closure dans un SINGLETON qui capture une reference vers un service SCOPED, un event handler non-desenregistre, un WeakRef mal utilise. En serverless avec warm invocations, ces fuites sont cumulatives. Le framework NE PEUT PAS detecter ces captures a l'execution (c'est un probleme JavaScript fondamental). **Recommandation** : les adapters SINGLETON ne doivent JAMAIS stocker de references vers des objets resolus dynamiquement. Les tests d'integration DOIVENT inclure un test de fuite memoire (`CT-16`) qui cree 1000 scopes et verifie que la memoire du process ne croit pas lineairement. `@manta/testing` fournit `assertNoScopeLeak(container, iterations?)` pour ce scenario.
  - Pour les tests : `container.createScope()` doit etre appele explicitement. Les tests unitaires qui resolvent un SCOPED sans scope actif recevront l'erreur attendue. `@manta/testing` fournit `withScope(container, fn)` pour simplifier.
- **Convention confirmee par audit** : la safety repose sur l'architecture — les services ne stockent pas d'etat request-level, ils recoivent le `Context` en parametre de methode via `@Ctx()`. Le lifetime explicite dans Manta formalise cette convention comme contrat verifiable.
- Garanties : resolution typesafe via declaration merging TypeScript. Le container est recree a chaque cold start. Les services doivent etre stateless pour garantir la coherence entre warm invocations.

**SPEC-002 : Cles d'enregistrement standardisees (ContainerRegistrationKeys)**
- Contrat : le framework definit des cles constantes pour les services cross-cutting.
- Cles : `LOGGER`, `CONFIG_MODULE`, `QUERY`, `LINK`, `REMOTE_LINK`, `FEATURE_FLAG_ROUTER`, `DB_CONNECTION`
- Garanties : resolution typee pour chaque cle via declaration merging.

**SPEC-003 : Acces au container dans les workflow steps via StepExecutionContext**
- Contrat : chaque step de workflow recoit le container DI dans son contexte d'execution.
- **Type StepExecutionContext** (definition complete) :
  ```typescript
  interface StepExecutionContext {
    container: IContainer       // scoped container du step (cree via createScope())
    metadata: {
      attempt: number           // numero de tentative (1-based, incremente a chaque retry)
      idempotencyKey: string    // cle d'idempotence du step ({workflowId}:{transactionId}:{stepId}:{action})
      action: 'invoke' | 'compensate'  // phase d'execution du step
    }
    context: Context            // Context framework (SPEC-060) avec transactionManager, auth_context, etc.
  }
  ```
  - **Construction** : le workflow engine cree un `StepExecutionContext` pour chaque execution de step. Le `container` est un scoped container enfant du container principal. Le `context` contient l'`auth_context` propage depuis l'appelant du workflow (handler HTTP, subscriber, ou job cron).
  - **Acces** : le step recoit `({ container, metadata, context }, input) => { ... }`. Le dev fait `container.resolve('myService')` pour acceder aux services.
- Garanties : resolution synchrone de n'importe quel service enregistre.

---

### 2. Module System

#### Port : IModuleService, IModuleLoader

**SPEC-004 : Module() wrapper et ModuleExports contract**
- Contrat : chaque module exporte un `ModuleExports` contenant : `service` (constructor), `loaders` optionnels, fonctions de migration (run/revert/generate), `discoveryPath`.
- Methodes : `Module(service)` wrape le service avec auto-generation de joinerConfig et linkable keys depuis les entites DML.
- **Idempotence des loaders** : un loader DOIT etre idempotent. En dev (hot-reload) ou en warm invocations, un loader peut etre appele plusieurs fois sur la meme DB. Le framework ne garantit PAS que le loader est appele une seule fois — il est appele a chaque bootstrap. Le dev DOIT implementer des patterns idempotents dans ses loaders (ex: `INSERT ... ON CONFLICT DO NOTHING`, verifications d'existence avant creation). Le framework log un warning au boot si un loader prend plus de 5s (indicateur de loader non-idempotent qui recree des donnees a chaque boot). Le `reloadSingleModule()` appelle les loaders — un loader non-idempotent cree des doublons.
- Garanties : definition statique de module, pas de side-effects runtime.

**SPEC-005 : Lifecycle hooks : onApplicationStart, onApplicationShutdown, onApplicationPrepareShutdown**
- Contrat : IModuleService definit des hooks optionnels `__hooks` appeles pendant le bootstrap et le shutdown.
- Garanties : `onApplicationStart` est appele apres le chargement. En serverless, `onApplicationShutdown` n'est **jamais** appele (le runtime freeze le process).
- **onApplicationStart et events** : `onApplicationStart` est appele pendant le lazy boot (etape 16), APRES que le buffer d'events est actif (etape 7). Les events emis dans `onApplicationStart` sont donc bufferises normalement et releasees a l'etape 17 (buffer release). Un subscriber enregistre dans `onApplicationStart` d'un module A verra les events emis par `onApplicationStart` d'un module B — a condition que A soit charge avant B.
- **Erreur dans onApplicationStart** : si un hook `onApplicationStart` throw, le framework log l'erreur via `ILoggerPort` et **continue** les autres hooks. Le module dont le hook a echoue est marque `DEGRADED` (pas `FAILED`) — ses services restent resolvables mais `/health/ready` retourne 503 tant qu'un module est DEGRADED. Le dev peut verifier l'etat via `container.resolve('MODULE_STATE').get(moduleName)`.
- **Recovery d'un module DEGRADED** : un module DEGRADED ne redevient PAS READY automatiquement. Le framework ne fait PAS de re-test periodique (trop de risques de side-effects si le hook est non-idempotent). Mecanismes de recovery :
  - **POST /health/recheck** (endpoint admin, authentifie) : re-execute `onApplicationStart` pour les modules DEGRADED. Si le hook reussit → module passe a READY. Si echec → reste DEGRADED. Disponible uniquement en dev ou avec flag `health.adminEndpoints: true`.
  - **Redeploy / cold restart** : en production, le mecanisme standard. Le module est re-initialise au prochain cold start.
  - **reloadSingleModule(moduleName)** : en dev/HMR, re-charge le module complet (incluant onApplicationStart). Si le hook reussit → module passe a READY.
- **Events emis par un hook qui throw** : si `onApplicationStart` emet des events via `save()` PUIS throw, le decorateur `@EmitEvents()` appelle `clearMessages()` (comportement standard). Les events sont perdus — pas de publication partielle.

**SPEC-006 : IModuleLoader orchestre le chargement de tous les modules**
- Contrat : le loader merge les modules par defaut avec la config utilisateur, prepare les ressources partagees, bootstrappe tous les modules, enregistre QUERY, LINK, REMOTE_QUERY dans le container.
- Garanties : supporte le hot-reload d'un module individuel via `reloadSingleModule()`.
- **Idempotence des loaders et reloadSingleModule()** : quand `reloadSingleModule(moduleName)` est appele (dev/HMR), le framework re-execute les loaders du module. Les loaders DOIVENT etre idempotents : `INSERT ON CONFLICT DO NOTHING` pour les donnees initiales, pas de `INSERT` brut. Si un loader n'est pas idempotent, le double-appel cree des doublons. Le framework log un warning si un loader prend > 5s (potentiellement non-idempotent et re-inserant massivement). Test recommande : appeler `reloadSingleModule()` 2x sur un module avec loader, verifier qu'il n'y a pas de doublons en DB. Test : ML-01.
- Note serverless : le bootstrap complet est couteux. Le framework doit supporter le lazy loading et le pre-warming.

**SPEC-007 : Modules internes vs externes (scope: internal | external)**
- Contrat : modules internes (in-process) et externes (via HTTP a un serveur distant avec url, keepAlive).
- Garanties : les modules externes sont naturellement distribues et serverless-compatibles.

**SPEC-008 : Trigger types (remplace workerMode)**
- Contrat : chaque entry point declare son trigger : `http` (Nitro handler), `queue` (event bus consumer), `cron` (scheduled job). En serverless, chaque trigger est une fonction independante. En Node standalone, tous les triggers tournent dans le meme process.
- Configuration : `triggers: { http: boolean, queue: boolean, cron: boolean }` dans la config projet, ou via `MANTA_TRIGGERS=http,queue,cron` env var.
- Compatibilite workerMode : `shared` = `{http:true, queue:true, cron:true}`, `server` = `{http:true, queue:false, cron:false}`, `worker` = `{http:false, queue:true, cron:true}`.
- Garanties : granularite fine — un process peut activer/desactiver chaque trigger independamment. Extensible (ajout de triggers futurs sans redesign).

**SPEC-009 : ModuleProvider() pour les providers pluggables**
- Contrat : `ModuleProvider()` wrape un provider service et ses loaders. Utilise pour File, Auth, Notification, Locking, Caching, Fulfillment.
- Garanties : chaque provider a un `identifier` unique valide au chargement. Pattern de registration statique.

**SPEC-010 : defineConfig avec defaults et auto-detection dev/prod**
- Contrat : `defineConfig()` merge la config utilisateur avec des defaults. Auto-detection de l'environnement via `APP_ENV` (explicite) ou fallback sur `NODE_ENV`. Deux profils : `dev` (adapters locaux) et `prod` (adapters durables).
- Resolution : `config.appEnv ?? process.env.APP_ENV ?? (NODE_ENV === 'production' ? 'prod' : 'dev')`
- Defaults dev : PG local, in-memory cache/events, Pino pretty, local filesystem
- Defaults prod : Neon, Upstash Redis, Vercel Queues, Pino JSON, Vercel Blob
- Garanties : override explicite via config ou env var. Pas de magie — le dev sait toujours quel profil est actif.

**SPEC-011 : Module joiner config et Remote Query**
- Contrat : chaque module expose un `__joinerConfig()` definissant serviceName, primaryKeys, relationships, schema, linkableKeys. Le Query service fournit 2 modes : `graph` (cross-module avec `@Cached`), `index` (via Index module).
- Methodes : `Query.graph()`, `Query.index()`
- Note : `Query.gql()` supprime — vestigial dans Medusa (2 references dans tout le codebase), source de confusion. Toute l'API passe par `graph()`. Si un dev appelle `Query.gql()`, le framework leve `MantaError(NOT_IMPLEMENTED, 'Query.gql() has been removed. Use Query.graph() instead.')` — pas un `undefined is not a function`. Test : QG-01.
- **Semantique des deux modes** :
  - `Query.graph(config)` : cross-module joins via joiner configs. Resout les relations entre modules differents. Toujours disponible si au moins un module est charge.
  - `Query.index(config)` : lecture denormalisee via le module Index (SPEC-104). Necessite que le module Index soit charge ET que l'entite soit indexee.
  - **Comportement si le module Index n'est pas charge** : `Query.index()` leve une `MantaError(UNKNOWN_MODULES, 'Index module is not loaded. Use Query.graph() or enable the Index module.')`. Le dev recoit une erreur explicite, pas un resultat vide silencieux.
  - **Guide de decision : quand utiliser `graph()` vs `index()`** :
    - Utiliser `Query.graph()` par defaut. C'est le mode standard, toujours disponible, cross-module.
    - Utiliser `Query.index()` quand : (1) les queries `graph()` sont trop lentes (trop de JOINs cross-module), (2) un cache de lecture denormalise est souhaite, (3) des filtres complexes sur des donnees de plusieurs modules sont necessaires.
    - `Query.index()` est un **optimisation de lecture** — il ne remplace pas `graph()`, il l'accelere pour certains patterns. Les ecritures passent toujours par les modules (service → repository → DB). L'index est synchronise en arriere-plan via events.
  - **Comportement si l'entite n'est pas indexee** : `Query.index()` leve une `MantaError(NOT_FOUND, 'Entity "product" is not indexed. Add it to the Index module schema.')`.
- **Resolution cross-module — profondeur et timeout** :
  - **Modules in-process** : resolution directe par injection (pas de HTTP). La profondeur de resolution est **illimitee** — le joiner resout recursivement toutes les relations demandees dans `fields`. Performance = N queries SQL (une par module traverse). Pour eviter les abus : le dev controle la profondeur via les `fields` demandes (pas de `fields: ["*"]` recursif).
  - **Modules externes** (SPEC-007, `scope: external`) : chaque appel HTTP a un timeout configurable par module (defaut **5 secondes**). Configuration : `modules: [{ resolve: "...", options: { url: "...", timeout: 5000 } }]`. Si un module externe timeout : **fail fast** — `MantaError(UNEXPECTED_STATE, 'Module "inventory" timed out after 5000ms')`. Pas de partial result. Le dev doit gerer le retry a son niveau ou utiliser un circuit breaker externe.
  - **Pagination obligatoire** : `Query.graph()` respecte `limit` et `offset` dans la config. Il n'y a pas de query sans limit en production — le framework force un `limit: 100` par defaut si non specifie (overridable). Ceci previent les resultats 50k+ qui exploseraient les traductions ou la memoire.
  - **Pagination des relations imbriquees** : le `limit: 100` par defaut s'applique uniquement a l'entite racine de la query. Les relations imbriquees (ex: `products → variants → options`) ne sont PAS limitees par defaut — elles retournent toutes les relations de chaque entite parente. Raison : limiter les relations casserait la coherence des resultats (un produit avec 50 variants n'en afficherait que 100 arbitrairement). Le dev peut paginer les relations explicitement via `pagination: { variants: { limit: 20, offset: 0 } }`.
  - **Type `RelationPagination`** (definition complete) :
    ```typescript
    type RelationPagination = {
      [relationName: string]: {
        limit?: number     // max entities for this relation (default: unlimited)
        offset?: number    // skip N entities (default: 0)
      }
    }
    ```
    - S'utilise dans `Query.graph({ ..., pagination: { variants: { limit: 20 } } })`.
    - Le `pagination` est un champ optionnel de `GraphQueryConfig`. Il n'existe PAS sur `Query.index()` (les index retournent des donnees denormalisees).
    - Chaque cle du `pagination` DOIT correspondre a un nom de relation declare dans le joiner config. Une cle inconnue leve `MantaError(INVALID_DATA, 'Unknown relation "foo" in pagination')`.
    - La pagination des relations est appliquee APRES la resolution de l'entite parente — c'est un `LIMIT/OFFSET` SQL sur la sous-query de relation.
    - Interaction avec le seuil dur (10000 entites) : les relations paginées comptent dans le total d'entites. La pagination des relations est le mecanisme recommande pour rester sous le seuil.
    - **Methode de comptage et ordre des operations** : le comptage est **sur le total d'entites retournees**, quel que soit le niveau de profondeur. L'ordre des operations pour chaque batch de resolution est :
      1. Resoudre le batch (query SQL, retourne N entites)
      2. **Appliquer la RelationPagination** si configuree (tronquer les resultats par relation selon `limit/offset`)
      3. Incrementer le compteur global : `total += resultatsApresPagination.length`
      4. Si le total depasse le seuil → arreter AVANT de resoudre le batch suivant et lever `MantaError(INVALID_DATA)`
    - La pagination des relations est donc appliquee AVANT le comptage — les entites tronquees ne comptent pas dans le seuil. Exemple : 100 produits (total=100) → batch variants: 5000 retournes, pagination `variants: { limit: 5 }` → 5×100=500 gardes (total=600) → batch options: 3000 (total=3600) → OK. Sans pagination, le batch variants compterait 5000 et le total serait 5100.
    - L'increment se fait au retour de chaque batch, pas au niveau de profondeur — ceci gere correctement les batches qui traversent les niveaux de facon non-lineaire. Le comptage est simple et deterministe.
    - **Limitation connue — charge DB vs pagination JS** : la `RelationPagination` est appliquee APRES la query SQL, cote JS. La charge DB reste proportionnelle au nombre total de relations en base, pas au nombre pagine. Exemple : 100 produits × 5000 variants = la DB retourne 500k rows, puis le framework tronque a 500 (5×100). Pour les cas de haute cardinalite (>1000 relations par entite), utiliser `Query.index()` (SPEC-011) qui fournit une lecture denormalisee avec pagination SQL native. `RelationPagination` est un mecanisme de protection memoire, pas une optimisation DB.
  - **Protection contre l'explosion de donnees** :
    - **Seuil d'alerte** : le framework compte le nombre total d'entites chargees (racine + imbriquees). Au-dela de **1000 entites totales**, le framework log un warning avec le detail (entite racine, relation fautive, nombre d'entites).
    - **Seuil dur** : au-dela de **10000 entites totales**, le framework leve une `MantaError(INVALID_DATA, 'Query returned 12500 entities, exceeding the maximum of 10000. Use pagination on nested relations or reduce the scope of your query.')`. Ce seuil est configurable via `defineConfig({ query: { maxTotalEntities: 10000 } })`.
    - **Opt-out explicite** : pour les cas B2B legitimement volumineux (export, migration), le dev peut passer `{ dangerouslyUnboundedRelations: true }` dans les options de `query.graph()`. Ceci desactive le seuil dur (le warning reste). Le naming explicite force le dev a reconnaitre le risque.
    - **`withDeleted: true` et seuil** : les entites soft-deleted restaurees par `withDeleted` comptent dans le seuil de 10000 au meme titre que les entites actives. Un `query.graph({ ..., withDeleted: true })` sur une table avec 8000 actifs + 5000 soft-deleted atteindra le seuil a 10000 (pas a 8000). `dangerouslyUnboundedRelations` desactive le seuil pour `withDeleted` aussi. C'est coherent : le seuil protege contre la memoire, pas contre le type de donnees.
    - **Strict mode** : en `strict: true`, le seuil dur est **5000** par defaut et `dangerouslyUnboundedRelations` est interdit (leve une erreur).
  - **Circuit breaker pour modules externes** : quand `Query.graph()` traverse un module externe (SPEC-007), c'est le RemoteJoiner qui recoit l'erreur de timeout. Le RemoteJoiner propage l'erreur comme `MantaError(UNEXPECTED_STATE)` au caller. Si le caller est un workflow step, c'est le workflow qui voit l'erreur et decide (retry, compensate, etc.). Le RemoteJoiner ne gere PAS de circuit breaker — c'est une responsabilite applicative. Le RemoteJoiner expose un hook `beforeFetch(module: string, query: RemoteQuery) => Promise<Result | null>` : si le hook retourne un Result, le RemoteJoiner l'utilise sans appeler le module externe (short-circuit). Si le hook retourne `null`, le fetch procede normalement. Le dev peut implementer un circuit breaker via ce hook (ex: compteur d'echecs, state open/closed/half-open via ICachePort). Pattern recommande :
    ```typescript
    remoteJoiner.beforeFetch = async (module, query) => {
      const state = await circuitBreaker.getState(module)
      if (state === 'open') throw new MantaError('UNEXPECTED_STATE', `Circuit breaker open for module "${module}"`)
      return null // proceed normally
    }
    ```
    Sans ce hook, le dev doit wraper chaque appel `Query.graph()` individuellement avec un circuit breaker externe (ex: `cockatiel`, `opossum`) — approche plus lourde.
- Garanties : RemoteQuery avec batching (4000 IDs par batch, max 10 requetes concurrentes). Stateless par requete. Pour modules in-process, injection directe au lieu de RemoteJoiner.

**SPEC-012 : Link modules pour relations cross-module**
- Contrat : `defineLink()` cree des relations entre modules differents. Support create, dismiss, delete, restore avec cascade soft-delete.
- Table generee : `{module_a}_{entity_a}_{module_b}_{entity_b}` avec colonnes `id`, FK gauche, FK droite, `created_at`, `updated_at`, `deleted_at`. Cle primaire composite sur les deux FK. Indexes auto-generes sur chaque FK + `deleted_at IS NULL`.
- Options : `database.table` (nom custom), `database.idPrefix`, `database.extraColumns` (colonnes supplementaires sur la table de link — types standard Drizzle).
- Read-only links : `isReadOnlyLink: true` — pas de table pivot, utilise une FK existante. Pour relations intrinsiques.
- Cascade : chaque cote peut definir `deleteCascade: true/false`. Le softDelete propage via `returnLinkableKeys`.
- **Restore et liens** : `restore()` sur une entite ne restaure PAS automatiquement les liens soft-deleted. Les liens sont des entites independantes — le dev doit appeler `link.restore()` explicitement s'il veut restaurer les relations. Raison : entre le softDelete et le restore, de nouveaux liens ont pu etre crees, et restaurer les anciens automatiquement pourrait creer des doublons ou des etats incoherents. Le retour de `softDelete()` inclut les IDs des liens cascades pour permettre un restore manuel cible.
- **`withDeleted: true` et propagation aux relations** : quand `Query.graph()` est appele avec `withDeleted: true`, le filtre soft-delete est desactive sur TOUTE la chaine de resolution :
  - **Tables de link** (defineLink) : les liens soft-deleted sont inclus. Exemple : produit soft-deleted + link vers collection soft-deleted → les deux retournes.
  - **Relations FK directes** (hasOne, hasMany, belongsTo) : les entites relatees soft-deletees sont AUSSI incluses. Exemple : `Product hasMany Variant` via FK directe → si une variant est soft-deleted, elle est retournee avec `withDeleted: true`. Sans `withDeleted`, elle est filtree par `WHERE deleted_at IS NULL` comme toute entite.
  - **Coherence** : `withDeleted: true` s'applique **uniformement** a toute la query — entite racine, relations FK directes, ET tables de link. Il n'y a PAS de distinction entre link tables et FK directes pour ce comportement. Le RemoteJoiner propage le flag `withDeleted` a chaque sous-query de relation.
  - **Modules externes (scope: external)** : quand `Query.graph()` traverse un module externe, le flag `withDeleted` est propage via le payload de la requete inter-services. Le RemoteJoiner serialise `withDeleted: true` dans le body JSON de la requete HTTP vers le module externe : `{ fields: [...], filters: {...}, withDeleted: true }`. Le module distant lit ce flag et desactive le filtre `WHERE deleted_at IS NULL` sur ses queries. Si le module distant ne supporte pas `withDeleted` (version anterieure), il l'ignore et retourne uniquement les entites actives — pas d'erreur.
  - **Pas de withDeleted partiel** : il n'est PAS possible de faire `withDeleted: true` sur l'entite racine mais pas sur ses relations (ou vice versa). C'est un flag global de query. Pour un controle plus fin (ex: "produits actifs avec variants soft-deleted"), le dev doit faire deux queries separees ou utiliser un filtre post-query.
  - **Interaction withDeleted + RelationPagination** : les deux sont orthogonaux. `withDeleted: true` agit sur le WHERE (retire le filtre `deleted_at IS NULL`), `RelationPagination` agit sur le LIMIT/OFFSET. Le WHERE est applique d'abord, puis le LIMIT. Exemple : `{ pagination: { variants: { limit: 5 } }, withDeleted: true }` → les 5 premiers variants (actifs + soft-deleted ensemble, sans filtre), pas les 5 actifs puis les 5 soft-deleted separement.
- Migration planner : table `link_module_migrations` track CREATE/UPDATE/DELETE/NOOP/NOTIFY. Detection d'unsafe SQL (ALTER COLUMN, DROP COLUMN) → action `notify` pour approbation manuelle.
- Drizzle : les tables de link sont des tables Drizzle standard. `drizzle-kit generate` les gere nativement. Pas de traitement special.
- Garanties : validation d'unicite pour les relations non-list.
- **Enregistrement des liens — mecanisme et tree-shaking** :
  - Les definitions de liens s'auto-enregistrent a l'import via `global.MantaModule.setCustomLink()`. Note : en presence de `@manta/compat-medusa`, un alias `global.MedusaModule = global.MantaModule` est installe pour la retrocompatibilite pendant la migration progressive. Les deux namespaces pointent vers le meme objet — pas de collision possible.
  - **Probleme tree-shaking** : en build optimise (Vercel, Next.js, esbuild), un fichier qui exporte `defineLink()` mais n'est importe par rien sera tree-shake — `setCustomLink()` ne sera jamais appele. Les liens disparaissent silencieusement.
  - **Solution — manifeste pre-build (SPEC-074)** : `manta build` scanne les fichiers `src/links/` et genere un manifeste qui liste TOUS les fichiers de liens. Au runtime, le bootstrap importe explicitement chaque fichier de lien liste dans le manifeste, dans l'ordre du manifeste. Le tree-shaker ne peut pas supprimer un import explicite.
  - **En dev (sans pre-build)** : le filesystem scanner de `ResourceLoader` (SPEC-125) decouvre les fichiers `src/links/*.ts` et les importe dynamiquement au boot. Pas de tree-shaking en dev.
  - **Regle pour le dev** : les fichiers de liens DOIVENT etre dans `src/links/`. Un `defineLink()` dans un fichier arbitraire (ex: `src/services/product.ts`) n'est PAS garanti d'etre decouvert — le scanner ne scan que `src/links/`. En strict mode (SPEC-007 principe 7), les liens non-declares dans `src/links/` levent une erreur au boot.
  - **Plugins — decouverte des liens au build** : `manta build` decouvre les liens de plugins **statiquement** depuis `definePlugin()`. Chaque plugin declare ses liens dans `definePlugin({ links: ['./src/links/product-collection.ts', ...] })` (chemins relatifs au package root du plugin). `manta build` resout ces chemins via `require.resolve(pluginPackage + '/package.json')` pour trouver le package root, puis importe chaque fichier de lien declare. Les liens ne sont PAS decouverts par scan dynamique du `src/links/` du plugin — seuls les liens declares dans `definePlugin()` sont inclus dans le manifeste. Un lien de plugin non-declare dans `definePlugin()` sera absent du manifeste et silencieusement ignore en production. En strict mode, `manta build` verifie que chaque fichier `src/links/*.ts` du plugin est declare dans `definePlugin()` et leve un warning sinon.

**SPEC-013 : MantaModule singleton registry avec lifecycle management**
- Contrat : registre singleton central pour tous les modules. Gere instances, metadata, joiner configs, resolutions.
- Garanties : deduplication du chargement. Lifecycle hooks pour tous les modules enregistres.

**SPEC-014 : Migration system avec concurrence et locking**
- Contrat : support migrateUp, migrateDown, migrateGenerate. Mode allOrNothing et concurrence configurable.
- Garanties : utilise le port ILockingPort pour le locking distribue pendant les migrations (expire: 1h). Migrations executees via CLI, pas au runtime.
- **Rollback (migrateDown) avec Drizzle** : `migrateDown` est une fonctionnalite **best-effort**. Drizzle ne genere pas de rollback migrations automatiquement (contrairement a Flyway/Liquibase). Le dev DOIT ecrire les fichiers de rollback manuellement (SQL ou via drizzle-kit). `migrateDown` execute ces fichiers dans l'ordre inverse. Si un fichier de rollback n'existe pas, `migrateDown` leve une erreur explicite. En production, le rollback recommande est un **forward fix** (nouvelle migration corrective) plutot qu'un `migrateDown`.
- **Convention de nommage des fichiers de rollback** :
  - `manta db:generate` cree un fichier de migration dans `drizzle/migrations/` (ex: `0001_create_products.sql`).
  - Il cree AUSSI un fichier rollback squelette : `0001_create_products.down.sql` avec un commentaire `-- TODO: Write rollback SQL for this migration`. Le fichier existe mais est vide (sauf le commentaire).
  - `manta db:rollback` cherche le fichier `.down.sql` correspondant a chaque migration a rollback. S'il ne contient que le commentaire TODO, le framework leve `MantaError(INVALID_DATA, 'Rollback file for migration "0001_create_products" is empty (TODO not replaced). Write the rollback SQL or use a forward fix.')`.
  - La convention `.down.sql` est obligatoire. Un fichier de rollback avec un autre nom n'est PAS decouvert.

**SPEC-015 : Modules requis : EVENT_BUS et CACHE obligatoires**
- Contrat : EVENT_BUS et CACHE sont marques `isRequired: true`. Les autres modules sont optionnels.
- Garanties : definit l'infrastructure minimale d'une application.

**SPEC-016 : Module disable et selective loading**
- Contrat : les modules peuvent etre desactives via `disable: true` dans la configuration.
- Garanties : desactiver des modules reduit le temps de bootstrap, benefique pour serverless.

**SPEC-017 : Global singleton pattern**
- Contrat : les classes core critiques utilisent le pattern `global.X ??= X` pour garantir une instance unique.
- Garanties : reset au cold start, re-enregistrement automatique.

**SPEC-018 : IMessageAggregator pour batching d'events domaine**
- Contrat : `IMessageAggregator` collecte les events domaine dans un Context avant emission groupee.
- Methodes : `save(messages)`, `getMessages(options)`, `clearMessages()`
- **Lifetime** : `SCOPED` dans le container. Chaque scope (requete HTTP, workflow step) a sa propre instance. Les events accumules dans un scope ne leak pas vers un autre scope. Au dispose du scope, les messages non-publies sont perdus (fail-safe).
- **Interaction avec @EmitEvents()** : la **logique metier** (ou `createService()`) appelle `IMessageAggregator.save(events)` explicitement pendant la mutation. Le decorateur `@EmitEvents()` ne fait que gerer le lifecycle : **no-op au succes** (les events restent dans le buffer), **`clearMessages()` a l'erreur**. La publication reelle se fait en **deux temps** :
  1. **Requete HTTP** : a la fin de la requete (apres le handler, etape 12 du pipeline), le pipeline lit `getMessages()`, appelle `IEventBusPort.emit()`, puis `clearMessages()`.
  2. **Workflow** : le workflow engine appelle `IEventBusPort.releaseGroupedEvents(eventGroupId)` au succes, ou `clearGroupedEvents(eventGroupId)` a l'echec.
  - **Transition MessageAggregator → EventBus** : le moment exact est la fin de la requete (pipeline) ou le `releaseGroupedEvents` (workflow). Avant ce moment, les events sont dans le `IMessageAggregator` (testable via `getMessages()` — c'est ce que MA-07 verifie). Apres ce moment, les events sont dans le bus (testable via subscribers — c'est ce que E-01 verifie). Les deux tests sont complementaires, pas redondants.
- Garanties : supporte groupBy, sortBy et formatage avant emission. Batching in-memory par requete/workflow.

**SPEC-073 : Implementations duales in-memory / durable**
- Contrat : chaque module infrastructure a au minimum une implementation in-memory (dev) et une implementation durable (production).
- Garanties : toutes les implementations in-memory sont inadaptees a la production serverless. Les implementations durables sont requises.

**SPEC-074 : Bootstrap deux vitesses**
- Contrat : sequence de chargement en 18 etapes. Split en deux phases pour serverless :
- **Core boot (synchrone)** : config, feature flags, logger, DB connection, modules requis (EVENT_BUS, CACHE), API routes registration. C'est le minimum pour handler une requete HTTP.
  - **Performance guideline (PAS un contrat de port)** : la Conformance Suite NE TESTE PAS les performances — elle teste les comportements (les 18 etapes, leur ordre, leur completion). Les benchmarks de performance sont dans un outil separe (`manta bench`). Temps de core boot realistes par profil d'adapter :
    - In-memory (tests) : < 10ms
    - PG local (dev) : < 50ms (connexion locale, pas de TLS)
    - Neon (prod/serverless) : < 200ms (connexion TCP + TLS au cold start, 50-200ms typique selon la region)
    - Ces chiffres incluent l'etape 5 (DB connection) qui domine le temps de core boot. La cible "< 50ms" souvent citee correspond au profil PG local uniquement.
- **Lazy boot (on-demand, a la premiere resolution)** : tous les autres modules metier, workflows, subscribers, policies RBAC, jobs, defaults (store/sales channel), module hooks `onApplicationStart`.
- Pre-build : `manta build` genere un manifeste (routes, subscribers, jobs, modules) → au runtime, chargement direct du manifeste sans scan filesystem.
- Migrations : decouplees du boot. Commande CLI dediee `manta db:migrate`, jamais executees au cold start.
- **Race condition boot/events — contrat explicite** :
  - Les events domaine NE SONT PAS emis pendant le core boot. Le bus est disponible (subscribe est possible), mais `emit()` est **buffered** jusqu'a la fin du lazy boot.
  - Sequence garantie : (1) core boot → EVENT_BUS et CACHE charges → subscribers enregistres dans le bus, (2) lazy boot → modules metier charges → `onApplicationStart` appele, (3) buffer release → les events emis pendant le boot sont publies dans l'ordre d'emission.
  - Ceci garantit qu'un subscriber enregistre dans `onApplicationStart` ne rate AUCUN event emis pendant le boot.
  - En serverless, si la premiere requete arrive pendant le lazy boot, elle est mise en attente (via `await lazyBootPromise`) jusqu'a completion. Pas de requete servie avec un boot partiel.
  - **Thundering herd (Node standalone)** : si N requetes arrivent pendant le lazy boot, elles attendent toutes sur le meme `lazyBootPromise`. Quand la promise se resout, les N requetes se debloquent simultanement. C'est un comportement **intentionnel et acceptable** :
    - En serverless Vercel : chaque invocation est isolee, pas de thundering herd possible.
    - En Node standalone : le thundering herd est equivalent a N requetes arrivant apres un cold start. Le load balancer/reverse proxy gere le rate limiting. Le framework ne limite PAS les requetes en attente (`maxPendingRequests` n'est pas implemente) — c'est une responsabilite infra (Nginx `limit_req`, HAProxy `maxconn`). Le framework log un warning si plus de 50 requetes sont en attente pendant le lazy boot pour alerter le dev.
  - **Timeout du lazy boot** : le lazy boot a un timeout configurable (defaut **30 secondes**). Si le lazy boot ne complete pas dans ce delai, `lazyBootPromise` rejette avec `MantaError(UNEXPECTED_STATE, 'Lazy boot timed out after 30000ms')`. La requete en attente recoit un HTTP 503 Service Unavailable. Les requetes suivantes retentent le lazy boot (pas de cache de l'echec) — ceci permet la recovery automatique si l'echec etait transitoire (DB lente au premier cold start). Le timeout est configurable via `defineConfig({ boot: { lazyBootTimeoutMs: 30000 } })`.
  - **Echec du lazy boot** : si le lazy boot echoue (erreur, pas timeout), le comportement est identique — 503, retry au prochain appel. Le framework log l'erreur via `ILoggerPort.error()` avec le detail de l'echec.
  - **Retry backoff apres echec du lazy boot** : si le lazy boot echoue et que N requetes en attente recoivent toutes un 503 simultanement, leurs retries vont re-declencher le lazy boot en meme temps (thundering herd au retry). Le framework gere ceci via un **cooldown apres echec** :
    - Apres un echec du lazy boot, le framework attend un **cooldown configurable** (defaut **2 secondes**, configurable via `defineConfig({ boot: { lazyBootRetryCooldownMs: 2000 } })`) avant d'accepter un nouveau lazy boot.
    - Pendant le cooldown, toute requete recoit immediatement un HTTP 503 avec header `Retry-After: 2` (valeur du cooldown en secondes). Pas de mise en attente — fail fast.
    - Apres le cooldown, la premiere requete re-declenche le lazy boot. Les requetes suivantes attendent sur le meme `lazyBootPromise` (comportement normal).
    - Le cooldown est **exponentiel** : 2s, 4s, 8s, 16s max. Reset a 2s apres un lazy boot reussi. Ceci evite le hammering sur une DB down.
    - En serverless Vercel : chaque invocation est isolee, le cooldown n'a pas d'effet (chaque Lambda retente independamment). Le cooldown est pertinent uniquement en Node standalone.

---

### 3. Workflow Engine

#### Port : IWorkflowEnginePort, IWorkflowStoragePort

**SPEC-019 : TransactionOrchestrator -- Saga-based distributed transactions**
- Contrat : machine d'etats orchestrant des transactions multi-steps avec invoke et compensate.
- Methodes : orchestrate les etats DORMANT -> NOT_STARTED -> INVOKING -> DONE/FAILED/TIMEOUT, et DONE -> COMPENSATING -> REVERTED/FAILED.
- Garanties : gere l'ordre d'execution, les timeouts (transaction et step), les retries.

**SPEC-019b : IWorkflowEnginePort — port explicite du moteur de workflow**
- Contrat : port definissant le contrat du moteur d'execution des workflows. Meme si l'implementation par defaut est le pattern Saga (TransactionOrchestrator), le port permet de swapper le moteur complet.
- Methodes :
  - `run(workflowId, options)` : execute un workflow. Options : `input`, `context`, `transactionId`, `resultFrom` (step ou workflow), `throwOnError`.
  - `getRunningTransaction(workflowId, transactionId)` : recupere l'etat d'une transaction en cours.
  - `setStepSuccess(idempotencyKey, response)` : complete un step async avec succes.
  - `setStepFailure(idempotencyKey, error)` : complete un step async avec echec.
  - `subscribe(options, handler)` : souscrit aux events de lifecycle d'un workflow (STEP_SUCCESS, STEP_FAILURE, FINISH, COMPENSATE_BEGIN, COMPENSATE_END). Retourne une fonction `unsubscribe()`.
    - **Contrat des handlers subscribe** : les handlers sont des **observateurs asynchrones fire-and-forget**. Ils sont appeles apres que l'event de lifecycle a eu lieu, PAS avant. Une erreur dans un handler est loguee via `ILoggerPort.error()` mais ne bloque PAS le workflow — le moteur continue normalement. Les handlers NE peuvent PAS modifier le comportement du workflow (pas de veto, pas de modification de resultat). Cas d'usage : monitoring, metriques, audit trail, debugging.
    - **Timing de notification precis** : pour STEP_SUCCESS/STEP_FAILURE, le handler est notifie **apres la persistance du checkpoint du step courant** (etat DONE/FAILED dans le storage), **avant** le lancement du step suivant. Sequence : (1) step execute → resultat, (2) checkpoint persiste (step=DONE), (3) handlers `subscribe` notifies (fire-and-forget), (4) step suivant lance. Cette garantie permet aux observateurs de lire le checkpoint a jour au moment de la notification. Pour FINISH, le handler est notifie apres la persistance de l'etat final du workflow.
    - **Signature du handler** : `(event: WorkflowLifecycleEvent) => Promise<void> | void` avec `WorkflowLifecycleEvent: { type: 'STEP_SUCCESS' | 'STEP_FAILURE' | 'FINISH' | 'COMPENSATE_BEGIN' | 'COMPENSATE_END', workflowId: string, transactionId: string, stepId?: string, result?: unknown, error?: MantaError, status?: WorkflowStatus }`.
    - **Tests** : W-16 a W-19 dans la Conformance Suite.
- Responsabilites automatiques du moteur :
  - Appeler `IEventBusPort.releaseGroupedEvents(eventGroupId)` en cas de succes du workflow.
  - Appeler `IEventBusPort.clearGroupedEvents(eventGroupId)` en cas d'echec.
  - Persister les checkpoints via `IWorkflowStoragePort` apres chaque step.
- Implementations possibles :
  - **Saga (defaut)** : TransactionOrchestrator local. Adapte pour la plupart des cas.
  - **Temporal** (futur) : delegation a un service Temporal externe pour orchestration distribuee.
  - **Inngest** (futur) : delegation a Inngest pour workflows serverless.
- **Continuation en serverless (Vercel, Lambda)** :
  - **Workflows courts (<60s)** : executes entierement dans une seule invocation. Le Saga engine charge le checkpoint depuis IWorkflowStoragePort, execute tous les steps restants, persiste le resultat. C'est le cas nominal.
  - **Workflows longs (>60s)** : le framework fournit un mecanisme de continuation base sur les async steps (`setStepSuccess`/`setStepFailure`). Le workflow atteint un step async, persiste son etat dans IWorkflowStoragePort, et retourne. La reprise est declenchee par :
    1. **Callback HTTP** : un endpoint `/workflows/:workflowId/:transactionId/step/:idempotencyKey` recoit le resultat du step async (webhook externe, notification de service tiers). Le handler appelle `setStepSuccess()` puis `run()` avec le meme `transactionId` pour continuer.
    2. **Event bus** : un subscriber ecoute l'event de completion du step async et relance le workflow via `run()`.
    3. **Cron de reprise** : un job periodique (`workflow:resume`, configurable, default 60s) query IWorkflowStoragePort pour les workflows en etat `INVOKING` depuis plus de N secondes (timeout configurable par workflow, default 300s) et les relance via `run()`. C'est le filet de securite pour les workflows sans callback explicite.
  - **Garantie d'idempotence** : chaque step a un `idempotencyKey`. Un step deja `DONE` n'est jamais re-execute. Le `run()` sur un workflow deja en cours est safe — il reprend depuis le dernier checkpoint.
  - ⚠️ Serverless : les workflows longs necessitent un mecanisme de trigger externe (callback, event, cron). Le framework ne maintient PAS de connexion persistante ni de timer interne entre invocations.
- Garanties : le port DOIT etre mockable en tests. Un `InMemoryWorkflowEngine` est fourni pour les tests unitaires.

**SPEC-020 : Checkpoint persistence avec merge concurrent**
- Contrat : les checkpoints capturent l'etat complet de la transaction via `IWorkflowStoragePort`.
- **Interface IWorkflowStoragePort — signature complete** :
  ```typescript
  interface IWorkflowStoragePort {
    save(transactionId: string, stepId: string, data: Record<string, unknown>): Promise<void>
    load(transactionId: string, stepId?: string): Promise<Record<string, unknown> | null>
    list(transactionId: string): Promise<Array<{ stepId: string, data: Record<string, unknown> }>>
    delete(transactionId: string): Promise<void>
  }
  ```
  - `save(transactionId, stepId, data)` : persiste le checkpoint d'un step. La cle de stockage interne est `{transactionId}:{stepId}` (detail d'implementation de l'adapter, pas du port). Le `action` (invoke/compensate) est encode dans le `data` payload, pas dans la cle — ceci simplifie l'interface. Les tests WS-01/WS-02 utilisent cette signature.
  - **transactionId vs workflowId — distinction explicite** : `transactionId` est l'identifiant unique d'un **run** de workflow (genere par `run()`, ou derive de `idempotencyKey` via `deriveWorkflowTransactionId()`). `workflowId` est l'identifiant du **type** de workflow (ex: `"create-order"`). Le port `IWorkflowStoragePort` ne connait PAS le `workflowId` — il ne manipule que des `transactionId`. La relation `workflowId → transactionId` est geree par `IWorkflowEnginePort` (qui passe le `transactionId` au storage). Chaque `transactionId` est unique a un seul workflow run — il n'y a pas d'ambiguite. Pour les **workflows imbriques** (SPEC-029) : chaque sous-workflow recoit son propre `transactionId` distinct du parent. `load(transactionId)` retourne toujours les checkpoints d'un seul workflow run, jamais de workflows differents.
  - `load(transactionId, stepId?)` : si `stepId` fourni, retourne le checkpoint de ce step. Si omis, retourne le checkpoint complet du workflow (merge de tous les steps). Retourne `null` si inexistant.
  - La cle composite `{transactionId}:{stepId}:{action}` mentionnee dans le texte est le format interne du storage SQL. Le port expose une interface simplifiee — l'adapter traduit.
- **Strategie de merge concurrent** : les steps paralleles ecrivent chacun leur checkpoint sous une cle distincte (`{transactionId}:{stepId}`). Il n'y a PAS de conflit d'ecriture entre steps — chaque step ecrit dans sa propre cle. Le merge est un simple assemblage des checkpoints par stepId. En cas de write concurrent sur la MEME cle (retry d'un step timeout), la strategie est **last-write-wins** avec `updated_at` timestamp. Pas de VClocks, pas de Lamport timestamps — c'est overkill pour ce use case ou le meme step ne peut etre execute qu'une fois simultanement (idempotency key).
- **Reprise sur checkpoint apres crash — contrat complet** :
  - Quand un workflow reprend depuis un checkpoint, les steps deja marques `DONE` dans le storage NE SONT PAS re-executes. Le workflow engine lit le checkpoint, restaure le resultat sauvegarde du step, et continue a partir du step suivant. Le step `DONE` recoit son resultat depuis le storage (pas de re-execution).
  - **Side-effects des steps deja completes** : si un step A a emis des events groupes avant le crash, et que A est marque `DONE` dans le checkpoint, les events groupes de A sont dans un etat indetermine :
    - Si le crash a eu lieu AVANT que le workflow engine n'ait appele `releaseGroupedEvents()` → les events sont dans le buffer de l'event bus. En in-memory, ils sont perdus (process mort). En Vercel Queues, les events n'ont PAS ete publies (la release n'a pas eu lieu) — ils sont perdus aussi (le buffer est in-memory dans l'adapter).
    - Les grouped events sont un mecanisme **transactionnel** : ils ne sont publies qu'au succes final du workflow. Un crash avant la completion = events perdus = comportement attendu (fail-safe).
    - Au redemarrage, le workflow engine relance le workflow depuis le checkpoint. Les steps `DONE` ne sont pas re-executes et ne re-emettent PAS leurs events groupes — ces events sont definitivement perdus. Seuls les steps non-completes, executes au redemarrage, emettent de nouveaux events groupes. Au `releaseGroupedEvents()` final, seuls les events des steps executes dans ce run sont publies.
    - **Consequence pour l'idempotence** : si le workflow complete au redemarrage, `releaseGroupedEvents()` publie uniquement les events des steps executes au redemarrage (pas ceux du run precedent). Les events des steps completes avant le crash sont perdus. Le subscriber doit etre idempotent (`makeIdempotent()`) pour tolerer les re-deliveries si le meme workflow est relance avec le meme `transactionId`.
  - **TTL des grouped events (600s)** : si le crash dure plus de 600s (10 min), le TTL expire les events groupes dans le buffer. Au redemarrage, le buffer est vide. Le workflow re-execute les steps non-completes et re-emet de nouveaux events groupes. Le TTL protege contre l'accumulation de messages orphelins.
  - **W-04 (Conformance Suite) — precision** : le test verifie que (1) le step A n'est PAS re-execute au redemarrage, (2) le resultat de A est lu depuis le storage, (3) le step B (non-complete) est execute normalement. W-04 teste le checkpoint, pas les events.
  - **W-15 (Conformance Suite) — precision** : le test verifie explicitement que les events groupes des steps DONE ne sont PAS re-emis au redemarrage. C'est un test complementaire a W-04 qui se concentre specifiquement sur le comportement des grouped events apres recovery. Le comportement teste (events perdus pour steps DONE) est le fail-safe intentionnel decrit ci-dessus.
- **Serialisation des checkpoints — types problematiques** : les checkpoints sont serialises en JSON via `JSON.stringify()`. Certains types JavaScript ne sont PAS serialisables nativement :
  - `Date` → string ISO 8601 (perte du type Date, mais valeur preservee — le step suivant recoit un string, pas un Date)
  - `BigInt` → **erreur** (`TypeError: Do not know how to serialize a BigInt`). Le framework wrape `JSON.stringify()` avec un replacer qui convertit BigInt en `{ __type: 'BigInt', value: string }` et un reviver symetrique au `JSON.parse()`. Ce mecanisme est interne au `IWorkflowStoragePort`, PAS au code metier.
  - `Map`, `Set` → `{}` / `[]` vide. **Interdit** dans les retours de steps. Le framework leve `MantaError(INVALID_DATA, 'Step result contains non-serializable type: Map/Set. Use plain objects/arrays.')` au moment du `save()` du checkpoint.
  - `Buffer` / `Uint8Array` → perte de donnees. **Interdit** dans les retours de steps. Meme erreur que Map/Set.
  - `undefined` → omis par JSON.stringify. Comportement standard JavaScript, pas un bug.
  - **Validation au save** : le workflow engine appelle `validateSerializability(result)` avant `IWorkflowStoragePort.save()`. Cette fonction verifie recursivement que le resultat ne contient que des types JSON-safe (string, number, boolean, null, plain object, array) + BigInt (converti). Les types interdits levent une erreur immediate avec le path du champ problematique.
- Garanties : sauvegarde avec backoff exponentiel. Validation de serialisabilite JSON au save (pas de perte silencieuse). Le storage doit etre durable en production. Les tests d'integration sont deterministes car chaque step ecrit dans sa propre cle.
- Schema isolation : les donnees workflow sont stockees dans un schema SQL separe (`workflow`) distinct du schema applicatif (`app`). Meme DB, isolation logique. Permet une migration future vers un storage dedie sans changer le code.

**SPEC-021 : createWorkflow / createStep / StepResponse DSL**
- Contrat : DSL declaratif pour definir des workflows.
- Methodes : `createStep(name, invoke, compensate?)`, `createWorkflow(name, fn)`, `StepResponse` avec `permanentFailure()` et `skip()`.
- Garanties : les steps sont chaines par reference de retour avec proxy pattern pour acces aux proprietes.

**SPEC-022 : transform() pour transformations de donnees entre steps**
- Contrat : transforme les donnees entre steps sans creer de step.
- Garanties : supporte jusqu'a 7 fonctions pipees. Resultats caches dans le storage temporaire.

**SPEC-023 : when/then pour execution conditionnelle de steps**
- Contrat : `when(name, input, condition).then(() => step())` execute un step conditionnellement.
- Garanties : si false, le step est skip et retourne undefined.

**SPEC-024 : parallelize() pour execution parallele de steps**
- Contrat : marque des steps pour execution parallele. Resultats retournes en tuple type.
- Garanties : en cas d'echec d'un step, TOUS les steps paralleles (meme reussis) sont compenses.
- **Echecs paralleles simultanes** : quand plusieurs steps paralleles echouent simultanement, le workflow engine **attend que TOUS les steps paralleles aient termine** (succes ou echec) avant de declencher la compensation. Le premier echec ne coupe PAS les autres steps — ils continuent jusqu'a completion. Raison : interrompre un step en cours est impossible (pas de cancellation token), et les resultats des steps reussis sont necessaires pour leur compensation. Apres resolution de tous les steps, le workflow engine collecte tous les echecs dans un tableau `{ failedSteps: [{ stepId, error }] }` et declenche la compensation de tous les steps (reussis et echoues) dans l'ordre inverse. Le `transactionId` de compensation est `{originalTransactionId}:compensate`. L'`idempotencyKey` de chaque step de compensation est `{workflowId}:{transactionId}:{stepId}:compensate` — deterministe, pas affecte par le nombre d'echecs.
- **Echec de compensation pendant le rollback parallele** :
  - Si la compensation d'un step parallele echoue elle-meme, le workflow engine **continue a compenser les autres steps** (best-effort). Il ne s'arrete PAS au premier echec de compensation.
  - Apres avoir tente de compenser tous les steps paralleles, si au moins une compensation a echoue, le workflow entre dans l'etat **`FAILED`** (pas `REVERTED`). Le `FAILED` indique un etat potentiellement inconsistant.
  - La compensation echouee est retryee selon les regles du step (SPEC-025 : `maxRetries`, `retryInterval`). Les retries s'appliquent aussi aux compensations, pas seulement aux invocations.
  - Si les retries de compensation sont epuises, le step est marque `COMPENSATION_FAILED` dans le checkpoint. Le workflow est marque `FAILED` avec un detail `{ failedCompensations: [{ stepId, error }] }`.
  - **Pas de retry automatique du workflow entier** : un workflow en `FAILED` avec `COMPENSATION_FAILED` reste en `FAILED` indefiniment. Le dev doit intervenir manuellement (via `manta exec` ou un handler custom). Le framework log un `error` avec le detail des compensations echouees.
  - **Raison de ce design** : une compensation qui echoue signifie generalement un probleme externe (service tiers down, DB corrompue). Retenter automatiquement le workflow complet risque d'aggraver l'inconsistance. L'intervention humaine est preferable.
- **IMessageAggregator dans les steps paralleles — merge explicite** :
  - Chaque step parallele a son propre scope (via `container.createScope()`) et donc son propre `IMessageAggregator` SCOPED. Les steps paralleles n'ecrivent PAS dans le meme buffer.
  - Le workflow engine est responsable du merge : apres que TOUS les steps paralleles ont termine (succes), le engine collecte les messages de chaque `StepExecutionContext.container.resolve('IMessageAggregator').getMessages()` et les concatene dans le groupe partage (meme `eventGroupId`).
  - L'ordre de concatenation suit l'ordre de completion des steps (pas l'ordre de declaration dans `parallelize()`). Cet ordre n'est PAS garanti deterministe — les subscribers ne doivent pas dependre de l'ordre des events au sein d'un meme groupe.
  - Apres le merge, le engine appelle `clearMessages()` sur chaque IMessageAggregator des steps. Les messages sont maintenant dans le buffer global du groupe (gere par `IEventBusPort`).
  - En cas d'echec d'un step parallele : le engine appelle `clearMessages()` sur TOUS les IMessageAggregator des steps paralleles (reussis et echoues). Pas de merge, pas de release.
  - Consequence : un subscriber qui recoit les events d'un workflow avec steps paralleles voit tous les events dans un seul `releaseGroupedEvents()`, sans savoir de quel step parallele chaque event provient.

**SPEC-025 : Steps retryables avec maxRetries et backoff**
- Contrat : chaque step supporte `maxRetries`, `retryInterval`, `timeout`.
- Garanties : l'attempt number est disponible dans `context.metadata.attempt`. `permanentFailure()` arrete les retries immediatement.
- **Erreurs reseau dans les steps — convention de mapping** : quand un step appelle un service externe (HTTP API tierce, microservice) et recoit une erreur reseau, le step DOIT la mapper en MantaError avant de la propager :
  - HTTP 4xx (client error) → `permanentFailure(new MantaError(INVALID_DATA, message))` — pas de retry, compensation immediate.
  - HTTP 5xx (server error) → `throw new MantaError(UNEXPECTED_STATE, message)` — retriable par le workflow engine selon `maxRetries`.
  - HTTP 429 (rate limited) → `throw new MantaError(CONFLICT, message)` — retriable, le backoff du step devrait laisser le temps au rate limit de se reset.
  - Timeout reseau (ETIMEDOUT, ECONNRESET) → `throw new MantaError(UNEXPECTED_STATE, 'External service timeout: {url}')` — retriable.
  - DNS failure (ENOTFOUND) → `permanentFailure(new MantaError(INVALID_STATE, 'Service unreachable: {host}'))` — pas de retry (config error).
  - Le framework fournit `mapExternalError(error: Error, context?: string) -> MantaError` comme utilitaire pour standardiser ce mapping. Le dev peut l'overrider par step. Si un step throw une erreur non-MantaError, le workflow engine la wrape en `MantaError(UNEXPECTED_STATE, error.message)` automatiquement — mais la compensation est declenchee dans tous les cas.

**SPEC-026 : Async steps et background execution**
- Contrat : steps `async:true` suspendent la transaction. Completion via `registerStepSuccess/Failure`. Steps `backgroundExecution` sont fire-and-forget.
- Garanties : pattern naturel pour serverless (webhook callbacks). `noWait` permet le pipeline asynchrone.

**SPEC-027 : Idempotency via transactionId et IdempotencyKeyParts**
- Contrat : chaque transaction a un transactionId unique comme cle d'idempotence.
- Garanties : `IdempotencyKeyParts` combine workflowId, transactionId, stepId, action. Crucial pour serverless ou les retries sont frequents.
- **Subscriber qui lance un workflow — contrat de transactionId** :
  - Quand un subscriber recoit un event et lance un workflow (ex: `order.created` → `processOrderWorkflow`), le `transactionId` DOIT etre derive du `idempotencyKey` du message, PAS genere aleatoirement. Pattern impose :
    ```typescript
    // CORRECT — idempotent
    const txId = `${workflowId}:${event.metadata.idempotencyKey}`
    await engine.run(workflowId, { transactionId: txId, input: event.data })

    // INCORRECT — chaque retry cree un nouveau workflow
    await engine.run(workflowId, { input: event.data }) // transactionId auto-genere
    ```
  - **Comportement au retry bus** : si le subscriber throw et le message est re-livre par la queue, le subscriber re-appelle `engine.run()` avec le MEME `transactionId` (derive du meme `idempotencyKey`). Le workflow engine detecte qu'un workflow avec ce `transactionId` existe deja dans `IWorkflowStoragePort` → il **reprend depuis le checkpoint** au lieu de repartir de zero.
  - **Framework enforcement** : le framework fournit un utilitaire `deriveWorkflowTransactionId(workflowId, event)` qui derive le `transactionId` depuis l'event. **Algorithme** : simple template string `${workflowId}:${event.metadata.idempotencyKey}`. C'est une concatenation deterministe, PAS un hash (UUID v5) — la lisibilite prime sur l'opacite. Le resultat est utilisable comme cle dans `IWorkflowStoragePort`. Exemples : `"processOrder:evt_abc123"`, `"syncInventory:evt_def456"`. Si `event.metadata.idempotencyKey` est absent (champ optionnel — SPEC-034), `deriveWorkflowTransactionId()` genere un UUID aleatoire comme fallback et log un **warning** : `Warning: Event "{eventName}" has no idempotencyKey. Generated random transactionId — retries will create duplicate workflows.` Le dev DOIT s'assurer que les events critiques ont un `idempotencyKey`. Le framework log un **warning** au boot si un subscriber lance un workflow sans `transactionId` explicite et que l'event bus est en mode at-least-once : `Warning: Subscriber "{name}" launches workflow "{workflowId}" without explicit transactionId. In at-least-once mode, retries will create duplicate workflows. Use deriveWorkflowTransactionId().`
  - **Subscriber sans workflow** : ce contrat ne s'applique qu'aux subscribers qui lancent des workflows. Les subscribers qui font des operations simples (update DB, send notification) gerent leur idempotence via `makeIdempotent()` (SPEC-034).

**SPEC-028 : createHook() pour points d'extension des workflows**
- Contrat : cree des points d'extension nommes dans les workflows. Un seul handler par hook.
- Garanties : validation optionnelle du input via schemas Zod. Default = noop step.

**SPEC-029 : runAsStep pour composition de workflows imbriques**
- Contrat : les workflows peuvent etre embarques comme steps dans d'autres workflows.
- Garanties : support async via le workflow engine.

**SPEC-030 : OrchestratorBuilder pour construction du graphe de steps**
- Contrat : builder pattern fluent pour construire et muter le DAG de steps.
- Methodes : `addAction`, `replaceAction`, `insertActionBefore/After`, `appendAction`, `moveAction`, `mergeActions` (parallelisme), `deleteAction`, `pruneAction`, `build()`

**SPEC-031 : DistributedTransactionEvent callbacks pour monitoring**
- Contrat : events de lifecycle complets : RESUME, BEGIN, COMPENSATE_BEGIN, FINISH, TIMEOUT, STEP_BEGIN, STEP_SUCCESS, STEP_FAILURE, etc.
- Garanties : hooks de tracing statiques pour observabilite.

**SPEC-032 : WorkflowManager registre global avec deduplication**
- Contrat : registre statique global pour les definitions de workflows.
- Garanties : re-registration identique est idempotente. Definition differente avec meme ID = erreur.

**SPEC-033 : Hierarchie d'erreurs specialisees pour les transactions**
- Contrat : types d'erreur specialises : `PermanentStepFailureError`, `SkipStepResponse`, `TransactionStepTimeoutError`, `TransactionTimeoutError`, `NonSerializableCheckPointError`, etc.

**SPEC-075 : Utility retryExecution avec backoff configurable**
- Contrat : utilitaire generique de retry : maxRetries, retryDelay (nombre ou fonction backoff), shouldRetry (predicate).

---

### 4. Event System

#### Port : IEventBusPort

**SPEC-034 : IEventBusPort avec grouped events et interceptors**
- Contrat : interface pour l'emission et la souscription d'events domaine.
- Methodes : `emit(event | event[], options?)`, `subscribe(eventName, handler, options)`, `unsubscribe(subscriberId)`, `releaseGroupedEvents(eventGroupId)`, `clearGroupedEvents(eventGroupId)`, `addInterceptor(fn)`, `removeInterceptor(fn)`
- **Grouped events — responsabilite et lifecycle** :
  - Les events emis avec `metadata.eventGroupId` sont retenus (staging) et ne sont PAS publies immediatement.
  - **Le workflow engine est responsable** d'appeler `releaseGroupedEvents(eventGroupId)` en cas de succes et `clearGroupedEvents(eventGroupId)` en cas d'echec. Le dev ne doit PAS gerer ceci manuellement sauf cas avances.
  - **Heritage de l'eventGroupId dans les services appeles** : quand un workflow step appelle un service qui utilise `@EmitEvents()`, le service herite l'`eventGroupId` du `Context` (SPEC-060) du step. Les events emis par le service sont donc ajoutes au MEME groupe que le workflow. C'est le comportement voulu — le workflow controle le commit/rollback de TOUS les events emis pendant son execution, y compris ceux des services internes. Si un service ouvre une transaction via `@InjectTransactionManager()`, il partage le meme `Context` (et donc le meme `eventGroupId`). Concretement : un step "creer commande" qui appelle `productService.update()` (qui emet "product.updated") → l'event "product.updated" est dans le meme groupe que les events du step. Au `releaseGroupedEvents()`, les deux sont publies ensemble. Ce comportement est explicite : le `Context.eventGroupId` propage naturellement par reference. Pour emettre un event HORS du groupe (rare), le service doit creer un `Context` sans `eventGroupId` explicitement.
  - TTL de retention : les events groupes ont un TTL configurable (defaut 600s / 10 minutes). Si le process meurt sans appeler release/clear (crash Lambda, timeout), les events expirent automatiquement via TTL. **En serverless, les events groupes sont perdus apres TTL — c'est le comportement attendu (fail-safe).**
  - **Limite de groupes actifs simultanes (serverless warm)** : en serverless warm, le process persiste entre invocations. Chaque requete concurrente peut creer un grouped event avec setTimeout TTL. Pour eviter une fuite memoire (N requetes concurrentes → N setTimeouts actifs), l'adapter in-memory DOIT implementer une limite configurable de groupes actifs simultanes : `maxActiveGroups` (defaut 10000). Si la limite est atteinte, le nouveau `emit({ groupId })` leve `MantaError(RESOURCE_EXHAUSTED, 'Too many active event groups (${maxActiveGroups}). Possible leak — check that releaseGroupedEvents/clearGroupedEvents are called.')`. En production (Vercel Queues), les grouped events sont aussi bufferises in-memory dans l'adapter — la meme limite s'applique. Le test E-13 verifie ce comportement (`emit > maxActiveGroups depasse`).
  - **`clearGroupedEvents()` vs queue durable — contrat explicite** :
    - Les events groupes sont **bufferises en memoire** dans l'adapter event bus (que ce soit in-memory ou Vercel Queues). Ils ne sont PAS publies dans la queue tant que `releaseGroupedEvents()` n'a pas ete appele. `clearGroupedEvents()` supprime les events du buffer in-memory — ils n'ont jamais touche la queue.
    - Concretement : `emit(event, { groupId })` stocke l'event dans une `Map<groupId, Message[]>` en memoire dans l'adapter. `release()` publie tous les events du groupe dans la queue durable. `clear()` vide la Map pour ce groupId.
    - Il n'y a PAS de message dans la queue a supprimer — les events groupes ne sont publies qu'au `release()`. C'est le pattern staging/commit : les events sont staged en memoire, puis committed (release) ou rollbacked (clear).
    - **Consequence** : il est impossible qu'un event "annule" via `clear()` soit delivre a un subscriber. Les events n'existent dans la queue qu'apres `release()`. Le probleme decrit (supprimer un message deja enqueue) ne se pose pas par design.
  - Pour workflows long-running (>10 min) : le dev doit configurer un TTL plus eleve via `options.groupedEventsTTL`.
  - L'adapter in-memory (dev) DOIT implementer le TTL via `setTimeout()`. Raison : sans TTL en dev, le test E-06 (`grouped > TTL expiration`) ne peut pas passer, et le dev decouvre le comportement TTL uniquement en production — c'est exactement le type de divergence dev/prod que le framework cherche a eviter. L'implementation est triviale (setTimeout + Map.delete au timeout). En revanche, le TTL in-memory est approximatif (precision setTimeout ~1-10ms) vs le TTL cache durable (precision serveur) — ce qui est acceptable pour les tests.
- **Type Message\<T\>** (definition complete) :
  ```typescript
  interface Message<T = unknown> {
    eventName: string                      // nom de l'event (ex: 'product.created')
    data: T                                // payload de l'event — convention : `{ id }` uniquement (SPEC-059c)
    metadata: {
      auth_context?: AuthContext           // contexte auth de l'emetteur (SPEC-049)
      eventGroupId?: string                // ID du groupe (workflows)
      transactionId?: string               // ID de la transaction workflow
      timestamp: number                    // epoch ms de l'emission
      idempotencyKey?: string              // cle d'idempotence pour deduplication
      source?: string                      // module emetteur (ex: 'product')
    }
  }
  ```
  - Le meme type est utilise pour les interceptors, les subscribers, et la serialisation queue. L'adapter queue serialise `Message<T>` en JSON pour la persistence.
- **Interceptors — contrat** :
  - Signature : `(message: Message<T>, context?: { isGrouped?: boolean, eventGroupId?: string }) => Promise<void> | void`
  - Les interceptors sont des **observateurs read-only**. Ils recoivent chaque event avant emission (grouped ou non).
  - Un interceptor **ne peut PAS bloquer** l'emission ni **modifier** l'event. Les erreurs dans un interceptor sont loguees et ignorees.
  - L'execution est **fire-and-forget** — le bus n'attend pas la completion des interceptors.
  - Cas d'usage : logging, audit trail, metriques, tracing.
- **Idempotence des subscribers (recommandation framework)** : en at-least-once (production), un subscriber peut etre appele plusieurs fois pour le meme event. Le framework fournit un utilitaire `makeIdempotent(handler, options?)` qui wrape un subscriber pour garantir l'idempotence :
  - Signature : `makeIdempotent(handler: SubscriberHandler, options?: { keyFn?: (event) => string, ttl?: number }) -> SubscriberHandler`
  - Par defaut : la cle d'idempotence est `${eventName}:${event.data.id}`. Configurable via `keyFn`.
  - Stockage : via `ICachePort` avec TTL (defaut 24h). Si la cle existe, le handler est skip.
  - Le framework log un warning au boot si un subscriber n'est PAS wrape avec `makeIdempotent()` et que l'event bus est en mode at-least-once. Ce n'est PAS une erreur — le dev peut choisir de gerer l'idempotence autrement (ou d'avoir un handler idempotent par nature).
- **Contrat du trigger queue — livraison et retry des subscribers** :
  - **Format du message queue** : chaque message dans la queue (Vercel Queues, SQS) est un JSON : `{ eventName: string, data: unknown, metadata: { auth_context?: AuthContext, eventGroupId?: string, transactionId?: string, timestamp: number, idempotencyKey?: string } }`. L'adapter queue deserialise ce JSON et appelle le subscriber correspondant.
  - **Mapping queue → subscriber** : l'adapter queue (ex: `VercelQueueAdapter`) recoit un message, extrait `eventName`, cherche les subscribers enregistres pour cet event, et appelle chaque subscriber avec `{ data, metadata }`. C'est le meme mecanisme que l'adapter in-memory, mais avec persistance.
  - **Retry cote bus vs retry cote workflow** — distinction claire :
    - **Retry bus** : si un subscriber throw, le MESSAGE retourne dans la queue (at-least-once). L'adapter queue ne fait PAS de retry local — c'est la queue elle-meme qui re-delivre le message apres un delai (configurable par la queue : Vercel Queues = 30s default, SQS = visibility timeout). Le nombre de retries est configure sur la QUEUE (maxReceiveCount sur SQS, maxRetries sur Vercel Queues).
    - **Retry workflow** : les retries de steps dans un workflow (SPEC-025) sont geres par le workflow engine, PAS par le bus. Un step qui echoue est retente par l'orchestrateur, pas par le bus d'events.
    - Ce sont deux niveaux de retry independants. Un subscriber dans un workflow step beneficie des DEUX : retry du step (workflow engine) ET retry du message (queue) si le step echoue definitivement.
  - **Erreur retriable vs permanente pour les subscribers** :
    - Par defaut, toute erreur throw par un subscriber est consideree **retriable** — le message repart dans la queue.
    - Pour signaler une erreur **permanente** (pas de retry, DLQ directe), le subscriber utilise `permanentSubscriberFailure(error)`. L'adapter queue detecte cette erreur (instanceof `PermanentSubscriberError`) et ne re-queue PAS le message — il l'envoie directement en DLQ (Dead Letter Queue).
    - **DLQ et grouped events** : un message en DLQ provenant d'un grouped event a deja ete libere (release a eu lieu avant la livraison au subscriber). L'`eventGroupId` dans `metadata` est **informatif** (audit trail), pas fonctionnel au moment du re-processing depuis la DLQ. Le subscriber qui re-traite le message le traite comme un event standalone — le groupe est termine. Le framework ne tente PAS de reconstruire le contexte du groupe.
    - `permanentSubscriberFailure(error: Error) -> PermanentSubscriberError` : utilitaire framework, symetrique avec `permanentFailure()` des workflow steps. C'est la **seule** maniere de signaler une erreur permanente. Un `MantaError(NOT_ALLOWED)` throw directement est traite comme **retriable** (comportement par defaut). La distinction se fait par le type de l'erreur (`PermanentSubscriberError` = permanent, tout le reste = retriable), PAS par le code MantaError. Raison : un `NOT_ALLOWED` peut etre throw involontairement par un service interne — le traiter comme permanent risque de perdre des messages. Le dev doit wraper explicitement avec `permanentSubscriberFailure()` pour confirmer l'intention.
    - Les adapters queue DOIVENT implementer cette distinction. L'adapter in-memory (dev) n'a pas de DLQ — il log l'erreur et continue.
    - **DLQ non-configuree en production** : si l'adapter queue detecte un `PermanentSubscriberError` et que la DLQ n'est pas configuree (ex: Vercel Queues sans DLQ setup), le comportement est : (1) le message est acknowledge (supprime de la queue principale — pas de re-delivery infinie), (2) l'adapter log un `error` avec le payload complet et le message d'erreur, (3) un event framework `manta.subscriber.permanent_failure` est emis (fire-and-forget) avec le detail pour alerting. La DLQ n'est PAS un prerequis — elle est recommandee mais le framework fonctionne sans. Le dev perd la possibilite de re-traiter les messages echoues, mais le systeme ne se bloque pas.
  - **Acknowledge** : le subscriber a termine quand sa fonction retourne (resolve). Si le subscriber throw, le message n'est PAS acknowledge → la queue le re-delivre. C'est le contrat standard at-least-once.
- **Ordre d'appel des subscribers — contrat tranche** : l'ordre d'appel des subscribers pour le meme event n'est **PAS un contrat du port**. C'est un detail d'implementation de l'adapter. Le port IEventBusPort garantit uniquement que TOUS les subscribers enregistres seront appeles, pas dans quel ordre.
  - En in-memory (dev) : l'appel est **concurrentiel** (`Promise.all()` sur tous les subscribers). L'ordre de completion depend du temps d'execution de chaque subscriber. L'adapter in-memory NE DOIT PAS etre sequentiel — ceci evite que les devs ecrivent des tests qui dependent implicitement de l'ordre et qui echouent en production.
  - En production (queue) : chaque subscriber recoit le message independamment via la queue. L'ordre n'est pas garanti.
  - **Regle pour les tests** : les assertions doivent porter sur les side-effects individuels, pas sur leur sequence. Un test qui verifie "subscriber A s'execute avant subscriber B" est un bug de test — il passera en dev mais echouera en prod.
  - **Assertions temporelles** : les assertions sur le timing (ex: "le workflow demarre dans les 100ms apres l'event") DOIVENT etre dans les tests e2e uniquement, PAS dans les tests unitaires. En in-memory, le subscriber est appele immediatement (< 1ms). En production (Vercel Queues), la latence est de 30-500ms. Un test unitaire avec assertion temporelle passera en dev et echouera en prod. Les tests unitaires verifient que le subscriber EST appele (existence), pas QUAND (timing).
  - **Si un subscriber depend du resultat d'un autre** : utiliser un workflow (orchestration explicite) au lieu de deux subscribers sur le meme event. Les subscribers sont conçus pour des side-effects independants.
- **Observabilite des grouped events** :
  - **Probleme** : les grouped events sont bufferises in-memory (staging). Si le process crash avant `release()` ou si le TTL expire, les events disparaissent silencieusement. Il n'y a aucune trace de leur existence.
  - **Solution — hooks d'observabilite sur le lifecycle des grouped events** :
    - `IEventBusPort.onGroupCreated(handler: (eventGroupId: string, eventCount: number) => void)` : appele quand un premier event est ajoute a un nouveau groupe.
    - `IEventBusPort.onGroupReleased(handler: (eventGroupId: string, eventCount: number) => void)` : appele quand `releaseGroupedEvents()` publie les events du groupe.
    - `IEventBusPort.onGroupCleared(handler: (eventGroupId: string, eventCount: number, reason: 'explicit' | 'ttl') => void)` : appele quand `clearGroupedEvents()` supprime les events (rollback workflow) OU quand le TTL expire (`reason: 'ttl'`).
    - Ces hooks sont **optionnels** — si aucun hook n'est enregistre, zero overhead. Ils sont conçus pour le tracing (ITracerPort) et les metriques, pas pour la logique metier.
  - **`getGroupStatus(eventGroupId)`** : methode optionnelle pour inspecter un groupe en cours :
    ```typescript
    getGroupStatus(eventGroupId: string): { exists: boolean, eventCount: number, createdAt: number, ttlRemainingMs?: number } | null
    ```
    Retourne `null` si le groupe n'existe pas (deja release, clear, ou jamais cree). Utile pour le debug et le dev tooling.
  - **Metriques recommandees** : l'adapter de production (Vercel Queues) DEVRAIT emettre des metriques sur : nombre de groupes crees, nombre de groupes released vs cleared vs TTL-expired, temps moyen de retention d'un groupe. Via les hooks ci-dessus + ITracerPort.
  - **Interceptors et grouped events** : les interceptors (SPEC-034) sont appeles sur chaque event APRES `release()`, pas au moment du `emit()` avec `eventGroupId`. Les interceptors ne voient jamais les events d'un groupe non-release. Ceci est coherent — les interceptors observent les events publies, pas les events en staging.
- Garanties : deduplication par subscriberId. Le port definit le contrat, l'adapter garantit la delivrance.

**SPEC-035 : Subscriber auto-discovery depuis le filesystem**
- Contrat : scan des directories de subscribers, validation du default export (handler function) et config.event.
- Garanties : subscriberId infere de config.context.subscriberId > handler.name > filename. Multi-events par subscriber.

**SPEC-036 : Release/clear d'events groupes au completion de workflow**
- Contrat : events groupes par eventGroupId retenus jusqu'a completion du workflow.
- Garanties : succes -> `releaseGroupedEvents`. Echec -> `clearGroupedEvents`. Les events ne sont publies qu'en cas de succes.

---

### 5. HTTP Layer

#### Port : IHttpPort

> Note : le framework utilise les Web Standards Request/Response. L'adapter traduit depuis/vers le runtime cible (Nitro, Next.js Route Handlers, Express, Hono, etc.). L'adapter principal est Nitro (serveur universel H3/unjs) qui supporte nativement les presets Vercel, Node, Cloudflare, Deno, Bun.

**SPEC-037 : Filesystem-based routing avec convention [param]**
- Contrat : fichiers `route.ts` dans une arborescence. Le path du fichier devient l'URL (`[param]` -> parametres dynamiques). Les exports HTTP (GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD) deviennent des handlers.
- Garanties : detection des parametres dupliques. Les dossiers `_prefixed` sont ignores. L'arbre de routes peut etre pre-built au build time.

**SPEC-038 : Trois namespaces : /admin, /store, /auth avec politiques distinctes**
- Contrat : chaque namespace a ses propres politiques d'auth, CORS et middleware.
- Garanties : /admin (actor_type user, auth bearer+session+api-key), /store (actor_type customer, auth bearer+session, publishable key required), /auth (CORS only).

**SPEC-039 : defineMiddlewares declaratif avec pipeline ordonne**
- Contrat : `defineMiddlewares()` declare middleware custom, body parser config, Zod validators, RBAC policies, error handler custom par matcher/method.
- **Pipeline d'execution garanti** — l'ordre suivant est un contrat du port IHttpPort. Chaque adapter DOIT respecter cette sequence. Le pipeline a toujours **12 etapes** (si le rate limiting est desactive, l'etape 3 est un no-op pass-through — le nombre d'etapes reste 12) :
  1. **RequestID** : genere ou propage `x-request-id` (SPEC-047)
  2. **CORS** : applique les headers CORS par namespace (SPEC-038)
  3. **RateLimit** : verifie le rate limit via ICachePort (SPEC-039b). **Quand le rate limiting est desactive** : l'etape est un **no-op pass-through**. L'etape n'est PAS supprimee — le pipeline a toujours 12 etapes. Rejette avec 429 avant de creer un scope (economie de ressources).
  4. **Scope** : cree un scoped container via `container.createScope()` et l'attache au contexte
  5. **BodyParser** : parse le body selon content-type (configurable par route via defineMiddlewares)
  6. **Auth** : extrait les credentials (trigger-specific) et les passe a `IAuthGateway.authenticate(credentials)` (SPEC-049b) qui encapsule la decision Bearer vs Session vs API Key et retourne un `AuthContext | null`. Enregistre l'`AuthContext` dans le scoped container sous la cle `AUTH_CONTEXT` (lifetime SCOPED). Tout service dans le scope peut faire `container.resolve('AUTH_CONTEXT')` pour obtenir l'AuthContext de la requete courante. Le handler recoit aussi `ctx.auth` comme raccourci. **Propagation inter-services** : quand un service appelle un autre service, les deux sont resolus depuis le meme scoped container (via AsyncLocalStorage, SPEC-001). L'AuthContext est donc automatiquement accessible sans le passer en parametre. Pour les appels cross-scope (ex: un workflow step), l'AuthContext est explicitement propage via le `Context` (SPEC-060) et re-enregistre dans le scope du step
  7. **PublishableKey** : valide `x-publishable-api-key` pour les routes /store (SPEC-046)
  8. **Validation** : valide body/query via Zod schemas declares dans defineMiddlewares (SPEC-043)
  9. **Custom middlewares** : execute les middlewares declares par le dev dans `defineMiddlewares()`, dans l'ordre de declaration
  10. **RBAC** : verifie les permissions via `wrapWithPoliciesCheck` si feature flag `rbac` actif (SPEC-051). **Quand le flag `rbac` est desactive** : l'etape existe dans le pipeline mais est un **no-op pass-through** (le middleware est enregistre, il ne fait rien). L'etape n'est PAS supprimee du pipeline — ceci garantit que le nombre et l'ordre des etapes sont toujours 12, quel que soit la configuration. Les tests peuvent verifier que l'etape 10 existe et est un no-op quand le flag est off.
  11. **Handler** : execute le handler de route
  12. **ErrorHandler** : attrape les erreurs et les mappe vers HTTP status (SPEC-041)
- Les etapes 1-4 sont executees pour TOUTES les requetes. Les etapes 5+ sont executees selon la route matchee.
- Un middleware custom (etape 8) peut court-circuiter le pipeline en retournant une reponse directement.
- Garanties : configuration declarative traitee au startup. L'ordre est identique quel que soit l'adapter HTTP (Nitro, Next.js, etc.).

**SPEC-039b : Rate limiting — contrat framework**
- Contrat : le framework fournit un middleware de rate limiting configurable via `defineMiddlewares()` et `defineConfig()`.
- **Configuration globale** : `defineConfig({ http: { rateLimit: { enabled: true, windowMs: 60_000, maxRequests: 100, keyFn: (req) => req.ip } } })`. Desactive par defaut (opt-in).
- **Configuration par namespace** :
  - `/store` : rate limit recommande (routes publiques, risque d'abus). Defaut quand active : 100 req/min par IP.
  - `/admin` : rate limit optionnel (routes authentifiees). Defaut quand active : 300 req/min par IP.
  - `/auth` : rate limit strict recommande (bruteforce protection). Defaut quand active : 20 req/min par IP pour les routes login/register.
- **Configuration par route** : via `defineMiddlewares()` :
  ```typescript
  defineMiddlewares([{
    matcher: "/store/products",
    rateLimit: { maxRequests: 200, windowMs: 60_000 }
  }])
  ```
- **Implementation** : le rate limiter utilise `ICachePort` pour le compteur (sliding window). L'algorithme exact (fixed window counter, sliding window log, sliding window counter) est un **detail d'adapter** — le framework ne le prescrit pas. L'adapter Upstash utilise le sliding window counter (deux fenetres ponderees) car c'est le meilleur compromis precision/performance pour Redis. L'adapter in-memory peut utiliser un simple fixed window counter. La Conformance Suite teste uniquement le **contrat externe** (N requetes passent, N+1 est rejetee, reset apres window) — PAS les cas aux frontieres de fenetre (qui dependent de l'algorithme). En dev (in-memory cache), le rate limit est per-process. En prod (Upstash Redis), le rate limit est distribue.
- **Comportement quand ICachePort est down** : si le backend cache (Upstash) est indisponible, le rate limiter adopte un comportement **fail-open** — les requetes passent sans rate limiting. Raison : bloquer le trafic parce que le cache est down est pire que laisser passer un burst temporaire. Le framework log un warning `Rate limiter: ICachePort unavailable, fail-open active` a chaque requete (rate-limited a 1 log/10s pour eviter le flood). Ce comportement est configurable : `rateLimit: { failBehavior: 'open' | 'closed' }` (defaut: `'open'`).
- **Reponse en cas de depassement** : HTTP 429 Too Many Requests avec headers `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
- **Cle de rate limiting** : par defaut IP (`req.ip`). Configurable via `keyFn` pour rate-limiter par API key, par user, ou par publishable key.
- **Position dans le pipeline** : le rate limit s'execute a l'**etape 3** du pipeline (apres CORS, avant Scope). Le pipeline a toujours 12 etapes — quand le rate limiting est desactive, l'etape 3 est un no-op pass-through (SPEC-039). C'est un middleware infra, pas applicatif — il doit rejeter AVANT de creer un scope (economie de ressources).
- **Serverless** : sur Vercel, le rate limiting est geographiquement distribue via Upstash Redis Global. Chaque Edge Function partage le meme compteur. Le cout Upstash est < $0.001 par requete verifiee.
- **Alternative infra** : si le dev prefere un rate limiting infra (Vercel WAF, Cloudflare Rate Limiting, Nginx `limit_req`), il desactive le rate limiting framework. Le framework ne force PAS son propre rate limiter.

**SPEC-040 : Route override par plugins et AUTHENTICATE opt-out**
- Contrat : les plugins peuvent surcharger les routes existantes. Export `AUTHENTICATE = false` pour desactiver l'auth. `CORS = false` pour opt-out.

**SPEC-041 : Error handler centralise avec mapping erreur -> HTTP status**
- Contrat : mapping standard des erreurs framework vers les status HTTP.
- Garanties : NOT_FOUND->404, INVALID_DATA->400, UNAUTHORIZED->401, FORBIDDEN->403, DUPLICATE_ERROR->422, CONFLICT->409, DB_ERROR->500. Errors de validation (Zod) formatees. Custom error handler substituable.
- **Format du body HTTP en cas d'erreur — contrat** :
  ```typescript
  interface MantaErrorResponse {
    type: string          // MantaErrorType (ex: 'NOT_FOUND', 'INVALID_DATA')
    message: string       // message humain (ex: 'Order not found')
    code?: string         // code machine optionnel (ex: 'ORDER_NOT_FOUND') — le dev le passe via MantaError(type, message, { code })
    details?: unknown     // details additionnels (ex: Zod validation errors array) — jamais de stack trace en prod
  }
  ```
  - Le body est TOUJOURS du JSON (`Content-Type: application/json`).
  - En `NODE_ENV !== 'production'`, un champ `stack` est ajoute pour le debug. En production, JAMAIS de stack trace dans le body.
  - Les erreurs Zod de validation sont formatees dans `details` : `[{ path: ['items', 0, 'qty'], message: 'Expected number, received string' }]`.
  - Les erreurs non-MantaError (`new Error("oops")`) retournent `{ type: 'UNEXPECTED_STATE', message: 'An unexpected error occurred' }` — pas de leak du message original en prod.

**SPEC-042 : MedusaRequest type enrichi**
- Contrat : le type Request du framework porte : `validatedBody`, `validatedQuery`, `queryConfig` (fields/pagination/withDeleted), `filterableFields`, `scope` (IContainer), `requestId`, `locale`, `restrictedFields`, `additionalDataValidator`, `auth_context`, `publishable_key_context`, `policies`.
- Note : en architecture hexagonale, ce type est construit par l'adapter HTTP a partir du Web Standard Request.

**SPEC-043 : Validation Zod du body et query avec additional_data extensible**
- Contrat : validation via Zod. Le body supporte `additional_data` extensible par plugins via `additionalDataValidator`.
- Garanties : la query est transformee en listConfig/queryConfig avec champs +/- et wildcard *.

**SPEC-044 : RoutesSorter pour tri intelligent des routes**
- Contrat : routes triees par specificite : static > params > regex > wildcard > global.
- Garanties : middlewares custom avant app routes pour le meme path.

**SPEC-046 : Publishable API Key et RestrictedFields pour store routes**
- Contrat : routes /store/* protegees par header `x-publishable-api-key`. RestrictedFields limite les champs accessibles.
- Garanties : locale resolution : query param > header `x-medusa-locale` > store default.

**SPEC-047 : Request ID tracking via x-request-id ou UUID v4**
- Contrat : chaque requete recoit un requestId depuis le header `x-request-id` ou UUID genere.
- Garanties : inclus dans les logs pour correlation. Essentiel pour observabilite serverless.

**SPEC-048 : HMR support pour development**
- Contrat : Hot Module Replacement en dev. Reload in-place des routes, subscribers, jobs, modules.
- Garanties : feature-flaggee. Fallback vers restart complet si HMR echoue. Non pertinent pour production.

**SPEC-071 : Graceful shutdown avec lifecycle teardown**
- Contrat : tracking des connexions actives. Shutdown ordonne : onApplicationPrepareShutdown -> onApplicationShutdown -> container.dispose() -> cleanup connexions.
- **`container.dispose()` — contrat de cleanup** : chaque adapter enregistre dans le container DOIT implementer une methode `dispose()` optionnelle. Le container appelle `dispose()` sur tous les services enregistres dans l'ordre inverse d'enregistrement. Responsabilites typiques :
  - `IDatabasePort.dispose()` : ferme le pool de connexions
  - `ICachePort.dispose()` : flush les ecritures en attente, ferme la connexion Redis
  - `ILoggerPort.dispose()` : flush les logs bufferises
  - `IEventBusPort.dispose()` : drain la queue (attend les messages en cours)
  - Les adapters qui n'ont pas de ressources a liberer n'implementent pas `dispose()` (no-op).
- **`dispose()` avec scopes actifs — contrat de drain** :
  - Si `container.dispose()` est appele alors que des scopes sont encore actifs (requetes en cours), le comportement est **force close sans drain** :
    - `dispose()` n'attend PAS que les scopes actifs se terminent. Il appelle `dispose()` sur les services du container global (SINGLETON) immediatement.
    - **Apres `dispose()`** : le container se marque comme `disposed`. Tout appel a `resolve()` depuis n'importe quel scope (actif ou non) leve `MantaError(INVALID_STATE, 'Container is disposed')`. Ceci garantit un comportement deterministe et testable — pas d'erreurs cryptiques dues a un pool DB ferme ou un cache deconnecte.
    - **Raison** : le timeout SIGTERM est 500ms. Attendre un drain (potentiellement des secondes si une requete est lente) depasse le budget. En serverless, le runtime freeze le process de toute facon — le drain est illusoire.
  - **Pour le Node standalone** : si un drain est necessaire (zero-downtime deployments), c'est la responsabilite du load balancer / reverse proxy (Nginx, HAProxy) de cesser d'envoyer des requetes avant le SIGTERM. Le framework ne fait PAS de drain HTTP — c'est une responsabilite infra. Le pattern recommande : SIGINT = stop accepting, SIGTERM = force close.
  - **Garantie** : `dispose()` est idempotent. L'appeler 2x ne leve pas d'erreur. Un service deja dispose est un no-op.
- **En serverless** : `dispose()` n'est JAMAIS appele par le framework. Les adapters serverless DOIVENT etre concus pour tolerer un non-appel de `dispose()` :
  - Connexions DB : gerees par le connection pooler externe (PgBouncer, Neon proxy) qui timeout les connexions abandonnees
  - Cache : Upstash Redis ferme les connexions HTTP automatiquement (pas de connexion persistante)
  - Logs : Pino flush stdout a chaque write (pas de buffer en mode JSON)
  - Events : les messages en queue sont persistants (Vercel Queues/SQS)
- **SIGTERM — contrat tranche** :
  - Le framework enregistre un handler SIGTERM global au boot (`process.on('SIGTERM', handler)`).
  - Ce handler appelle `container.dispose()` avec un **timeout de 500ms**. Si `dispose()` ne complete pas dans ce delai, le process est abandonne (le runtime serverless freeze de toute facon).
  - Ce n'est PAS optionnel — le framework le fait systematiquement, que ce soit en serverless ou en Node standalone. La difference :
    - **Node standalone** : SIGTERM est fiable, `dispose()` aura ses 500ms.
    - **AWS Lambda** : SIGTERM est envoye avant le freeze, mais le delai avant freeze est imprevisible (~200ms typique). `dispose()` est best-effort.
    - **Vercel Serverless** : SIGTERM n'est PAS garanti. Le handler existe mais peut ne jamais etre appele.
  - **Regle pour les adapters** : `dispose()` DOIT etre non-bloquant et rapide (<100ms idealement). Un adapter qui a besoin de plus de 100ms pour `dispose()` a un bug de design. Exemples :
    - `PinoLoggerAdapter.dispose()` : no-op (stdout est sync)
    - `DrizzlePgAdapter.dispose()` : appelle `pool.end()` (renvoie les connexions, ~10ms)
    - `UpstashCacheAdapter.dispose()` : no-op (HTTP, pas de connexion)
    - `VercelQueueAdapter.dispose()` : no-op (messages persistants)
  - Garantie : aucun adapter ne DOIT compter sur `dispose()` pour la coherence des donnees. Les donnees DOIVENT etre coherentes meme si `dispose()` n'est jamais appele. `dispose()` est un bonus de cleanup, pas une garantie de correctness.

**SPEC-072 : Health check endpoint — contrat precis**
- Contrat : le framework expose deux endpoints de sante :
  - **`/health/live`** (liveness) : retourne **200 OK** si le process repond. Pas de verification de dependances. Body : `{ "status": "alive", "uptime_ms": number }`. C'est un ping — si ca repond, le process tourne. Utilise par les load balancers Vercel/Kubernetes pour detecter un process mort.
  - **`/health/ready`** (readiness) : retourne **200 OK** si le framework est pret a servir des requetes, **503 Service Unavailable** si non pret. Verifie :
    1. Core boot complete (`isReady()` = true)
    2. Lazy boot complete (si deja declenche — sinon skip)
    3. DB connection active (un `SELECT 1` via `IDatabasePort`, timeout 2s)
    4. Cache reachable (`ICachePort.set("health", "1", 5)` + `ICachePort.get("health")`, timeout 2s)
    5. **Migrations a jour** : compare les versions des modules en DB (`module_versions`) avec les versions declarees dans le code. Si un mismatch existe (version DB < version code) → check `migrations` retourne `"pending"`. Le serveur demarre, mais `/health/ready` retourne **503** jusqu'a ce que `manta db:migrate` soit execute. Sur Vercel, le load balancer attend `/health/ready` 200 avant de router le trafic → l'ancienne instance continue de servir pendant la migration → zero downtime.
  - Body succes : `{ "status": "ready", "checks": { "boot": "ok", "database": "ok", "cache": "ok", "migrations": "ok" } }`
  - Body echec : `{ "status": "not_ready", "checks": { "boot": "ok", "database": "timeout", "cache": "ok", "migrations": "ok" } }` avec HTTP 503
  - Body migration pending : `{ "status": "not_ready", "checks": { "boot": "ok", "database": "ok", "cache": "ok", "migrations": "pending" } }` avec HTTP 503
  - **`/health`** : alias de `/health/ready` (retro-compatibilite).
  - Timeout global du healthcheck : **5 secondes**. Si un check depasse, il est marque `timeout` et le statut global est `not_ready`.
  - Les endpoints de sante n'ont PAS d'auth, PAS de CORS, PAS de middleware custom. Ils sont enregistres en etape 1 du pipeline (avant tout middleware).
  - En serverless Vercel : le readiness check n'est pas strictement necessaire (Vercel gere le routing), mais il est utile pour le monitoring et les smoke tests post-deploy.

**SPEC-076 : JS SDK Client HTTP avec auth multi-mode**
- Contrat : client JS supportant fetch avec headers custom, auth JWT (Bearer), API Key (Basic), Publishable Key (header).

---

### 6. Authentication & Authorization

#### Port : IAuthPort, IAuthProvider

**SPEC-049 : IAuthPort decouple du HTTP — JWT-first**
- Contrat : `IAuthPort` est un port core independant du transport HTTP. Il definit la **verification** de credentials (crypto pure, stateless), PAS leur extraction (qui depend du transport), PAS les flows business (authenticate/register/OAuth qui sont dans IAuthModuleService SPEC-050), PAS le lifecycle de session (create/destroy qui sont dans IAuthModuleService).
- **Frontiere IAuthPort vs IAuthModuleService** :
  - `IAuthPort` = **infrastructure crypto stateless** : verifier un JWT, verifier une API key, creer un JWT. Ce sont des operations pures sans side-effects ni dependances.
  - `IAuthModuleService` = **business logic + session lifecycle** : `authenticate()` orchestre le flow complet (lookup provider, validate credentials, create identity), `register()` cree un nouvel AuthIdentity, `validateCallback()` gere les retours OAuth, `createSession()` cree une session (ecriture cache), `destroySession()` supprime une session, `verifySession()` lit une session (lecture cache). Ce sont des operations metier ou avec side-effects.
  - `createJwt` dans IAuthPort est justifie : c'est de la crypto (signer un payload), pas du business. L'equivalent serait `hashPassword` — c'est dans le port infra, pas dans le service metier.
  - `verifySession` est dans IAuthModuleService (PAS IAuthPort) car il lit le cache (side-effect I/O). Un port crypto stateless ne doit pas avoir de dependance ICachePort.
- **IAuthPort est testable sans aucune dependance** : pas de ICachePort, pas de IContainer. `constructor(private config: AuthConfig)` — config pure. Les tests unitaires de IAuthPort n'ont besoin d'aucun mock.
- Methodes IAuthPort (crypto pure, transport-agnostiques, stateless) :
  - `verifyJwt(token: string) -> AuthContext | null` : verifie un JWT et retourne le contexte auth.
  - `verifyApiKey(key: string) -> AuthContext | null` : verifie une API key (prefix sk_).
  - `createJwt(payload: AuthContext, options?) -> string` : genere un JWT.
- **Extraction des credentials par trigger** (responsabilite du trigger adapter, PAS de IAuthPort) :
  - `http` : l'adapter HTTP (Nitro) extrait les credentials depuis les headers/cookies, puis appelle `IAuthGateway.authenticate(credentials)` (SPEC-049b) qui encapsule la decision Bearer vs Session vs API Key. L'adapter HTTP n'a PAS a connaitre la logique de routing — il construit un objet `AuthCredentials` et le passe au gateway. Le resultat (AuthContext) est passe au handler via contexte, PAS par mutation de `req`.
    - **Contrat d'extraction des cookies de session** :
      - Nom du cookie : configurable via `defineConfig({ auth: { session: { cookieName: 'manta.sid' } } })`. Defaut : `manta.sid`.
      - Le cookie DOIT etre `httpOnly: true`, `secure: true` (en prod), `sameSite: 'lax'` par defaut. Ces valeurs sont configurables : `defineConfig({ auth: { session: { cookie: { httpOnly: true, secure: true, sameSite: 'lax', domain?: string, path: '/' } } } })`.
      - **Signed cookies** : le cookie est signe avec `COOKIE_SECRET` (env var obligatoire si sessions activees). L'adapter HTTP verifie la signature avant de passer le sessionId a `verifySession()`. Cookie invalide → ignore (pas d'erreur — le user est simplement non-authentifie).
      - **Cross-origin (API sur sous-domaine)** : pour les setups Next.js front (`app.example.com`) + API (`api.example.com`), le dev configure `domain: '.example.com'` dans la config cookie. Le `sameSite: 'lax'` est suffisant pour les navigations top-level. Pour les requetes fetch cross-origin (XHR), le dev doit configurer `sameSite: 'none'` + `secure: true` et les CORS correspondants (SPEC-038). Le framework NE FAIT PAS ce choix automatiquement — c'est une decision du dev documentee dans le guide de deployment.
      - **Priorite d'extraction** : `Authorization: Bearer` a priorite sur le cookie. Si les deux sont presents, le Bearer est utilise. Si Bearer est absent, le cookie est lu. Si aucun des deux → requete non-authentifiee (pas d'erreur — l'auth middleware passe, l'etape RBAC ou le handler verifie ensuite).
  - `queue` : le message de queue contient un champ `metadata.auth_context` serialise au moment de l'emission. L'adapter queue le deserialise et le passe au handler. Pas d'appel a `verifyJwt()` — le contexte est deja verifie a l'emission.
  - `cron` : les jobs cron s'executent avec un `AuthContext` systeme pre-configure (`{ actor_type: 'system', actor_id: 'cron' }`). Pas de verification — les crons sont trusted par definition (invokes par l'infra).
  - **Subscribers** : heritent l'`AuthContext` de l'event qui les a declenches (propage via `metadata.auth_context` dans le message).
- **Chemin de propagation de l'AuthContext dans les events** — chaine complete :
  1. **Origine** : le handler HTTP (ou workflow step) a un `AuthContext` dans son scope (resolu depuis le scoped container ou le step context).
  2. **Emission** : le decorateur `@EmitEvents()` appele sur une methode de service lit l'`AuthContext` depuis le `Context` (SPEC-060) et le serialise dans `metadata.auth_context` de chaque event avant de le passer au `IMessageAggregator`.
  3. **Aggregation** : le `IMessageAggregator` accumule les events avec leur metadata (incluant `auth_context`) dans le scope de la requete/du workflow step.
  4. **Publication** : au commit (fin de requete ou `releaseGroupedEvents`), le `IMessageAggregator` appelle `IEventBusPort.emit()` avec les events et leur metadata intacte.
  5. **Livraison** : l'adapter event bus publie le message avec `metadata.auth_context` serialise. En at-least-once (Vercel Queues), le message complet est persiste dans la queue.
  6. **Reception** : le subscriber recoit l'event avec `metadata.auth_context`. Il peut le lire pour savoir qui a declenche l'action originale.
  7. **Cascade** : si le subscriber emet lui-meme des events (via un service avec `@EmitEvents()`), le MEME `auth_context` est propage a nouveau (sauf override explicite).
  - **Jobs cron** : l'`AuthContext` systeme `{ actor_type: 'system', actor_id: 'cron' }` est injecte par l'adapter job au demarrage du job. Les events emis depuis un job cron portent ce contexte systeme. Les subscribers en cascade heritent du contexte systeme.
  - **Workflows** : le `transactionId` du workflow est propage dans `metadata.transactionId` en plus de `auth_context`. Le moteur de workflow garde le contexte dans le `StepExecutionContext` (SPEC-003).
  - Garantie : le chemin de propagation est une chaine deterministe. Chaque maillon est testable independamment. En tests, `spyOnEvents(container)` permet de verifier que `metadata.auth_context` est present et correct sur chaque event emis.
- Strategies : JWT Bearer (par defaut, stateless), API Key (Basic auth, prefix sk_), Sessions (optionnel, via IAuthModuleService + Upstash Redis).
- Garanties : JWT est serverless-natif. Sessions optionnelles = opt-in explicite. Aucune methode de IAuthPort ne prend un objet Request ou Headers — le decoupage transport/verification est strict. Les tests d'IAuthPort n'ont besoin d'aucun mock (crypto pure).

**SPEC-050 : Auth module avec providers pluggables, OAuth et session lifecycle**
- Contrat : `IAuthModuleService` (business logic, HTTP-agnostique) supporte authenticate(), register(), validateCallback() (OAuth flows), updateProvider(), createSession(), destroySession(), verifySession().
- **Dependance explicite IAuthModuleService → ICachePort** : `createSession`, `destroySession` et `verifySession` necessitent ICachePort. Cette dependance est declaree dans le constructeur : `constructor(private cache: ICachePort, private authPort: IAuthPort, ...)`. IAuthPort reste crypto pure (pas de ICachePort).
- Methodes de l'interface IAuthProvider : `authenticate(data, authContext)`, `register(data, authContext)`, `validateCallback(data, authContext)`
- **Session lifecycle — flux create/destroy complet** (methodes de IAuthModuleService, PAS de IAuthPort) :
  - **`createSession(authContext: AuthContext, options?: SessionOptions) -> { sessionId: string, expiresAt: Date }`** : genere un sessionId (`crypto.randomUUID()`), stocke l'AuthContext dans `ICachePort` sous la cle `session:{sessionId}` avec un TTL (defaut 24h, configurable via `defineConfig({ auth: { session: { ttl: 86400 } } })`). Retourne le sessionId.
  - **Emission du cookie** : la RESPONSABILITE de l'adapter HTTP (trigger adapter), PAS de IAuthModuleService. Apres un login reussi (via IAuthModuleService.authenticate()), le handler de route auth appelle `authModuleService.createSession(authContext)`, recoit le `sessionId`, et set le cookie via `Set-Cookie` dans la Response.
  - **`destroySession(sessionId: string) -> void`** : supprime la cle `session:{sessionId}` de `ICachePort`. Appele par le handler logout. L'adapter HTTP set un cookie vide avec `Max-Age=0` pour supprimer le cookie cote client.
  - **`verifySession(sessionId: string) -> AuthContext | null`** : lit la session depuis ICachePort, retourne l'AuthContext ou null si session inexistante/expiree.
  - **Serialisation de l'AuthContext dans les sessions** : `createSession()` stocke l'AuthContext via `JSON.stringify(authContext)` sans replacer/reviver (contrairement aux checkpoints WS-08 qui ont un BigInt replacer). Les champs obligatoires (`actor_type`, `actor_id`) sont des strings — safe. Le champ optionnel `app_metadata` DOIT etre JSON-safe (strings, numbers, booleans, arrays, objects, null). Si un dev met un BigInt, Date, ou autre type non-JSON dans `app_metadata`, `JSON.stringify()` throw → `MantaError(INVALID_DATA, 'AuthContext contains non-serializable data in app_metadata')`. Le framework ne fait PAS de conversion automatique — c'est la responsabilite du dev de stocker des donnees JSON-safe dans `app_metadata`.
  - **Flow complet login** : POST /auth/login → handler → IAuthModuleService.authenticate(credentials) → AuthContext → authModuleService.createSession(authContext) → sessionId → Response avec `Set-Cookie: manta.sid={sessionId}; HttpOnly; Secure; SameSite=Lax`
  - **Flow complet logout** : POST /auth/logout → handler → authModuleService.destroySession(sessionId from cookie) → Response avec `Set-Cookie: manta.sid=; Max-Age=0`
  - **Session refresh** : optionnel. Si configure (`session.rolling: true`), chaque requete authentifiee par session renouvelle le TTL dans le cache (touch). L'adapter HTTP appelle `authModuleService.createSession(existingAuthContext)` avec le meme sessionId (ou un nouveau pour rotation) et reemet le cookie.
- **OAuth state management — contrat complet** :
  - `AuthIdentityProviderService.setState(key, state, ttl?)` stocke l'etat OAuth (state parameter, PKCE code_verifier, redirect_uri) dans `ICachePort` avec TTL (defaut **600s / 10 minutes**). La cle est le `state` parameter OAuth lui-meme (random, unguessable).
  - `AuthIdentityProviderService.getState(key)` lit et **supprime atomiquement** (get-then-delete) l'etat OAuth depuis le cache. Ceci garantit qu'un state ne peut etre consomme qu'une seule fois (protection CSRF + replay).
  - **CSRF protection** : le `state` parameter est genere par le framework (`crypto.randomUUID()`), stocke via `setState()`, et valide dans `validateCallback()` par comparaison exacte avec l'etat stocke. Si le state ne matche pas ou n'existe pas dans le cache → `MantaError(UNAUTHORIZED, 'Invalid OAuth state')`. La validation est faite par `IAuthModuleService.validateCallback()`, PAS par IAuthPort (c'est de la logique business).
  - **Multi-onglets simultanes** : chaque onglet genere son propre `state` parameter (UUID unique). Chaque state est stocke independamment dans le cache avec sa propre cle. Les deux flows sont independants — pas de conflit. Le TTL de 600s expire les states abandonnes.
  - **PKCE (Proof Key for Code Exchange)** : le `code_verifier` est stocke dans le state object : `setState(stateParam, { code_verifier, redirect_uri, provider })`. Le `code_challenge` (SHA256 du verifier) est envoye au provider OAuth. A la callback, le verifier est recupere via `getState()` et envoye au provider pour l'echange de token. PKCE est obligatoire pour les providers qui le supportent (tous les providers modernes).
  - **En serverless** : le cache (Upstash Redis) est durable entre invocations. Le state persiste meme si la Lambda/Vercel function qui a initie le flow n'est pas la meme que celle qui recoit le callback. C'est le pattern standard OAuth en serverless.
- Garanties : `AuthIdentityProviderService` fournit setState/getState pour OAuth flow state via ICachePort. Stateless par requete. Le module auth est 100% standalone — aucune dependance HTTP.

**SPEC-049b : IAuthGateway — facade d'authentification pour les trigger adapters**
- Contrat : `IAuthGateway` encapsule la decision Bearer vs Session vs API Key derriere une interface unique. L'adapter HTTP (ou tout trigger adapter) n'a PAS a connaitre la logique de routing entre `IAuthPort` et `IAuthModuleService`.
- **Methode unique** : `authenticate(credentials: AuthCredentials) -> AuthContext | null`
  ```typescript
  interface AuthCredentials {
    bearer?: string          // Authorization: Bearer <token>
    apiKey?: string           // Authorization: Basic sk_...
    sessionId?: string        // cookie session ID
  }
  interface IAuthGateway {
    authenticate(credentials: AuthCredentials): Promise<AuthContext | null>
  }
  ```
- **Logique interne** (ordre de priorite, contractualise) :
  1. Si `credentials.bearer` present → appelle `IAuthPort.verifyJwt(bearer)`. Si `verifyJwt` retourne `null` ET que le bearer commence par `sk_` → fallback : appelle `IAuthPort.verifyApiKey(bearer)`. Si `verifyJwt` retourne `null` et que le bearer NE commence PAS par `sk_` → retourne `null` directement (pas de fallback). Raison du prefix check : seuls les tokens API key ont le prefix `sk_`. Un JWT malformate ne doit pas trigger un appel a `verifyApiKey`.
  - **Regle de rejet definitif** : si `credentials.bearer` est present, le gateway ne tombe JAMAIS en fallback vers session ou API key **quel que soit le resultat du bearer**. Un bearer present mais invalide (JWT expire, sk_ invalide apres les deux tentatives) = rejet definitif (`null`), meme si `credentials.sessionId` ou `credentials.apiKey` sont valides. Raison : un client qui envoie un Bearer a l'intention de s'authentifier par token — ignorer silencieusement un token invalide pour fallback sur session est un risque de securite (masque un probleme cote client). Tests : AG-10 (bearer non-sk_ invalide + session valide), AG-14 (bearer sk_ invalide + session valide).
  2. Si pas de Bearer mais `credentials.apiKey` present → appelle `IAuthPort.verifyApiKey(apiKey)`.
  3. Si pas de Bearer ni API Key mais `credentials.sessionId` present → appelle `IAuthModuleService.verifySession(sessionId)`.
  4. Si aucun credential → retourne `null` (requete non-authentifiee).
- **Dependances** : `constructor(private authPort: IAuthPort, private authModuleService: IAuthModuleService)`. Le gateway est enregistre dans le container global comme SINGLETON.
- **Extraction des credentials** : la responsabilite de chaque trigger adapter (pas du gateway). L'adapter HTTP extrait `bearer` depuis `Authorization: Bearer`, `sessionId` depuis le cookie `manta.sid` (signe, decode), `apiKey` depuis `Authorization: Basic`. L'adapter queue extrait `auth_context` directement depuis `metadata` (deja verifie). L'adapter cron injecte un AuthContext systeme (pas d'appel au gateway).
- **Pourquoi un gateway et pas un pattern direct** : sans gateway, l'etape 6 du pipeline HTTP doit importer et connaitre les deux ports (IAuthPort et IAuthModuleService), savoir quand appeler verifyJwt vs verifySession, gerer la priorite Bearer > cookie. Cette logique est dupliquee dans chaque adapter HTTP (Nitro, Next.js, custom). Le gateway encapsule cette decision une seule fois. Un test de l'etape 6 n'a besoin de mocker qu'une seule interface (IAuthGateway), pas deux.
- **Tests** : le gateway est testable unitairement sans HTTP : `gateway.authenticate({ bearer: "valid.jwt" })` → AuthContext. Le pipeline HTTP est teste avec un mock de IAuthGateway.
- Garanties : stateless, pas de side-effects. La seule responsabilite est le routing de credentials vers le bon port/service.
- Compatibilite serverless : ✅ Compatible (stateless, zero etat).

**SPEC-051 : RBAC feature-flagge avec cache**
- Contrat : systeme de permissions (resource:operation). `hasPermission()` resout les roles et query les policies.
- Garanties : policies cachees. Feature-flagge sous 'rbac'. `wrapWithPoliciesCheck` wrape les handlers. `definePolicies()` pour declarer les policies RBAC d'un module.

**SPEC-052 : Auth methods configurables par actor type**
- Contrat : `http.authMethodsPerActor` restreint les providers auth par type d'acteur.

**SPEC-052b : Comportement des consommateurs ICachePort quand le cache est indisponible**
- Contrat : plusieurs features du framework dependent de ICachePort. Le comportement quand le cache est indisponible (Upstash down, timeout, etc.) est specifie par consommateur :
  - **Rate limiting (SPEC-039b)** : **fail-open** (requetes autorisees sans rate limit). Le trafic ne doit pas etre bloque parce que le cache est down.
  - **Sessions (SPEC-050)** : **fail-closed** (`verifySession()` retourne `null` → requete non-authentifiee). Pas d'auth degradee — une session non-verifiable = pas d'auth.
  - **RBAC (SPEC-051)** : **fail-closed** (`hasPermission()` retourne `false` → acces refuse). Pas de permissions degradees.
  - **makeIdempotent (SPEC-034)** : **fail-open** (le subscriber s'execute normalement, sans deduplication). Raison : une execution en double est moins grave qu'une non-execution (at-least-once > at-most-once). Le framework log un warning.
  - **OAuth state (SPEC-050)** : **fail-closed** (`getState()` retourne `null` → callback OAuth echoue). L'utilisateur doit re-initier le flow OAuth.
- Chaque consommateur DOIT catcher les erreurs de ICachePort et appliquer sa politique. ICachePort lui-meme propage les erreurs (il ne fait PAS de fail-open/closed — c'est la responsabilite du consommateur).
- Garanties : le framework ne crash pas silencieusement quand le cache est down. Chaque consommateur a un comportement documente et testable.

---

### 7. Configuration

#### Port : IConfigManager

**SPEC-053 : ConfigManager singleton avec validation**
- Contrat : charge et normalise la config de l'application (ex: `medusa-config.ts`).
- Garanties : validation des secrets (erreur en prod, warning en dev si manquants). Config chargee une fois au startup. Env vars prioritaires (serverless-friendly).
- **Secrets et rotation — limitation connue** : la config (incluant les secrets depuis `process.env`) est chargee **une seule fois au cold start**. En serverless, chaque cold start recharge les env vars — donc un changement de secret dans Vercel/AWS prend effet au prochain cold start (quelques minutes max). Il n'y a PAS de rotation a chaud entre warm invocations. C'est le comportement standard de toute app Node.js et de tout runtime serverless. Si un secret change entre deux warm invocations, l'ancienne valeur est utilisee jusqu'au prochain cold start. Pour forcer un reload immediat : redeployer (Vercel) ou invalider le cache Lambda (AWS).
  - **Rotation de credentials DB (ex: Neon)** : certains providers (Neon, RDS) rotent automatiquement les credentials DB. Le `IDatabasePort` ne definit PAS de methode `refresh()`. Le workaround standard : le connection pooler (Neon Proxy, PgBouncer) gere la rotation transparente — l'app utilise un endpoint fixe, le proxy gere le credential swap. Si le dev n'utilise pas de proxy et que les credentials rotent, la connexion DB echoue → `/health/ready` retourne 503 → le load balancer arrete le trafic → un nouveau cold start (redeploy ou eviction Lambda) recharge les nouveaux credentials. Ce n'est pas ideal mais c'est le comportement de toute app Node.js sans hot-reload de config.
  - **Workaround futur** : si la demande est forte, un `IDatabasePort.reconnect()` optionnel pourrait etre ajoute. Pour l'instant, le redeploy est le mecanisme de rotation.

**SPEC-054 : Environment variables et dotenv**
- Contrat : config overridable par env vars. Support de .env par environnement (.env.test, .env.staging, .env.production).
- Garanties : les env vars sont la methode standard de configuration serverless.

**SPEC-055 : Feature flags avec 3 niveaux de priorite**
- Contrat : priorite : env `MEDUSA_FF_*` > projectConfig > defaults. Supporte flags nested.
- Methodes : `FlagRouter.isFeatureEnabled()`, `setFlag()`, `listFlags()`

---

### 8. Database / Data Layer

#### Port : IDataModel, IDatabasePort, IRepository

> Note : le framework definit un DSL de modele (DML). L'adapter traduit vers l'ORM choisi (Drizzle, MikroORM, Prisma, etc.)

**SPEC-057 : DML (Data Modeling Language) pour definitions declaratives d'entites**
- Contrat : API fluent declarative pour definir des modeles de donnees. Le DML est la seule facon de declarer un modele — l'adapter (Drizzle) traduit en schema DB.

**SPEC-057a : 11 types de proprietes**

| Type | Factory | PostgreSQL | TypeScript | Options |
|------|---------|-----------|-----------|---------|
| `id` | `model.id()` | TEXT | `string` | `{ prefix?: string }` — prefixe pour IDs generes (ex: `prod_xxx`) |
| `text` | `model.text()` | TEXT | `string` | `.searchable()`, `.translatable()`, `.primaryKey()` |
| `number` | `model.number()` | INTEGER | `number` | `.searchable()`, `.primaryKey()` |
| `boolean` | `model.boolean()` | BOOLEAN | `boolean` | — |
| `bigNumber` | `model.bigNumber()` | NUMERIC | `number` | Auto-genere colonne shadow `raw_<field>` JSONB pour config BigNumber |
| `float` | `model.float()` | REAL | `number` | — |
| `serial` | `model.autoincrement()` | SERIAL | `number` | `.searchable()`, `.primaryKey()` — auto-increment |
| `dateTime` | `model.dateTime()` | TIMESTAMPTZ | `Date` | — |
| `json` | `model.json()` | JSONB | `Record<string, unknown>` | Defaults auto-stringifies |
| `enum` | `model.enum(values)` | ENUM/CHECK | `Values[number]` | Accepte array `['a','b']` ou enum TypeScript |
| `array` | `model.array()` | TEXT[] | `string[]` | PostgreSQL arrays natifs |

**SPEC-057b : 6 modifiers de proprietes (chainables)**

| Modifier | Disponible sur | Effet |
|----------|---------------|-------|
| `.nullable()` | Tous | Type devient `T \| null`, colonne NULL en DB |
| `.default(value)` | Tous | Valeur par defaut a l'insertion. JSON auto-stringifie |
| `.index(name?)` | Tous | Cree un index non-unique sur la colonne |
| `.unique(name?)` | Tous | Cree une contrainte UNIQUE |
| `.primaryKey()` | id, text, number, serial | Marque comme cle primaire. Un seul par entite |
| `.computed()` | Tous | Champ NON persiste en DB — calcule a la volee. Type devient nullable |
| `.searchable()` | text, number, serial, relations | Active la recherche full-text sur ce champ |
| `.translatable()` | text uniquement | Active les traductions per-locale via le module Translation |

**SPEC-057c : 5 types de relations**

| Type | Factory | Cardinalite | FK sur | Options |
|------|---------|-------------|--------|---------|
| `hasOne` | `model.hasOne(() => Related)` | 1→1 | Related | `{ mappedBy }` |
| `hasOneWithFK` | `model.hasOne(() => Related, { foreignKey: true })` | 1→1 | Owner | `{ foreignKeyName?, mappedBy }` — expose la FK comme colonne |
| `belongsTo` | `model.belongsTo(() => Parent)` | N→1 | Owner | `{ foreignKeyName?, mappedBy }` — ne peut PAS etre en cascade delete |
| `hasMany` | `model.hasMany(() => Child)` | 1→N | Child | `{ mappedBy }` |
| `manyToMany` | `model.manyToMany(() => Other)` | N→N | Pivot | `{ pivotTable?, pivotEntity?, joinColumn?, inverseJoinColumn?, mappedBy }` |

- Relations modifiers : `.nullable()` (hasOne, hasOneWithFK, belongsTo), `.searchable()` (toutes)
- `pivotEntity` : entite DML explicite pour la table pivot (permet colonnes custom)
- `joinColumn` / `inverseJoinColumn` : noms de colonnes FK custom dans la table pivot

**SPEC-057d : Features entity-level**

- `.cascades({ delete?: string[], detach?: string[] })` — cascade delete sur hasOne/hasOneWithFK/hasMany, detach sur manyToMany
- `.indexes([{ on: string[], unique?: boolean, where?: string | QueryCondition, name?: string, type?: string }])` — indexes composites, partial indexes (`where`), indexes GIN (`type: 'GIN'`)
- `.checks([{ name?: string, expression: string | ((columns) => string) }])` — contraintes PostgreSQL CHECK avec expressions typees
- Proprietes implicites (non-redefinissables) : `created_at` (TIMESTAMPTZ, auto NOW), `updated_at` (TIMESTAMPTZ, auto NOW on update), `deleted_at` (TIMESTAMPTZ nullable, soft-delete)
- **Contrat soft-delete** : `deleted_at` est present sur TOUTES les entites DML. Le comportement par defaut est :
  - `find()` / `findAndCount()` : filtrent automatiquement `WHERE deleted_at IS NULL`. Les entites soft-deletees sont **invisibles par defaut**.
  - Pour inclure les entites soft-deletees : `{ withDeleted: true }` dans les options de query.
  - `delete()` fait un hard-delete (suppression physique). `softDelete()` set `deleted_at = NOW()`. `restore()` reset `deleted_at = NULL`.
  - Les index partiels generes par le DML incluent `WHERE deleted_at IS NULL` pour exclure les soft-deleted des index de performance.
  - Ce comportement est une **garantie du framework** — identique quel que soit l'adapter ORM.
- BigNumber shadow columns : pour chaque propriete `bigNumber`, une colonne `raw_<field>` JSONB est auto-generee pour stocker la configuration (precision, scale)
- Entity name : `model.define('MyEntity', schema)` ou `model.define({ tableName: 'my_table', name: 'MyEntity' }, schema)` — supporte prefixe schema SQL (`schema.table`)

**SPEC-057e : Type guards runtime**

- Chaque type de propriete et relation expose un type guard statique : `IdProperty.isIdProperty(obj)`, `BelongsTo.isBelongsTo(obj)`, `DmlEntity.isDmlEntity(obj)`, etc.
- Utilises par le generator pour determiner la strategie de conversion DML → ORM schema

**SPEC-057f : DML → Drizzle Generator — contrat du generateur de schema**
- Contrat : le generateur transforme les definitions DML en schemas Drizzle valides. C'est le composant le plus critique du framework — chaque edge case non gere casse silencieusement la DB.
- **Pipeline de generation** :
  1. `parseDmlEntity(entity)` → extrait les proprietes, relations, indexes, checks depuis le DML
  2. `generateDrizzleColumns(properties)` → traduit chaque type DML en colonne Drizzle
  3. `generateDrizzleRelations(relations)` → traduit les relations en references Drizzle
  4. `generateDrizzleIndexes(indexes, entity)` → genere les indexes (simples, composites, partiels, GIN)
  5. `generateDrizzleChecks(checks)` → genere les contraintes CHECK
  6. `assembleDrizzleSchema(entity)` → assemble table + relations + indexes en schema exportable
- **Regles de conversion par type** :

| Type DML | Colonne Drizzle | Regles speciales |
|----------|----------------|------------------|
| `id` | `text('id').primaryKey()` | Si `prefix` : valeur par defaut via `generateId(prefix)`. Pas de SERIAL. |
| `text` | `text(name)` | — |
| `number` | `integer(name)` | — |
| `boolean` | `boolean(name)` | — |
| `bigNumber` | `numeric(name)` | **Shadow column** : genere AUSSI `jsonb('raw_' + name)` pour stocker la config BigNumber (precision, scale). Le generateur DOIT verifier que `raw_{name}` n'est pas deja declare explicitement — si oui, `MantaError(INVALID_DATA, 'Column raw_{name} conflicts with bigNumber shadow column')`. |
| `float` | `real(name)` | — |
| `serial` | `serial(name)` | — |
| `dateTime` | `timestamp(name, { withTimezone: true })` | — |
| `json` | `jsonb(name)` | `.default()` auto-stringifie l'objet |
| `enum` | `text(name)` + CHECK constraint | **Detection** : si l'argument est un array literal `['a','b','c']`, genere `CHECK (name IN ('a','b','c'))`. Si l'argument est un TypeScript enum (objet avec valeurs string), extrait les valeurs runtime via `Object.values(enumObj)` **filtrées** : seules les valeurs de type `string` sont gardees (`Object.values(enumObj).filter(v => typeof v === 'string')`). Ceci gere correctement les enums numeriques TypeScript (`enum Status { PENDING = 0, ACTIVE = 1 }` → `Object.values` retourne `["PENDING", "ACTIVE", 0, 1]` → apres filtre → `["PENDING", "ACTIVE"]`). **Restriction** : les enums avec des valeurs numeriques explicites (ex: `enum Flags { A = 1, B = 2 }`) generent un CHECK constraint sur les NOMS des membres (strings), PAS sur les valeurs numeriques. Si le dev veut stocker des nombres en DB, il doit utiliser `model.number()` avec un CHECK manuel, pas `model.enum()`. Le generateur leve un **warning** au build si un enum contient des valeurs numeriques : `Warning: Enum "{name}" has numeric values. model.enum() stores string member names, not numeric values. Use model.number() with .checks() for numeric constraints.` Le generateur NE PEUT PAS utiliser les types statiques TypeScript — il opere sur des valeurs runtime. |
| `array` | `text(name).array()` | PostgreSQL arrays natifs TEXT[] |

- **Colonnes implicites** (ajoutees automatiquement, NON redefinissables) :
  - `created_at` : `timestamp('created_at', { withTimezone: true }).defaultNow().notNull()`
  - `updated_at` : `timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()` + trigger `ON UPDATE`
  - `deleted_at` : `timestamp('deleted_at', { withTimezone: true })` (nullable)
  - Si le dev declare une propriete `created_at`, `updated_at` ou `deleted_at` dans son DML, le generateur leve `MantaError(INVALID_DATA, 'Property {name} is implicit and cannot be redefined')`.
- **Modifiers → Drizzle** :
  - `.nullable()` → `.notNull()` ABSENT (Drizzle est nullable par defaut, mais on force `notNull()` sauf si `.nullable()`)
  - `.default(value)` → `.default(value)` (JSON auto-stringifie)
  - `.index(name?)` → `index(name ?? autoName).on(column)` dans le schema
  - `.unique(name?)` → `unique(name ?? autoName).on(column)`
  - `.primaryKey()` → `.primaryKey()`
  - `.computed()` → **PAS de colonne generee**. Le champ est present dans le type TypeScript mais absent de la table Drizzle. Le generateur le skip.
- **Relations → Drizzle** :
  - `hasOne` → `relations(table, ({ one }) => ({ relName: one(relatedTable, { fields: [], references: [] }) }))`. FK sur la table Related.
  - `hasOneWithFK` → meme que hasOne + **genere une colonne FK** `{relation_name}_id` (ou `foreignKeyName` si specifie) sur la table Owner.
  - `belongsTo` → genere une colonne FK `{relation_name}_id` sur la table Owner + relation `one()`.
  - `hasMany` → `relations(table, ({ many }) => ({ relName: many(childTable) }))`. FK sur le Child.
  - `manyToMany` → **genere une table pivot** :
    - Nom : `pivotTable` option, sinon `{tableA}_{tableB}` (ordre alphabetique).
    - Colonnes : `id` (text, PK, generated), `{tableA_singular}_id` (FK), `{tableB_singular}_id` (FK), `created_at`, `updated_at`, `deleted_at`.
    - Si `pivotEntity` : utilise l'entite DML fournie comme definition de la table pivot (permet colonnes custom). Le generateur fusionne les colonnes FK obligatoires avec les colonnes custom.
    - Cle primaire composite sur les deux FK (en plus de l'id).
    - Index auto sur chaque FK + `WHERE deleted_at IS NULL`.
- **Indexes composites et partiels → Drizzle** :
  - `.indexes([{ on: ['col1', 'col2'], unique: true }])` → `uniqueIndex(autoName).on(table.col1, table.col2)`
  - `.indexes([{ on: ['col1'], where: 'col1 > 0' }])` → `index(autoName).on(table.col1).where(sql\`col1 > 0\`)`
  - `.indexes([{ on: ['col1'], where: { col1: { $gt: 0 } } }])` → le generateur serialise le `QueryCondition` en SQL : `{ $gt: 0 }` → `col1 > 0`, `{ $in: ['a','b'] }` → `col1 IN ('a','b')`, `{ $ne: null }` → `col1 IS NOT NULL`. Operateurs supportes : `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$like`, `$ilike`.
  - `.indexes([{ on: ['data'], type: 'GIN' }])` → `index(autoName).using('gin', table.data)` — index GIN pour JSONB
  - Tous les indexes incluent implicitement `WHERE deleted_at IS NULL` sauf si `where` est explicitement specifie (le dev prend le controle).
- **Checks → Drizzle** :
  - `.checks([{ name: 'positive_price', expression: 'price > 0' }])` → `check(sql\`price > 0\`)`
  - `.checks([{ expression: (cols) => \`\${cols.start_date} < \${cols.end_date}\` }])` → le callback recoit les noms de colonnes typees, retourne une expression SQL string.
- **Nommage automatique** : les indexes/contraintes sans nom explicite recoivent un nom auto-genere : `idx_{table}_{columns}` (index), `uq_{table}_{columns}` (unique), `chk_{table}_{name}` (check). Le generateur verifie l'unicite des noms et leve une erreur en cas de conflit.
- **Output** : le generateur produit un fichier `.ts` par entite dans le dossier `drizzle/schema/`, exportant : la table Drizzle, les relations, et les indexes. Un fichier `drizzle/schema/index.ts` re-exporte tout.
- **Interface DML Generator → drizzle-kit — contrat explicite** : le generateur ecrit des **fichiers `.ts` sur disque** dans `drizzle/schema/`. Ce sont des fichiers Drizzle standard importables. `drizzle-kit generate` lit ensuite ces fichiers (via le `drizzle.config.ts` qui pointe vers `drizzle/schema/`) et compare avec la DB pour produire les migrations SQL. Il n'y a PAS de passage d'objets en memoire entre le generateur et drizzle-kit — le contrat est le filesystem. Consequence pour les tests : les tests DG-* du generateur verifient le contenu des fichiers `.ts` generes (AST ou string matching), pas des objets runtime. Le generateur est testable sans DB (il ecrit des fichiers). drizzle-kit est teste separement (il lit des fichiers et compare avec la DB).
- **Commande CLI** : `manta db:generate` appelle le generateur sur toutes les entites DML (ecriture des fichiers `.ts` dans `drizzle/schema/`), puis `drizzle-kit generate` compare le schema genere avec la DB pour produire les fichiers de migration SQL.
- **Re-generation apres modification DML — delegation a drizzle-kit** :
  - Le generateur DML → Drizzle est **stateless** : il produit un schema Drizzle a partir du DML courant, sans connaissance de l'etat precedent. Le diff entre l'ancien schema et le nouveau est la responsabilite de `drizzle-kit generate`.
  - **Exemple dangereux** : `model.text("status")` → `model.enum(["active", "inactive"])`. Le generateur produit `text("status")` + CHECK constraint. `drizzle-kit generate` compare avec la DB et decide : ALTER COLUMN ou DROP+ADD.
  - **Limites documentees de drizzle-kit** : certains changements de type (text → enum, integer → text) peuvent generer des migrations avec perte de donnees. Le framework NE CONTROLE PAS ce que drizzle-kit genere. `manta db:generate` affiche un warning apres generation : `Review the generated migration SQL before applying. drizzle-kit may generate destructive changes (DROP COLUMN, ALTER TYPE) for certain DML changes.`
  - **Filet de securite** : `manta db:diff` (SPEC-087) permet de comparer le schema attendu vs la DB AVANT d'appliquer la migration. Les changements unsafe (ALTER TYPE, DROP COLUMN) sont marques `NOTIFY` avec warning.
  - **Detection de renommage** : `manta db:generate` analyse le diff entre l'ancien schema Drizzle et le nouveau. Si une colonne disparait et une nouvelle apparait avec le meme type sur la meme table, le framework affiche un prompt : `Column "title" removed and column "name" (same type: text) added on table "product". Is this a rename? [y/N]`. Si oui, le framework genere `ALTER TABLE product RENAME COLUMN title TO name` au lieu de `DROP COLUMN title; ADD COLUMN name text`. Si non (ou `--no-interactive`), le framework genere le DROP+ADD standard avec un warning : `Warning: DROP COLUMN "title" will delete all data in this column. Use --allow-rename for interactive rename detection.` En CI (`--no-interactive`), le renommage n'est JAMAIS automatique — le dev doit ecrire le RENAME manuellement dans un fichier `.sql` custom.
  - **Responsabilite du dev** : le dev DOIT relire le fichier SQL genere par `drizzle-kit generate` avant d'appliquer via `manta db:migrate`. Le framework ne peut pas deviner si un ALTER TYPE est safe (ex: text → varchar(255) = safe, text → integer = perte de donnees).
- Garanties : le generateur est deterministe (meme input → meme output). Pas d'effets de bord. Testable unitairement sans DB.

**SPEC-058 : createService() factory generant CRUD automatique**
- Contrat : `createService(models)` genere 7 methodes CRUD par entite : `retrieve`, `list`, `listAndCount`, `create`, `update`, `delete`, `softDelete`, `restore`.
- Nommage : singulier pour `retrieve` (`retrieveProduct`), pluriel pour les autres (`listProducts`, `createProducts`, etc.).
- Architecture : Repository (acces donnees, CRUD generique via Drizzle) et Service (logique metier, serialisation DTO, emission events). Le dev voit la meme API de surface.
- Decorateurs appliques dans l'ordre : `@Ctx()` -> `@EmitEvents()` -> `@InjectManager()`
- `softDelete` / `restore` retournent `Record<string, string[]>` des entites cascadees (via `returnLinkableKeys`).
- Garanties : pas de prefixe "Medusa" dans l'API publique.
- **SPEC-058-OVERRIDE : Override des methodes CRUD generees** :
  - Le pattern canonique pour overrider une methode CRUD generee est l'**extension de la classe de base** (sous-classe). Le framework NE fournit PAS de hook/callback API (`beforeCreate`, `afterUpdate`, etc.). La sous-classe est superieure : TypeScript natif, acces complet au container via `this`, testable unitairement en mockant juste le repository.
  - `createService(models)` genere une classe de base (`ProductServiceBase`). Le dev cree sa propre classe qui herite de cette base :
    ```typescript
    // Genere par createService() — ne pas modifier
    class ProductServiceBase extends MantaService<Product> {
      async createProducts(@Ctx() context: Context, data: CreateProductInput[]) { ... }
    }

    // src/modules/product/service.ts — override du dev
    class ProductService extends ProductServiceBase {
      async createProducts(@Ctx() context: Context, data: CreateProductInput[]) {
        // Validation metier ici
        if (data.some(p => p.type === 'subscription' && p.price < 0)) {
          throw new MantaError('INVALID_DATA', 'Subscription price cannot be negative')
        }
        // Appel du parent (insert + events)
        return super.createProducts(context, data)
      }
    }
    ```
  - L'override DOIT appeler `super.method()` pour executer l'implementation par defaut (insert + `messageAggregator.save()` via `eventBuilderFactory`). Si le dev ne veut PAS l'implementation par defaut (ex: delegation a un workflow), il n'appelle pas `super` et gere le save + events lui-meme.
  - Si la validation metier necessite des side effects cross-service (ex: verifier le stock, notifier un entrepot), le bon pattern est de deleguer a un workflow depuis le service :
    ```typescript
    async createProducts(@Ctx() context: Context, data: CreateProductInput[]) {
      return this.workflowEngine.run('create-products-workflow', { data })
    }
    ```
    Le workflow orchestre. Le service reste le point d'entree. Un simple `validate → insert` n'a PAS besoin d'un workflow — c'est de l'over-engineering.
  - **Test CS-01** : un override qui `throw` avant `super.createProducts()` empeche l'insert ET empeche l'emission d'events (le `messageAggregator.save()` du parent n'est jamais appele).

**SPEC-059 : Decorateurs de service cross-cutting**
- Contrat : `@InjectManager()`, `@InjectTransactionManager()`, `@Ctx()`, `@EmitEvents()`.
- Garanties : wrappent le comportement des methodes de facon transparente.
- **Detail des 4 decorateurs — voir SPEC-059b, SPEC-059c, SPEC-059d ci-dessous.**

**SPEC-059b : Decorateur @Ctx() — injection du Context en parametre de methode**
- Contrat : `@Ctx()` decore un **parametre** de methode de service. Il marque ce parametre comme le receptacle du `Context` (SPEC-060).
- **Signature** :
  ```typescript
  class ProductService {
    async create(@Ctx() context: Context, data: CreateProductDTO): Promise<Product> { ... }
  }
  ```
- **Semantique** :
  - Le decorateur identifie le parametre par sa position (premier parametre decore `@Ctx()`). Il n'y a PAS de detection par type — c'est la decoration explicite qui compte.
  - Si aucun parametre n'est decore `@Ctx()` sur une methode, le framework ne tente PAS d'injecter le Context. La methode recoit ses arguments tels quels. Pas d'erreur — c'est un opt-in.
  - Si plusieurs parametres sont decores `@Ctx()` sur la meme methode, seul le PREMIER est utilise. Les suivants sont ignores (warning en strict mode).
- **Interaction avec les autres decorateurs** :
  - Ordre d'application : `@Ctx()` → `@EmitEvents()` → `@InjectManager()`. `@Ctx()` est le premier a s'executer — il assure que le `Context` est disponible pour les decorateurs suivants.
  - `@EmitEvents()` lit le `Context` depuis le parametre decore pour extraire `auth_context` et `messageAggregator`.
  - `@InjectManager()` lit le `Context` depuis le parametre decore pour y injecter le `manager` (entity manager Drizzle).
- **Propagation inter-services** : quand un service A appelle un service B, il passe le MEME objet `Context`. Le `@Ctx()` du service B recoit l'objet sans transformation. C'est le pattern standard pour propager transactions, auth, et grouped events a travers les couches.
- **Valeur par defaut** : si l'appelant ne fournit pas le `Context` (ex: appel direct sans passer par le pipeline), le decorateur cree un Context vide via `createDefaultContext()`. Ce Context minimal a : `transactionManager: undefined`, `manager: undefined`, `messageAggregator: new InMemoryMessageAggregator()`, `idempotencyKey: randomUUID()`.
- **Appel hors scope HTTP (manta exec, scripts CLI)** : quand un service est appele sans pipeline HTTP (pas de scope ALS actif), le comportement est defini : (1) `@Ctx()` cree un Context par defaut si absent. (2) `@InjectManager()` resolve le `manager` depuis le container du service — ceci fonctionne car le container global est disponible (le manager est un SINGLETON). (3) `@InjectTransactionManager()` detecte `context.transactionManager === undefined` → ouvre une nouvelle transaction normalement. **Aucune operation n'est silencieusement cassee**. La seule difference vs pipeline HTTP : pas d'`auth_context` (les events emis n'auront pas de metadata auth), et pas de scope ALS (les services SCOPED ne sont pas resolvables depuis le container global — mais les decorateurs n'en resolvent pas). Pour `manta exec`, le framework cree un scope explicite via `asyncLocalStorage.run()` avant d'executer le script (equivalent du pipeline step 4).
- **Streams** : pas de traitement special. Le Context est injecte une fois au debut de l'appel. Si la methode retourne un stream, le Context reste valide pendant toute la duree du stream (il n'est pas dispose).
- **Compat Medusa** : `@manta/compat-medusa` exporte `MedusaContext` comme alias de `Ctx`.
- Garanties : zero side-effect. Pas de resolution depuis le container. Pas de dependance externe.
- Compatibilite serverless : ✅ Compatible (pure metadata).

**SPEC-059c : Decorateur @EmitEvents() — emission automatique d'events domaine**
- Contrat : `@EmitEvents()` decore une **methode** de service. Il wrappe la methode pour emettre les events domaine via `IMessageAggregator` apres une mutation reussie.
- **Signature** :
  ```typescript
  class ProductService {
    @EmitEvents()
    async create(@Ctx() context: Context, data: CreateProductDTO): Promise<Product> {
      // ... logique metier ...
      return product
    }
  }
  ```
- **Semantique — chemin nominal** :
  1. Avant l'appel : le decorateur ne fait rien (pas de setup).
  2. La methode s'execute normalement.
  3. Apres le retour (succes) : le decorateur ne fait **rien** — les events restent bufferises dans le `IMessageAggregator` du scope. C'est le **pipeline** (etape 12 "ErrorHandler" en fin de requete) ou le **workflow engine** (via `releaseGroupedEvents`) qui lit `getMessages()`, appelle `IEventBusPort.emit()`, puis `clearMessages()`. Le decorateur ne publie pas — il ne fait que clear en cas d'erreur. **Mecanisme d'accumulation des events — contrat explicite** : les events ne sont PAS auto-detectes depuis les entites retournees. C'est la **logique metier** qui appelle explicitement `context.messageAggregator.save(events)` pendant son execution. Le decorateur `@EmitEvents()` ne fait que gerer le lifecycle : **no-op au succes** (les events restent dans le buffer pour le pipeline), **clear a l'erreur**. Concretement :
      ```typescript
      // Le service appelle save() explicitement — PAS le decorateur
      @EmitEvents()
      async create(@Ctx() context: Context, data: CreateProductDTO): Promise<Product> {
        const product = await this.repo.create(data)
        // Le service decide quels events emettre et quand
        context.messageAggregator.save([{
          eventName: 'product.created',
          data: { id: product.id },
          metadata: { timestamp: Date.now() }
        }])
        return product
      }
      ```
      Le `createService()` (SPEC-058) wrape les methodes CRUD pour appeler `messageAggregator.save()` automatiquement apres chaque mutation. C'est `createService()` qui fait le mapping mutation→event via `eventBuilderFactory` (SPEC-127) : `buildEventNamesFromModelName('product')` → `{ created: 'product.created', updated: 'product.updated', deleted: 'product.deleted' }`, PAS `@EmitEvents()`. Un service custom sans `createService()` doit appeler `save()` manuellement. Pour ecrire le test MA-07, il faut mocker `IMessageAggregator` et verifier que `save()` a ete appele avec les bons events — le mock est sur le `messageAggregator`, pas sur les entites.
      - **Convention de payload** : `createService()` passe `{ id }` uniquement dans `data` (pas l'entite complete). Le subscriber fait un `retrieve()` s'il veut les donnees completes. Cette convention evite de serialiser des objets larges dans la queue et garantit que le subscriber lit toujours la version la plus recente.
  4. Les events ne sont PAS emis immediatement — ils sont bufferises dans le `IMessageAggregator` du scope. L'emission reelle a lieu au commit (fin de requete ou `releaseGroupedEvents` du workflow).
- **Semantique — chemin d'erreur** :
  1. Si la methode throw une exception, le decorateur appelle `context.messageAggregator.clearMessages()` pour vider le buffer.
  2. L'exception est re-throw — le decorateur n'avale JAMAIS les erreurs.
- **Erreur de save() — propagation explicite** :
  - Si `context.messageAggregator.save()` throw (ex: bug dans le serializer, OOM), l'exception **se propage** a travers la methode du service. Le decorateur ne catch PAS les erreurs de `save()` — elles remontent normalement.
  - Consequence : la mutation metier a pu etre commitee (si `save()` throw apres le `repo.create()`) mais les events ne sont PAS bufferises. C'est un cas de **failure partielle** : la donnee existe mais l'event n'a jamais ete emis. Le subscriber ne sera jamais notifie.
  - Ce scenario est extremement rare (save() manipule un tableau in-memory, pas d'I/O). Si `save()` echoue, c'est un bug framework — pas une condition applicative.
  - **Pas de retry automatique** : le framework ne tente pas de re-save(). Le dev peut detecter ce cas via le log d'erreur et re-emettre manuellement l'event.
- **AuthContext dans les events** : le decorateur lit `context.auth_context` (SPEC-060) et le serialise dans `metadata.auth_context` de chaque event avant de le passer au `IMessageAggregator`. Si `auth_context` est absent (ex: appel interne sans auth), `metadata.auth_context` est `undefined` — pas d'erreur.
- **Streams** : `@EmitEvents()` est INTERDIT sur les methodes qui retournent un `ReadableStream` ou un `AsyncGenerator`. Le decorateur detecte le type de retour a l'execution : si c'est un stream/generator, il leve `MantaError(INVALID_STATE, '@EmitEvents() cannot wrap a streaming method — events cannot be emitted before the stream completes')`. La raison : les events doivent etre emis apres completion, mais un stream peut durer indefiniment.
- **Interaction avec @InjectManager()** : `@EmitEvents()` s'execute AVANT `@InjectManager()` dans la chaine de decorateurs. Cela signifie que le `manager` est deja injecte dans le Context quand `@EmitEvents()` lit le retour de la methode. L'ordre est important : `@Ctx()` prepare le Context → `@InjectManager()` ajoute le manager → la methode s'execute → `@EmitEvents()` collecte les events apres le retour.
- **Sans `@Ctx()`** : si la methode n'a pas de parametre `@Ctx()`, le decorateur `@EmitEvents()` cree un Context par defaut (meme comportement que SPEC-059b). Warning en strict mode — un service avec `@EmitEvents()` sans `@Ctx()` perd la propagation d'auth et de transaction.
- Garanties : jamais d'emission partielle. Tout ou rien par appel de methode.
- Compatibilite serverless : ✅ Compatible (in-memory buffering).

**SPEC-059d : Decorateurs @InjectManager() et @InjectTransactionManager() — injection ORM**
- Contrat : decorateurs de **methode** qui injectent l'entity manager Drizzle dans le `Context` avant l'execution.
- **@InjectManager()** :
  ```typescript
  class ProductService {
    @InjectManager()
    async create(@Ctx() context: Context, data: CreateProductDTO): Promise<Product> {
      const db = context.manager  // DrizzleClient injecte
      // ... operations DB ...
    }
  }
  ```
  - Semantique : avant l'appel, le decorateur resolve le `manager` (DrizzleClient) depuis le container du service et l'assigne a `context.manager`. Si `context.manager` est deja present (ex: passe par un service parent), il est CONSERVE — pas d'override. Cela garantit que la meme connexion Drizzle est reutilisee dans toute la chaine d'appels.
  - Si le service n'a pas de module DB enregistre, le decorateur leve `MantaError(INVALID_STATE, 'No database manager available for service')`.

- **@InjectTransactionManager()** :
  ```typescript
  class ProductService {
    @InjectTransactionManager()
    async createWithTransaction(@Ctx() context: Context, data: CreateProductDTO): Promise<Product> {
      const tx = context.transactionManager  // PgTransaction injecte
      // ... operations dans la transaction ...
    }
  }
  ```
  - Semantique : avant l'appel, le decorateur verifie si `context.transactionManager` existe deja :
    - **Si OUI** (transaction parente existante) : le decorateur reutilise la transaction existante. Si `context.enableNestedTransactions === true`, il cree un savepoint via `tx.transaction()`. Si `false` (defaut), il reutilise la transaction parente directement.
    - **Si NON** (pas de transaction en cours) : le decorateur ouvre une nouvelle transaction via `db.transaction()` avec `context.isolationLevel` (defaut : `READ COMMITTED`). Il assigne le `tx` a `context.transactionManager`.
  - **Commit/Rollback** : le decorateur wrappe l'appel dans un try/catch. Si la methode retourne normalement → commit automatique. Si la methode throw → rollback automatique + re-throw.
  - **Interaction avec @EmitEvents()** : les events ne sont emis que si la transaction commit. Si rollback, `clearMessages()` est appele par `@EmitEvents()` (qui s'execute apres dans la chaine de retour).

- **Ordre d'application des 3 decorateurs sur une methode** :
  1. `@Ctx()` — prepare le Context (parametre)
  2. `@InjectManager()` ou `@InjectTransactionManager()` — injecte le manager/tx dans le Context
  3. La methode s'execute avec le Context complet
  4. `@EmitEvents()` — collecte les events au retour (succes) ou clear (erreur)

  Note : cet ordre est l'ordre d'**execution**, pas l'ordre de declaration. En TypeScript, les decorateurs de methode s'appliquent bottom-up, donc le code source les declare dans l'ordre inverse :
  ```typescript
  @EmitEvents()        // execute en dernier (wrappe le plus a l'exterieur)
  @InjectManager()     // execute en second
  async create(@Ctx() context: Context, data: CreateProductDTO) { ... }
  ```

- **Utilisation mutuelle exclusive** : `@InjectManager()` et `@InjectTransactionManager()` sont mutuellement exclusifs sur la meme methode. Appliquer les deux leve `MantaError(INVALID_STATE, 'Cannot apply both @InjectManager() and @InjectTransactionManager() on the same method')` au bootstrap (detection statique via metadata).
- Garanties : pas de double-wrapping. Detection a l'enregistrement, pas au runtime. Aucun import ORM-specifique dans les decorateurs — ils resolvent via le container.
- Compatibilite serverless : ✅ Compatible (connexion DB geree par IDatabasePort).

**SPEC-060 : Context type pour transaction et event management**
- Contrat : Context porte : transactionManager, manager, isolationLevel, enableNestedTransactions, eventGroupId, transactionId, runId, requestId, messageAggregator, idempotencyKey, isCancelling, **auth_context**.
- **Type AuthContext** (definition complete) :
  ```typescript
  interface AuthContext {
    actor_type: 'user' | 'customer' | 'system'  // obligatoire
    actor_id: string                              // obligatoire
    auth_identity_id?: string                     // ID de l'AuthIdentity (OAuth, etc.)
    scope?: 'admin' | 'store'                     // namespace d'origine de la requete
    session_id?: string                           // present si auth par session
    app_metadata?: Record<string, unknown>        // metadata du provider auth
  }
  ```
  - `actor_type` + `actor_id` sont les seuls champs obligatoires. Tout le reste est optionnel.
  - Les cron jobs utilisent `{ actor_type: 'system', actor_id: 'cron' }`.
  - Les subscribers heritent l'AuthContext de l'event emetteur (SPEC-049).
  - En tests : `createTestAuth({ actorType: 'user', actorId: 'u1' })` genere un AuthContext valide.
- **Propagation entre services** : le `Context` est passe en parametre de methode via `@Ctx()`. Quand un service A appelle un service B, il transmet le meme `Context`. L'`auth_context` voyage avec le Context — pas besoin de `resolve('AUTH_CONTEXT')` dans le service (reserve aux middlewares et handlers). Le pattern est : middleware extrait → enregistre dans scope → handler lit depuis `ctx.auth` → passe au service via `Context` → le service le transmet en cascade.
- **Note sur la surface du type Context** : le Context est un objet riche qui porte des concerns differentes (transaction, auth, events, idempotency). C'est un design delibere herite de Medusa — il simplifie la propagation inter-services (un seul objet a passer) au prix d'un couplage accru. Pour le testing, `@manta/testing` fournit `createTestContext(overrides?)` qui cree un Context minimal valide :
  ```typescript
  const ctx = createTestContext({
    auth_context: { actor_type: 'user', actor_id: 'u1' },
    // Tous les autres champs optionnels, defauts raisonnables
  })
  ```
  Le helper genere des valeurs par defaut pour : `transactionManager` (undefined), `manager` (mock no-op), `eventGroupId` (undefined), `idempotencyKey` (auto-generated UUID), `messageAggregator` (InMemoryMessageAggregator). Le dev n'a besoin de setter que les champs pertinents pour son test.
- Garanties : contexte per-request/per-workflow-step.

**SPEC-056 : DB connection avec retry et pooling configurable**
- Contrat : le port IDatabasePort gere la connexion DB. Pool configurable (min/max/idleTimeout), retry (default 5 retries). Health check.
- **Interface IDatabasePort** :
  ```typescript
  interface IDatabasePort {
    // Lifecycle
    initialize(config: DatabaseConfig): Promise<void>
    dispose(): Promise<void>
    healthCheck(): Promise<boolean>

    // Connection
    getClient(): DrizzleClient              // instance Drizzle configuree (select/insert/update/delete)
    getPool(): PoolClient                   // acces bas-niveau au pool (pour introspection, raw SQL)

    // Transactions
    transaction<T>(
      fn: (tx: DrizzleTransaction) => Promise<T>,
      options?: TransactionOptions
    ): Promise<T>

    // Schema management (CLI only)
    introspect(): Promise<SchemaIntrospection>  // via information_schema (pour db:diff)
  }
  ```
- **Interaction IDatabasePort ↔ IRepository** : le `IRepository` recoit le `DrizzleClient` via le container (resolu comme `manager` dans le `Context`). En transaction, le decorator `@InjectTransactionManager()` injecte le `DrizzleTransaction` dans `context.transactionManager`. Le repository utilise `context.transactionManager ?? context.manager` pour choisir la connexion.
- **Propagation de transaction inter-services** : quand un service A ouvre une transaction via `@InjectTransactionManager()`, le `DrizzleTransaction` est stocke dans `context.transactionManager`. Quand A appelle B en passant le meme `Context`, le decorator de B detecte que `context.transactionManager` est deja set → pas de nouvelle transaction → execute directement avec le `DrizzleTransaction` existant. C'est le mecanisme qui garantit qu'un seul `BEGIN/COMMIT` englobe toute la chaine d'appels.
- Note serverless : pool min=0 requis. Connection proxy (PgBouncer, Neon serverless driver) recommande.

**SPEC-061 : DAL types : BaseFilterable, OptionsQuery**
- Contrat : `BaseFilterable` avec `$and/$or`, `OptionsQuery` avec populate/orderBy/limit/offset/fields.
- Note : ces types sont framework-level. L'adapter ORM les traduit en queries specifiques.
- **Cursor-based pagination (keyset pagination)** :
  - En plus de `limit/offset`, le framework supporte la pagination par curseur via `OptionsQuery` :
    ```typescript
    interface CursorPagination {
      cursor?: string          // curseur opaque (base64 de la derniere valeur de tri)
      limit: number            // nombre d'elements a retourner
      direction: 'forward' | 'backward'  // direction de pagination
    }
    ```
  - **Quand utiliser cursor vs offset** :
    - `limit/offset` : datasets petits/moyens (< 100k rows), UI avec "page 1, 2, 3", admin panels. Simple mais O(n) en DB avec grands offsets.
    - `cursor` : datasets volumineux (> 100k rows), infinite scroll, APIs publiques. O(1) en DB car utilise `WHERE id > cursor ORDER BY id LIMIT N` (keyset).
  - **Semantique SQL** : le curseur est traduit en `WHERE sort_column > :cursor_value ORDER BY sort_column ASC LIMIT :limit` (forward) ou `WHERE sort_column < :cursor_value ORDER BY sort_column DESC LIMIT :limit` (backward). L'index sur `sort_column` rend la query O(log n) au lieu de O(n) pour offset.
  - **Format du curseur** : base64 encode de `{ field: string, value: unknown, id: string }`. Le `id` est inclus pour la stabilite (tri deterministe meme si `field` a des doublons). Le curseur est opaque pour le client — il ne doit pas le parser.
  - **API surface** :
    - `service.listProducts({ cursor: "abc123", limit: 50 })` → retourne `{ data: Product[], metadata: { cursor: { next?: string, prev?: string, hasMore: boolean } } }`
    - `Query.graph({ entity: 'product', fields: [...], pagination: { cursor: "abc123", limit: 50 } })` → meme format de retour.
  - **Interaction avec offset** : `cursor` et `offset` sont mutuellement exclusifs. Passer les deux leve `MantaError(INVALID_DATA, 'Cannot use both cursor and offset pagination')`.
  - **Colonnes nullable et cursor pagination — restriction v1** : en v1, la pagination cursor est supportee **uniquement sur colonnes NON-nullable**. Si la colonne de tri est nullable (`deleted_at`, `published_at`, etc.), le framework leve `MantaError(INVALID_DATA, 'Cursor pagination on nullable column "{column}" is not supported. Use a non-nullable column like "created_at" or "id".')`. Cette restriction evite la complexite SQL du tri nullable (`NULLS FIRST/LAST`, cursor avec `isNull` flag) et garantit un comportement identique entre tous les adapters (pas de risque de portabilite). Le support des colonnes nullable sera ajoute en v2 si necessaire.
    - **Recommandation** : utiliser `created_at` (jamais null) ou `id` comme colonne de tri pour le cursor. Ces colonnes sont presentes sur toute entite (colonnes implicites SPEC-057f).
    - **Comportement avec soft-delete** : quand la pagination cursor est utilisee sur une entite avec soft-delete actif (filtre `WHERE deleted_at IS NULL` implicite, SPEC-126), les entites soft-deleted entre deux valeurs de cursor creent des "trous" dans la sequence. Ceci peut produire des pages avec moins d'elements que `limit`. C'est le comportement attendu du keyset pagination sur une table filtrée — ce n'est PAS un bug. Le `hasMore` dans la reponse est calcule en demandant `limit + 1` elements a la DB : si `limit + 1` elements sont retournes, `hasMore = true` et le dernier element est retire du resultat. Ce mecanisme reste correct meme avec les trous de soft-delete.
  - **Defaut** : les routes REST utilisent `limit/offset` par defaut (retro-compatibilite). Le dev peut forcer cursor via `defineMiddlewares()` ou la config de route. Les routes `/store` a fort trafic (products, collections) sont recommandees en cursor.
  - Garanties : deterministe sur les resultats (order by PK si pas de tri explicite). Compatible serverless (stateless, pas de session de pagination).

**SPEC-062 : BaseEntity avec ID prefixe automatique**
- Contrat : IDs generes avec prefixe (explicite via `prefix_id: 'prod'` -> `prod_xxxx`, ou infere du nom de classe).
- Garanties : pas de sequence DB, generation stateless.

---

### 9. Scheduled Jobs

#### Port : IJobSchedulerPort

**SPEC-063 : Jobs comme workflows schedules avec observabilite**
- Contrat : le port IJobSchedulerPort accepte des definitions de jobs (cron expression ou interval) et les execute comme workflows.
- Garanties : supporte cron expressions, interval en ms, concurrency control ('allow'|'forbid'), numberOfExecutions pour limiter les executions.
- **Concurrency control — implementation via ILockingPort** : quand `concurrency: 'forbid'`, l'adapter DOIT acquérir un lock via `ILockingPort.execute(keys: ['job:' + jobName], fn, { timeout })` avant d'executer le job. Si le lock est deja pris, le job est skip (pas d'attente). Cette dependance est **explicite dans le constructeur de l'adapter** : `constructor(private locking: ILockingPort, private logger: ILoggerPort, private storage: IWorkflowStoragePort, ...)`. L'adapter in-memory (node-cron) utilise `InMemoryLockingAdapter`. L'adapter Vercel Cron utilise `NeonLockingAdapter`. Un adapter qui ne respecte pas ce contrat a un bug — le concurrency control est une garantie du port, pas un detail d'implementation.
- **Dependances explicites du port** (3 ports injectés dans le constructeur de tout adapter IJobSchedulerPort) :
  - `ILockingPort` — pour le concurrency control (`concurrency: 'forbid'`)
  - `ILoggerPort` — pour le logging des resultats et erreurs
  - `IWorkflowStoragePort` — pour la persistence de l'historique des jobs (`getJobHistory()` stocke les `JobExecution` entries). Un adapter custom qui ne fournit pas `IWorkflowStoragePort` DOIT lever une erreur au register : `MantaError(INVALID_STATE, 'IJobSchedulerPort requires IWorkflowStoragePort for job history persistence')`.
  - Ces 3 dependances sont declarees dans la Conformance Suite (test J-09 etendu). Le dev qui cree un adapter custom voit immediatement quelles dependances sont requises.
- **Contrat de resultat et observabilite** :
  - Signature du handler : `execute(container: IContainer) -> Promise<JobResult>`.
  - `JobResult` : `{ status: 'success' | 'failure' | 'skipped', data?: unknown, error?: MantaError, duration_ms: number }`. `skipped` = le job n'a pas ete execute (lock deja pris quand `concurrency: 'forbid'`, ou `numberOfExecutions` atteint).
  - En cas d'echec : le port DOIT logger l'erreur via `ILoggerPort.error()` avec le nom du job, la duree, et l'erreur. Le job est marque `failure` dans l'historique.
  - **Retry** : configurable par job via `config.retry: { maxRetries: number, backoff: 'fixed' | 'exponential', delay: number }`. Defaut : `{ maxRetries: 0 }` (pas de retry). L'adapter DOIT implementer le retry en local (node-cron = retry in-process) ou le deleguer a l'infra.
  - **Retry cross-invocation (Vercel Cron)** : Vercel Cron envoie une nouvelle invocation HTTP pour chaque execution — il n'y a PAS de retry in-process. L'adapter Vercel Cron DOIT tracker l'etat du retry entre invocations via `IWorkflowStoragePort` :
    1. A chaque invocation, l'adapter lit le dernier `JobExecution` pour ce job depuis `IWorkflowStoragePort`.
    2. Si le dernier run a echoue et que `attempt < maxRetries`, l'adapter re-execute le job (incremente `attempt`). Le `delay` entre retries est gere par l'adapter via un check : `if (Date.now() - lastRun.finished_at < backoffDelay) → skip (return JobResult.skipped)`.
    3. Si le dernier run a reussi ou que `maxRetries` est epuise, l'adapter execute le job normalement (nouvelle execution, attempt=1).
    - Le test J-05 ("job qui echoue 2x puis reussit") DOIT fonctionner avec les deux adapters. Pour l'adapter Vercel Cron, le test simule 3 invocations HTTP successives et verifie que le state du retry est persiste entre elles via `IWorkflowStoragePort`.
  - **Progression** : pour les jobs long-running, le handler peut appeler `container.resolve('logger').progress(jobId, message)` pour signaler l'avancement. En serverless, le timeout est la seule limite — pas de heartbeat. Le TTL du job doit etre < timeout de la function serverless.
  - **Historique** : le port expose `getJobHistory(jobName, limit?) -> JobExecution[]` avec les derniers resultats. `JobExecution` : `{ job_name, started_at, finished_at, status, error?, attempt }`. Stocke via `IWorkflowStoragePort` (meme storage que les workflows). Les job histories sont dans le schema `workflow` (meme isolation que les checkpoints — table `workflow.job_executions`). Ceci permet une migration future vers un storage dedie sans impacter le schema applicatif.
  - Sur Vercel Cron : un job qui timeout retourne HTTP 504 — le port mappe ca en `status: 'failure'` avec erreur `JobTimeoutError`. L'adapter Vercel Cron DOIT verifier le header `x-vercel-cron-signature` pour securiser l'invocation.
- **Propagation AuthContext dans les jobs cron — contrat de l'adapter** : tout adapter IJobSchedulerPort DOIT, au demarrage de chaque job :
  1. Creer un scoped container via `container.createScope()`
  2. Enregistrer l'AuthContext systeme dans le scope : `scope.register('AUTH_CONTEXT', { actor_type: 'system', actor_id: 'cron' }, SCOPED)`
  3. Wraper l'execution du job dans `asyncLocalStorage.run(scope, ...)`
  - Ce mecanisme miroire l'etape 6 du pipeline HTTP (SPEC-039) pour les triggers cron. Un adapter custom qui oublie cette etape causera des `MantaError(INVALID_STATE)` quand un service tente de resoudre `AUTH_CONTEXT` depuis le scope. Le test de conformance J-10 (`cron > AuthContext systeme propage`) verifie ce contrat.
- Note serverless : en serverless, les cron triggers sont exterieurs (Vercel Cron, CloudWatch Events) et invoquent le workflow via HTTP.

**SPEC-091 : Schedule config et execution**
- Contrat : le handler recoit le container DI. Les jobs sont wrapes en steps avec error logging.
- Garanties : charge uniquement si `shouldLoadBackgroundProcessors()` (worker/shared mode).

**SPEC-092 : Convention fichier job avec auto-registration**
- Contrat : un fichier dans `src/jobs/` exporte default une function async et un export nomme `config: {name, schedule, numberOfExecutions?}`.
- Garanties : auto-decouverte par ResourceLoader. Support HMR en dev. Fichiers desactivables via `isFileSkipped()`.

---

### 10. File Storage

#### Port : IFilePort, IFileProvider

**SPEC-065 / SPEC-080 : IFilePort avec providers pluggables**
- Contrat : service de fichiers avec un seul provider actif a la fois.
- Methodes : `createFiles(upload)`, `deleteFiles`, `retrieveFile(presigned download URL)`, `listFiles`, `getDownloadStream(Readable)`, `getAsBuffer(Buffer)`, `getUploadStream(Writable + promise)`, `getUploadFileUrls(presigned upload URLs)`
- Garanties : les presigned URLs sont stateless. Architecture provider-based.

**SPEC-081 : IFileProvider contrat**
- Contrat : interface que chaque provider de fichier doit implementer.
- Methodes : `upload(dto)`, `delete(single|array)`, `getPresignedDownloadUrl`, `getPresignedUploadUrl` (optionnel), `getDownloadStream`, `getAsBuffer`, `getUploadStream`
- Garanties : un seul provider par instance de module.

**SPEC-081b : Multipart upload pour fichiers volumineux**
- Contrat : le port `IFileProvider` expose des methodes optionnelles pour le multipart upload (upload en chunks avec resume) :
  ```typescript
  interface IFileProvider {
    // ... methodes existantes (SPEC-081)

    // Multipart (optionnel — Recommande pour providers qui supportent > 100MB)
    initiateMultipartUpload?(key: string, contentType?: string): Promise<{ uploadId: string }>
    getMultipartUploadUrl?(key: string, uploadId: string, partNumber: number): Promise<{ presignedUrl: string }>
    completeMultipartUpload?(key: string, uploadId: string, parts: { partNumber: number, etag: string }[]): Promise<void>
    abortMultipartUpload?(key: string, uploadId: string): Promise<void>
  }
  ```
- **Flow client** :
  1. Client appelle `POST /uploads/multipart/initiate` → recoit `uploadId`
  2. Pour chaque chunk (5MB min par part, sauf le dernier) : client appelle `GET /uploads/multipart/url?uploadId=X&partNumber=N` → recoit presigned URL → PUT le chunk → recoit ETag
  3. Client appelle `POST /uploads/multipart/complete` avec la liste `[{ partNumber, etag }]` → le provider assemble le fichier
  4. En cas d'abandon : `POST /uploads/multipart/abort` → le provider nettoie les parts orphelines
- **Resume** : le client garde la liste des parts deja uploadees (partNumber + etag). En cas d'interruption, il reprend au partNumber suivant.
- **Providers** :
  - **Vercel Blob** : ne supporte PAS le multipart natif (limite 500MB en single PUT). Le framework ne wrape PAS — si le dev a besoin de multipart, il utilise un provider S3-compatible.
  - **S3 / R2 / MinIO** : supportent le multipart nativement. L'adapter S3 implemente les 4 methodes.
  - **Local filesystem** : le framework stocke les parts dans un dossier temporaire et les concatene au `complete`. Cleanup des parts au `abort` ou via TTL (24h).
- **Dependance presigned URLs** : le multipart upload depend de `getPresignedUploadUrl` (SPEC-081) pour generer les URLs par part. Un provider qui implemente le multipart DOIT aussi implementer `getPresignedUploadUrl`. `initiateMultipartUpload` et `getMultipartUploadUrl` ne fonctionnent pas sans presigned URLs. Si un provider declare `initiateMultipartUpload` sans `getPresignedUploadUrl`, le framework leve `MantaError(INVALID_STATE, 'Multipart upload requires getPresignedUploadUrl')` au register.
- **TTL des uploads incomplets** : les multipart uploads non-completes apres 24h sont nettoyes par un job cron (`file:cleanup-multipart`, quotidien). L'adapter DOIT supporter le listing des uploads en cours pour le cleanup.
- **Limite de taille** : configurable par provider. Le framework valide la taille totale avant le `complete` (somme des parts). Depassement → `MantaError(INVALID_DATA, 'File size exceeds maximum of {maxSize}')`.
- Compatibilite serverless : ✅ Compatible (chaque requete est independante, presigned URLs sont stateless).

---

### 11. Cache

#### Port : ICachePort, ICachingPort

**SPEC-064 / SPEC-077 : ICachePort (simple) : get/set/invalidate/clear**
- Contrat : contrat minimal de cache key-value.
- Methodes : `get(key)`, `set(key, data, ttl?)`, `invalidate(key)`, `clear()`
- **Semantique de `invalidate(key)`** : supprime UNE cle exacte (pas de glob). Pour l'invalidation groupee, utiliser le **version-key pattern** (SPEC-078) : les cles incluent un numero de version (`cache:v5:products:123`), invalider = incrementer la version (O(1)). Les anciennes cles expirent naturellement via TTL. Ce design garantit O(1) pour toute invalidation, compatible serverless sans SCAN.
- **Pas de `invalidate(pattern)` glob dans le port** : le glob pattern (`user:*`) est un anti-pattern en production (necessite SCAN, O(n), couteux sur Upstash). Le code metier utilise le version-key pattern ou `invalidate(key)` pour une cle specifique. L'invalidation par tag est geree par ICachingPort (SPEC-079) qui maintient un mapping tag→keys.
- Garanties : TTL defaut 30s. TTL=0 skip le cache. Module requis.

**SPEC-078 : Cache avec namespacing et version-key invalidation**
- Contrat : le cache peut utiliser un namespace configurable pour prefixer les cles. Invalidation par version key : les cles incluent un numero de version (`cache:v5:products:123`), la version courante est dans une cle dediee. Invalider = incrementer la version (O(1)). Les anciennes cles expirent via TTL. Ne PAS utiliser SCAN + DEL (couteux en serverless, facture par commande).
- Garanties : serialisation JSON pour stockage.

**SPEC-079 : ICachingPort avance avec tags, multi-providers et auto-invalidation**
- Contrat : couche avancee au-dessus de ICachePort.
- Methodes : `computeTags()`, `computeKey()`, `@Cached` decorator, `useCache()` programmatique
- Garanties : tags pour invalidation groupee. Multi-providers avec TTL par provider. Strategy pattern avec auto-invalidation event-driven. Request deduplication. Memory-aware provider avec maxSize et maxKeys.

---

### 12. Locking

#### Port : ILockingPort

**SPEC-066 / SPEC-089 / SPEC-090 : ILockingPort — verrouillage distribue (fusionne Service + Provider)**
- Contrat : port unique de verrouillage distribue. Fusionne l'ancien ILockingService et ILockingProvider en un seul contrat.
- Methodes : `execute(keys, job, {timeout})` (lock-then-execute-then-release atomique), `acquire(keys, {ownerId, expire})`, `release(keys, {ownerId})`, `releaseAll({ownerId})`
- Garanties : support multi-cles pour locks composes. TTL de lock essentiel pour eviter les locks abandonnes en serverless. Un seul adapter actif a la fois (InMemoryLockingAdapter, NeonLockingAdapter, etc.).

---

### 13. Logging

#### Port : ILoggerPort

**SPEC-067 / SPEC-082 : ILoggerPort avec niveaux et activity tracking**
- Contrat : interface de logging avec 8 niveaux (error, warn, info, http, verbose, debug, silly, panic).
- Methodes : `error(msg)`, `warn(msg)`, `info(msg)`, ..., `activity(msg) -> id`, `progress(id, msg)`, `success(id, msg)`, `failure(id, msg)`, `panic(data)`, `shouldLog(level) -> boolean`
- Garanties : LOG_LEVEL configurable via env var. `setLogLevel`/`unsetLogLevel` pour modification runtime.

**SPEC-083 : Logger injectable et configurable**
- Contrat : le logger est enregistre via ContainerRegistrationKeys.LOGGER. Remplacable par un logger custom via config.
- Garanties : tous les modules resolvent le logger depuis le container. Permet de substituer l'implementation par un logger adapte a la plateforme.

---

### 14. Notification

#### Port : INotificationPort, INotificationProvider

**SPEC-097 : INotificationPort envoi multi-canal avec idempotence**
- Contrat : envoi de notifications multi-canal (email, sms, push) via channel-based provider routing.
- Methodes : `send(notification)`, `list()`, `retrieve(id)`
- Garanties : idempotence via idempotency_key (skip si SUCCESS, retry si FAILURE). Status tracking PENDING -> SUCCESS/FAILURE. Batch send avec aggregateErrors. Transaction-safe creation.

**SPEC-098 : INotificationProvider avec multi-canal et enable/disable**
- Contrat : chaque provider declare ses canaux (`channels: ['email', 'sms']`) et peut etre active/desactive.
- Methodes : `send(notification) -> {id}`
- Garanties : routing automatique par canal.

**SPEC-099 : Notification data model**
- Contrat : modele riche : to, from, channel, template, data (JSON rendering), provider_data (cc/bcc), trigger_type, resource_id/resource_type, receiver_id, original_notification_id (retry), idempotency_key, external_id, status.

---

### 15. Plugin / Extension System

**SPEC-068 / SPEC-093 : Systeme de plugins NPM/local avec conventions**
- Contrat : plugins declares comme strings ou `{resolve, options}`. Chaque plugin expose : subscribers, jobs, workflows, links, modules, API routes, policies, admin.
- **Type `PluginConfig` (definition complete)** :
  ```typescript
  interface PluginConfig {
    // Discovery paths (filesystem conventions)
    subscribers?: string       // default: "src/subscribers" — glob pattern relative to plugin root
    jobs?: string              // default: "src/jobs"
    workflows?: string         // default: "src/workflows"
    links?: string             // default: "src/links"
    api?: string               // default: "src/api"
    admin?: string             // default: "src/admin"

    // Explicit declarations
    modules?: ModuleConfig[]   // modules contributed by the plugin
    policies?: PolicyConfig[]  // RBAC policies
    options?: Record<string, unknown>  // plugin-specific options passed by the consumer

    // Metadata
    name: string               // unique plugin identifier (npm package name)
    version?: string           // semver, read from package.json
  }
  ```
  - Le plugin exporte sa config via `export default definePlugin(config: PluginConfig)` dans son `index.ts`.
  - `definePlugin()` valide la config au build time (Zod schema). Un plugin sans `definePlugin()` export est traite en mode legacy (discovery filesystem uniquement).
  - **Validation des options du plugin** : `definePlugin()` accepte un `optionsSchema?: ZodSchema` optionnel. Si fourni, le framework valide les `options` passees par le consumer au boot (etape 5 — chargement des plugins). Si la validation echoue → `MantaError(INVALID_DATA, 'Plugin "@manta/plugin-stripe" options validation failed: apiKey is required')`. Si `optionsSchema` n'est pas fourni, les options sont passees telles quelles (pas de validation). Le plugin accede a ses options via `pluginConfig.options` dans ses modules/subscribers/jobs. Exemple :
    ```typescript
    // Plugin definition
    export default definePlugin({
      name: '@manta/plugin-stripe',
      optionsSchema: z.object({ apiKey: z.string(), webhookSecret: z.string() }),
      modules: [...]
    })
    // Consumer
    defineConfig({ plugins: [{ resolve: '@manta/plugin-stripe', options: { apiKey: process.env.STRIPE_KEY, webhookSecret: process.env.STRIPE_WEBHOOK } }] })
    ```
  - Le consumer declare le plugin dans `defineConfig({ plugins: ["@manta/plugin-x", { resolve: "@manta/plugin-y", options: { ... } }] })`.
  - Le framework merge les contributions de chaque plugin dans l'ordre declare.
  - **Resolution des chemins de discovery — contrat explicite** :
    - Les chemins dans `PluginConfig` (`subscribers`, `jobs`, `workflows`, `links`, `api`, `admin`) sont **relatifs a la racine du package du plugin** (le dossier contenant le `package.json` du plugin).
    - Le framework resout la racine du plugin via une detection automatique du module system :
      - **CJS** (`"type": "commonjs"` ou absent dans package.json) : `require.resolve(pluginName + '/package.json')` puis `path.dirname()`.
      - **ESM** (`"type": "module"` dans package.json) : `import.meta.resolve(pluginName + '/package.json')` puis extraction du dirname depuis l'URL retournee.
      - Le framework detecte le module system au boot (lecture de son propre `package.json`). Le choix entre `require.resolve` et `import.meta.resolve` est fait une seule fois, PAS par plugin. En 2026, `import.meta.resolve` est supporte dans Node.js >= 20.x (stable) et >= 18.19 (unflagged). Le framework DOIT supporter les deux — c'est un prerequis pour fonctionner avec Next.js App Router (ESM obligatoire).
    - Tous les chemins de discovery sont resolus relativement a ce dossier.
    - **Monorepo (pnpm workspaces, Turbo)** : la resolution fonctionne nativement car `require.resolve` suit les symlinks de `node_modules`. Un plugin dans `packages/my-plugin` avec `subscribers: "src/subscribers"` resout vers `packages/my-plugin/src/subscribers/` via le symlink.
    - **Plugins compiles** : si le plugin est distribue compile (npm), les chemins pointent vers le dossier de build (ex: `dist/subscribers`). Le plugin DOIT configurer ses chemins en consequence dans son `definePlugin()`. Le defaut `src/subscribers` est pense pour le dev local — les plugins publies doivent overrider.
    - **Chemins absolus** : si un chemin commence par `/`, il est utilise tel quel (pas de resolution relative). Utile pour les cas edge (plugins locaux hors monorepo). Deconseille en production.
    - **Chemin inexistant** : si un chemin de discovery ne pointe vers aucun dossier existant, il est silencieusement ignore (pas d'erreur). C'est le comportement attendu — un plugin peut ne pas avoir de subscribers, par exemple.
- Garanties : le projet local (`src/`) est traite comme un 'project-plugin'. Resolution via package.json. `mergePluginModules()` fusionne les modules.
- **Conflits de routes inter-plugins** :
  - Si deux plugins declarent la meme route (meme path + meme methode HTTP), le comportement est **last-wins** selon l'ordre de declaration dans `defineConfig({ plugins: [...] })`. Le dernier plugin dans le tableau a priorite.
  - Le framework log un **warning** au boot : `Route conflict: POST /admin/products declared by both "@manta/plugin-a" and "@manta/plugin-b". Using "@manta/plugin-b" (last declared).`
  - En **strict mode** (`defineConfig({ strict: true })`), un conflit de route inter-plugins leve une `MantaError(INVALID_DATA, 'Route conflict: ...')` et le boot echoue. Le dev doit resoudre explicitement le conflit.
  - **Ordre de priorite complet** (du plus faible au plus fort) :
    1. Routes des plugins (dans l'ordre de `plugins[]`)
    2. Routes du projet local (`src/api/`)
    3. Overrides explicites via `defineMiddlewares()` custom
  - Le projet local a TOUJOURS priorite sur les plugins. Un plugin ne peut pas surcharger une route definie dans `src/api/` (le warning est emis mais la route du projet est gardee).
  - **Methodes distinctes** : deux plugins peuvent declarer le meme path avec des methodes differentes (ex: plugin A = GET /products, plugin B = POST /products). Ce n'est PAS un conflit — les deux sont enregistres.

**SPEC-094 : Pipeline de chargement ordonne**
- Contrat : chargement sequentiel : Plugins -> Links -> Policies -> Modules -> Workflows -> Subscribers -> Jobs -> Entrypoints.
- Garanties : les plugins contribuent a chaque etape. Jobs uniquement en mode worker/shared. Entrypoints skippes en mode worker.
- **Detection de conflits de nommage entre modules** : au boot (etape Modules), le framework verifie que chaque `serviceName` dans les `__joinerConfig()` est unique. Si deux modules declarent le meme `serviceName` (ex: plugin A et plugin B fournissent tous les deux un module avec `serviceName: 'product'`), le boot leve `MantaError(INVALID_STATE, 'Module serviceName "product" declared by both "@manta/plugin-a:ProductModule" and "@manta/plugin-b:ProductModule". Each module must have a unique serviceName.')`. Les entites DML portees par chaque module sont namespacees par le `serviceName` du module dans le RemoteJoiner — deux modules differents peuvent avoir une entite "Product" tant que leurs `serviceName` sont distincts (le joiner reference `moduleA.Product` vs `moduleB.Product`). Le conflit est sur le `serviceName`, pas sur le nom d'entite.
- **Detection de dependances circulaires entre plugins** : le framework construit un graphe de dependances entre modules au boot (basé sur les injections de container). Avant l'etape Modules, il execute une detection de cycle (DFS topologique). Si un cycle est detecte (plugin A → module X depend de service Y du plugin B → module Z depend de service W du plugin A), le boot leve `MantaError(INVALID_STATE, 'Circular dependency detected: pluginA:moduleX → pluginB:moduleZ → pluginA:moduleX')`. Le message inclut la chaine complete du cycle pour faciliter le debug. Cette detection s'applique aussi aux modules du projet local, pas seulement aux plugins. En strict mode, la detection est plus aggressive : elle analyse aussi les dependances transitives via les events (subscriber du plugin A ecoute un event emis par le plugin B et vice-versa) — ces cycles ne bloquent pas le boot mais levent un warning.

---

### 16. Analytics

#### Port : IAnalyticsProvider

**SPEC-102 : Analytics module — IAnalyticsModuleService avec providers pluggables**
- Contrat : module d'analytics avec architecture provider-based. Un seul provider actif a la fois (prefixe 'aly_').
- Methodes : `track(data)` pour tracer des evenements (event name + properties), `identify(data)` pour identifier un acteur ou un groupe, `getProvider()` pour acceder au provider sous-jacent.
- Garanties : provider implemente IAnalyticsProvider avec `track()`, `identify()`, `shutdown()` optionnel. Hook onApplicationShutdown pour flush des donnees. Configuration via `providers[]` dans les options du module.

**SPEC-103 : IAnalyticsProvider — contrat provider**
- Contrat : interface pour implementer des providers analytics custom.
- Methodes : `track(ProviderTrackAnalyticsEventDTO)`, `identify(ProviderIdentifyAnalyticsEventDTO)`, `shutdown?()` optionnel.
- Garanties : detection statique via `getRegistrationIdentifier()`. Decouverte automatique via loader dedie.

---

### 17. Search / Index

#### Port : ISearchProvider, IIndexPort

**SPEC-104 : Index module — IIndexPort avec data synchronization event-driven**
- Contrat : indexation de donnees avec synchronisation event-driven via EventBus.
- Methodes : `query<TEntry>(config)` pour interroger l'index avec typage generique, `sync({strategy})` avec 3 strategies ('full', 'reset', 'continue'), `getInfo()` retournant metadata (entity, status, fields, last_synced_key).
- Garanties : status tracking (pending/processing/done/error). Schema GraphQL configurable. Worker mode requis pour la sync (long-running). Events: 'index.continue-sync', 'index.full-sync', 'index.reset-sync'. Partitionnement des donnees supporte.
- Note serverless : les queries sont compatibles, la sync necessite un worker separe.

**SPEC-105 : Index Query Config et Schema GraphQL**
- Contrat : `IndexQueryConfig<TEntry>` pour requetes typees, `QueryResultSet<TEntry>` pour resultats, `IndexModuleOptions` avec schema GraphQL et customAdapter.
- Garanties : le schema GraphQL est parse pour construire un `SchemaObjectRepresentation` interne et generer les types TypeScript.

**SPEC-106 : Search abstraction — AbstractSearchService avec 8 methodes CRUD**
- Contrat : `ISearchProvider` et `AbstractSearchService` pour engines de recherche pluggables.
- Methodes : `createIndex(indexName, options)`, `getIndex(indexName)`, `addDocuments(indexName, documents, type)`, `replaceDocuments(indexName, documents, type)`, `deleteDocument(indexName, document_id)`, `deleteAllDocuments(indexName)`, `search(indexName, query, options)`, `updateSettings(indexName, settings)`.
- Garanties : detection via `_isSearchService` statique. Propriete abstract `isDefault`. Concu pour Algolia, MeiliSearch, etc. Stateless, parfaitement adapte au serverless.

---

### 18. Settings (Configuration persistante)

#### Port : ISettingsPort

**SPEC-104-S : Settings module — ISettingsModuleService avec resolution en cascade**
- Contrat : gestion des parametres utilisateur et configurations de vues.
- Methodes : CRUD ViewConfigurations (validation system default sans user_id, unicite par entity), CRUD UserPreferences avec `getUserPreference/setUserPreference`, `getActiveViewConfiguration` (resolution en cascade: preference utilisateur > vue personnelle > system default), `setActiveViewConfiguration` avec validation d'acces, `clearActiveViewConfiguration`.
- Garanties : modeles ViewConfiguration (entity, name, user_id, is_system_default, configuration JSON avec visible_columns/column_order/column_widths/filters/sorting/search) et UserPreference (user_id, key, value JSON, index unique user_id+key). Updates via upsertWithReplace pour eviter le merge JSON.

---

### 19. Translation / i18n

#### Port : ITranslationPort

> **Note d'implementation** : le module Translation (SPEC-105-T a T8) est `Recommande`, pas obligatoire. Son implementation DOIT etre une phase separee du framework core. En particulier, SPEC-105-T4 (JOIN transparent pour filtres sur champs traduits) est complexe (reecriture SQL, redirection ORDER BY, cas mixtes) et merite son propre cycle de dev/test. Ne PAS implementer T4 en meme temps que le core — commencer par T3 (post-query, simple) puis T4 en v2.
>
> Architecture : Pattern "table de traductions separee". La table principale reste intacte (schema propre, colonnes homogenes). Les traductions sont stockees dans une table `translations` unique avec JSONB. Le framework applique les traductions de facon transparente apres la query. Le dev declare `.translatable()` sur les champs texte, le reste est automatique.
>
> Choix de design vs alternatives :
> - Colonnes par langue (`title_en`, `title_fr`) : rejete — ALTER TABLE a chaque langue, non scalable
> - Row per locale (Strapi 5) : rejete — duplique les champs non-traduits (price, stock), probleme de consistance
> - JSONB inline par champ (Payload CMS) : rejete — colonnes mixtes text/jsonb, schema heterogene, migrations complexes quand un champ devient translatable
> - Table separee (retenu) : schema propre, opt-in via `.translatable()`, module desactivable, compatible recherche via JOIN transparent

**SPEC-105-T : Translation module — schema et modeles**
- Contrat : module i18n complet avec 3 modeles Drizzle :

- **Locale** : `id` (prefix `loc_`), `code` TEXT UNIQUE (BCP 47, ex: `en-US`, `fr-FR`), `name` TEXT, timestamps. Index unique sur `code` avec soft-delete filter. 70+ locales pre-chargees par defaut.

- **Translation** : `id` (prefix `trans_`), `reference_id` TEXT (ID de l'entite source, ex: `prod_xxx`), `reference` TEXT (type d'entite, ex: `product`), `locale_code` TEXT (BCP 47), `translations` JSONB (ex: `{"title": "Chemise", "description": "..."}`), `translated_field_count` INTEGER (pre-calcule, compte uniquement les champs non-null/non-vides), timestamps.
  - Index unique : `(reference_id, locale_code)` — une seule traduction par entite par langue
  - Index composite : `(reference_id, reference, locale_code)` — recherche par type + ID + langue
  - Index : `(reference, locale_code)` — listing par type + langue
  - Index GIN : `translations` — recherche full-text dans les traductions JSONB
  - Tous les index incluent `WHERE deleted_at IS NULL`

- **TranslationSettings** : `id` (prefix `trset_`), `entity_type` TEXT UNIQUE (ex: `product`), `fields` JSON (ex: `["title", "description", "subtitle"]`), `is_active` BOOLEAN DEFAULT TRUE, timestamps. Synchronise automatiquement avec les declarations DML.

**SPEC-105-T2 : Auto-discovery des champs translatables via DML**
- Contrat : les champs marques `.translatable()` dans le DML sont automatiquement decouverts au demarrage.
- Mecanisme : chaque `DmlEntity` enregistre ses champs translatables dans un registre global (`TRANSLATABLE_ENTITIES`). Au boot, le module Translation compare ce registre avec `translation_settings` en DB : cree les manquants, desactive les obsoletes.
- API : `DmlEntity.getTranslatableEntities()` retourne `[{ entity: "Product", fields: ["title", "description"] }, ...]`
- Garantie : aucune configuration manuelle. Le dev ajoute `.translatable()` sur un champ, le framework fait le reste.

**SPEC-105-T3 : Application transparente des traductions sur les queries**
- Contrat : quand un `locale` est specifie (header `x-manta-locale`, query param `?locale=fr`, ou option `{ locale: "fr" }` dans `query.graph()`), le framework applique automatiquement les traductions sur les resultats.
- Flow :
  1. Query normale sur la table principale (ex: `products`)
  2. `gatherIds()` extrait recursivement TOUS les IDs des resultats (entites + relations imbriquees)
  3. Query batchee sur `translations` (250 IDs par batch, cachee) pour le locale demande
  4. `applyTranslation()` remplace les valeurs des champs translatables dans les resultats
  5. Le dev recoit les resultats deja traduits — transparence totale
- Garanties : batching 250 IDs par query pour eviter N+1. Cache active sur les queries de traduction. Recursion dans les objets imbriques (ex: product → variants → options). Seuls les champs declares dans `translation_settings.fields` sont remplaces (whitelist).
- **Limite de volume** : les traductions sont appliquees APRES la query principale, qui est paginee (SPEC-011 : `limit: 100` par defaut). Donc le nombre max d'IDs a traduire est borne par `limit * profondeur_relations`. Pour 100 produits avec 10 variants chacun = 1100 IDs = 5 batches de 250. Pas de scenario 50k IDs en conditions normales. Si un dev bypass la pagination (`limit: Infinity`), c'est son probleme — le framework log un warning si plus de 5000 IDs sont traduits en une seule passe.

**SPEC-105-T4 : Recherche sur les champs traduits**
- Contrat : quand un `locale` est specifie et qu'un filtre porte sur un champ `.translatable()`, le framework redirige automatiquement le filtre vers la table `translations` via un JOIN transparent.
- **Distinction avec SPEC-105-T3** — les deux mecanismes ne sont PAS interchangeables :
  - **SPEC-105-T3 (post-query)** : s'applique quand il n'y a PAS de filtre sur un champ traduit. La query principale s'execute normalement, puis les traductions sont appliquees sur les resultats. C'est le cas par defaut (lecture simple avec locale).
  - **SPEC-105-T4 (pre-query JOIN)** : s'applique UNIQUEMENT quand un filtre porte sur un champ `.translatable()` avec un locale specifie. Le framework detecte le filtre traduit et reecrit la query SQL avec un JOIN.
  - **Decision automatique — conditions exactes** : le framework inspecte les `filters` de la query. La decision T3 vs T4 repose sur **deux conditions cumulatives** :
    1. AU MOINS UN filtre reference un champ marque `.translatable()` dans le DML
    2. ET un `locale` est specifie dans les options de la query (`{ locale: "fr" }`)
    - Si les deux conditions sont remplies → SPEC-105-T4 (JOIN) — en v1 : `MantaError(NOT_IMPLEMENTED)`.
    - Si locale present MAIS aucun filtre sur champ `.translatable()` → SPEC-105-T3 (post-query). Le locale sert a appliquer les traductions sur les resultats, pas a filtrer.
    - Si filtre sur champ `.translatable()` MAIS pas de locale → le filtre s'applique sur la **colonne principale** (langue par defaut). C'est le chemin normal, ni T3 ni T4.
    - Si ni locale ni filtre translatable → chemin normal, pas de traduction.
    - **Pour le test T-11** : la query DOIT combiner les deux conditions : un filtre sur un champ `.translatable()` (ex: `title`) ET un `locale` (ex: `"fr"`). L'absence de l'une des deux conditions ne declenche PAS T4.
  - **Cas mixte (filtre traduit + pagination)** : quand SPEC-105-T4 s'applique, le `limit`/`offset` s'applique APRES le JOIN, donc sur les resultats filtres par traduction. La pagination est correcte. Cependant, l'`ORDER BY` sur un champ traduit DOIT aussi etre redirige vers `translations->>'field'` (pas vers la colonne principale). Le framework detecte ceci automatiquement.
  - **Les deux mecanismes sont exclusifs mutuellement pour une meme query** : soit post-query (T3), soit JOIN (T4). Pas de double application.
- Exemple — le dev ecrit :
  ```typescript
  const products = await query.graph({
    entity: "product",
    fields: ["id", "title", "description"],
    filters: { title: { $ilike: "%chemise%" } },
  }, { locale: "fr" })
  ```
- Le framework detecte que `title` est `.translatable()` et reecrit en :
  ```sql
  SELECT p.* FROM products p
  JOIN translations t ON t.reference_id = p.id
    AND t.locale_code = 'fr'
  WHERE t.translations->>'title' ILIKE '%chemise%'
  ORDER BY t.translations->>'title'  -- si orderBy: { title: "ASC" }
  LIMIT 100 OFFSET 0
  ```
- Les champs NON-translatables dans le meme filtre restent sur la table principale : `WHERE p.status = 'published' AND t.translations->>'title' ILIKE '%chemise%'`
- Sans locale : le filtre s'applique normalement sur la table principale (langue par defaut)
- Avec locale mais sans filtre traduit : SPEC-105-T3 (post-query) s'applique
- Index GIN sur `translations.translations` pour la performance
- Recherche cross-langue (sans filtre de locale) : `translations::text ILIKE '%chemise%'`
- Pour la recherche full-text avancee : utiliser ISearchProvider (Algolia, Meilisearch) qui indexe les traductions nativement
- **v1 : T4 non-implemente** : en v1 du framework, seul T3 (post-query) est implemente. Si un dev applique un filtre sur un champ `.translatable()` avec un locale specifie, le framework leve `MantaError(NOT_IMPLEMENTED, 'Filtering on translatable fields (T4 JOIN) is not supported in v1. Use ISearchProvider for translated search, or filter on the default language column.')`. Ce comportement explicite evite que le filtre s'applique silencieusement sur la colonne principale (langue par defaut) au lieu de la traduction — ce qui retournerait des resultats incorrects. Le test T-11 dans la Conformance Suite verifie cette erreur.
- **Mecanisme de tests temporaires (v1-only)** : le test T-11 est marque `@since("1.0.0") @until("2.0.0")` dans la Conformance Suite. La suite de conformance utilise le champ `version` de `runTranslationConformance({ version })` pour inclure/exclure les tests marques `@until`. Quand T4 est implemente en v2, le test T-11 est automatiquement exclu par la version, et les tests T4 (T-12+) sont inclus via `@since("2.0.0")`. Ce mecanisme evite qu'un dev oublie de retirer T-11 manuellement. Chaque test temporaire DOIT avoir un `@until` — un test sans `@until` est permanent.

**SPEC-105-T5 : DX d'ecriture — traductions inline dans create/update**
- Contrat : le dev peut passer les traductions directement dans `create()` et `update()` via un champ `_translations` :
  ```typescript
  await service.createProducts({
    title: "Shirt",
    description: "A nice shirt",
    _translations: {
      "fr": { title: "Chemise", description: "Une belle chemise" },
      "de": { title: "Hemd", description: "Ein schones Hemd" }
    }
  })
  ```
- Le framework splitte automatiquement : insert dans `products` (langue par defaut) + inserts dans `translations` (une row par locale).
- Meme pattern pour `update()` : le framework detecte `_translations`, met a jour les rows existantes dans `translations` ou en cree de nouvelles.
- Alternative : API directe `translationService.createTranslations()` pour les cas avances (import bulk, migration).

**SPEC-105-T6 : Statistiques de traduction**
- Contrat : `getStatistics(input)` calcule les metriques de completion par entite et par locale.
- Calcul : expected = `nombre_entites x champs_translatables x locales`, translated = `SUM(translated_field_count)`, missing = expected - translated.
- `translated_field_count` est pre-calcule a chaque create/update de traduction — pas de scan JSONB a l'aggregation, simple `SUM()` SQL.
- Garantie : performance O(1) par aggregation grace au champ pre-calcule.

**SPEC-105-T7 : Locale resolution dans le HTTP layer**
- Contrat : le locale est resolu dans cet ordre de priorite :
  1. Query param `?locale=fr`
  2. Header `x-manta-locale: fr`
  3. Absent = langue par defaut (pas de traduction appliquee)
- Normalisation : `en_US`, `en_us`, `EN-us` → `en-US` (BCP 47)
- Le locale resolu est passe automatiquement a `query.graph()` via les options
- Fonctionne sur tous les triggers (http, queue, cron) — le locale est une donnee du contexte, pas du middleware HTTP

**SPEC-105-T8 : Feature flag et desactivation**
- Contrat : le module Translation est desactivable via feature flag `translation`.
- Quand desactive : `applyTranslations()` est un no-op, aucune query supplementaire, zero overhead.
- Quand active : toutes les queries avec locale passent par le pipeline de traduction.
- Le module peut etre completement absent de la config — le framework fonctionne sans.

---

### 20. Telemetry / Observability

#### Port : ITracerPort, ITelemeterPort

**SPEC-069 : OpenTelemetry integration via Tracer et hooks statiques**
- Contrat : classe Tracer wrappant le SDK OTEL.
- Methodes : `trace(name, callback)`, `getActiveContext()`, `getPropagationState()`, `withPropagationState()`
- Garanties : hooks de tracing dans les composants cles (API routes, middleware, query, workflow steps, cache). Fichier `instrumentation.ts` optionnel pour initialisation.
- **Propagation du trace context entre modules externes** : quand `Query.graph()` ou le RemoteJoiner appelle un module externe (scope: external) via HTTP, le framework propage les headers **W3C TraceContext** (`traceparent`, `tracestate`) dans la requete sortante. Le module distant les lit et cree un child span. Ceci garantit un trace distribue continu entre services. Le mecanisme :
  1. Le RemoteJoiner appelle `tracer.getPropagationState()` pour obtenir le `traceparent` et `tracestate` du span courant.
  2. Il ajoute ces headers a la requete HTTP vers le module externe : `{ 'traceparent': '00-...', 'tracestate': 'manta=...' }`.
  3. Le module distant (qui utilise aussi Manta) lit ces headers dans l'etape 1 (RequestID) du pipeline et appelle `tracer.withPropagationState(headers, callback)` pour creer un child span lie au parent.
  - **Adapter sans tracing** : si `ITracerPort` n'est pas configure (no-op adapter), les headers ne sont pas ajoutes. Le module distant cree un trace independant. Pas d'erreur.
  - Compatibilite : W3C TraceContext est le standard supporte par Datadog, Jaeger, Honeycomb, AWS X-Ray, Google Cloud Trace.

**SPEC-095 : Telemeter anonyme avec opt-out et batching**
- Contrat : tracking anonyme d'usage (events CLI, OS info, versions, modules actifs).
- Garanties : batching configurable. Opt-out total disponible. Machine ID anonyme.

**SPEC-096 : Cache tracing hooks**
- Contrat : hooks statiques `traceGet`, `traceSet`, `traceClear` pour instrumenter les operations de cache.

---

### 21. CLI

**SPEC-070 / SPEC-084 : CLI start -- serveur HTTP production**
- Contrat : demarre le serveur en production avec cluster mode, instrumentation OTEL, health check, graceful shutdown.
- Note : commande serveur long-running. En serverless, le bootstrap est reutilise mais pas le serveur.

**SPEC-085 : CLI develop -- dev server avec file watching et HMR**
- Contrat : mode developpement avec file watching et hot reload.

**SPEC-086 : CLI exec -- execution de scripts**
- Contrat : charge le container complet et execute un script avec `{container, args}`.
- **Scope et AuthContext** : le framework cree un scoped container via `container.createScope()`, enregistre l'AuthContext CLI dans le scope : `scope.register('AUTH_CONTEXT', { actor_type: 'system', actor_id: 'cli' }, SCOPED)`, et wrape l'execution dans `asyncLocalStorage.run(scope, ...)`. Le script recoit `{ container: scopedContainer, args }`. Ce mecanisme miroire le pipeline HTTP (etape 4) et les cron jobs (J-10) — meme pattern, AuthContext different. Les events emis depuis le script portent `{ actor_type: 'system', actor_id: 'cli' }` dans `metadata.auth_context`.
- **Convention transactionnelle** : le framework NE wrape PAS automatiquement le script dans une transaction. Le dev est responsable de gerer ses propres transactions via `container.resolve('IDatabasePort').transaction(fn)`. Un script qui echoue a mi-chemin sans transaction laisse les donnees dans un etat partiel — c'est la responsabilite du dev.
- **Option `--dry-run`** : execute le script dans une transaction qui est rollback a la fin. Utile pour tester des scripts de migration de donnees sans risque. Usage : `manta exec --dry-run scripts/fix-data.ts`. **Events en --dry-run** : le framework appelle `context.messageAggregator.clearMessages()` apres execution, AVANT le rollback de la transaction. Aucun event n'est emis — comportement coherent avec le chemin d'erreur de `@EmitEvents()` (un rollback = pas d'events). Le dev voit les events bufferises dans les logs (si `--verbose`) mais ils ne sont jamais publies.
  - **--dry-run et workflows** : si le script lance un workflow via `engine.run()`, le workflow a ses **propres** grouped events geres par le workflow engine (pas par le script). Le `clearMessages()` du script ne touche que le `IMessageAggregator` du scope du script — il ne touche PAS les grouped events du workflow engine. Le workflow commit ses events normalement (via le workflow engine lifecycle), meme en dry-run. C'est une **limitation connue** : `--dry-run` ne garantit PAS l'absence d'effects pour les workflows. Si le dev veut un dry-run complet, il doit utiliser un `InMemoryWorkflowEngine` (pas de persistence, pas de publication) via une config de test. Le framework log un warning si un workflow est lance en mode `--dry-run` : `Warning: Workflow "{workflowId}" was executed during --dry-run. Workflow events are NOT rolled back — use InMemoryWorkflowEngine for a fully isolated dry-run.`
  - **Isolation inter-process (--dry-run + cron concurrent)** : la transaction dry-run utilise l'isolation `READ COMMITTED` par defaut (meme que les transactions normales). Pendant le dry-run, les writes non-committed sont **invisibles** aux autres transactions (cron jobs, requetes HTTP concurrentes). Les lectures du dry-run voient les donnees committees par les autres — pas de dirty reads dans aucun sens. Le seul risque est un **deadlock** si le dry-run et un cron job tentent de modifier les memes rows : PostgreSQL detecte le deadlock et annule l'une des transactions (typiquement la plus recente). Le framework ne fournit PAS d'isolation supplementaire — c'est le comportement standard PostgreSQL `READ COMMITTED`. Le dev est responsable de ne pas lancer `--dry-run` sur des tables activement modifiees par des cron jobs si la coherence inter-process est critique.
- **Securite en production** : en production serverless, `manta exec` necessite un acces direct au container (pas via HTTP). Le dev DOIT utiliser un environnement local pointe sur la DB de production (via connection string) ou un script CI/CD dedie. `manta exec` ne passe PAS par le pipeline HTTP — pas de rate limiting, pas de middleware. Le dev a un acces total au container mais avec un scope ALS actif et un AuthContext `system/cli`.

**SPEC-087 : CLI db -- suite complete de commandes database**
- Contrat : `db:migrate`, `db:generate`, `db:rollback`, `db:sync-links`, `db:create`, `db:setup`, `db:run-scripts`.
- **`db:diff` — comparaison schema DML vs DB reelle** :
  - **Quoi** : compare le schema Drizzle genere depuis le DML (SPEC-057f) avec le schema reel de la DB (via introspection PostgreSQL `information_schema`).
  - **Methode** — `manta db:diff` ne depend PAS de `drizzle-kit generate` ni de `drizzle-kit introspect`. C'est une commande framework qui :
    1. Execute le generateur DML → Drizzle (SPEC-057f) pour produire les objets schema Drizzle en memoire (tables, colonnes, indexes, types)
    2. Introspect la DB reelle via `information_schema.columns`, `information_schema.tables`, `pg_indexes` (queries SQL directes, PAS drizzle-kit)
    3. Compare les deux representations et produit un rapport de differences
  - **Pourquoi pas drizzle-kit** : `drizzle-kit generate` compare le schema Drizzle avec les fichiers de migration existants (pas avec la DB). `drizzle-kit introspect` genere un fichier schema Drizzle depuis la DB (pas un rapport de diff). Aucun des deux ne fait ce que `db:diff` fait. Le framework porte sa propre logique de comparaison, qui est simple : comparer deux listes de tables/colonnes/indexes.
  - **Workflow complet des commandes DB** (pour eviter toute confusion) :
    - `manta db:generate` : DML → schema Drizzle → `drizzle-kit generate` → fichier SQL de migration
    - `manta db:migrate` : `drizzle-kit migrate` → applique les fichiers SQL de migration sur la DB
    - `manta db:diff` : DML → schema Drizzle (memoire) + introspection DB → rapport de comparaison (read-only)
    - `manta db:rollback` : execute les fichiers de rollback SQL dans l'ordre inverse (best-effort)
  - **Colonnes implicites** (`created_at`, `updated_at`, `deleted_at`, shadow `raw_*` pour bigNumber) : ces colonnes font partie du schema attendu (le generateur les ajoute). Elles DOIVENT etre presentes dans la DB — leur absence est reportee comme diff.
  - **Indexes extra** (crees manuellement dans la DB mais pas dans le DML) : reportes avec action `NOTIFY` — le dev est informe mais aucune action automatique. Le framework ne supprime JAMAIS un index qu'il n'a pas cree. L'action est `NOOP` dans le plan de migration (l'index est ignore).
  - **Colonnes extra** (dans la DB mais pas dans le DML) : reportees avec action `NOTIFY`. Le framework ne supprime JAMAIS une colonne qu'il n'a pas creee. Le dev doit nettoyer manuellement ou ignorer.
  - **Table entierement absente** (dans le DML mais pas en DB) : action **`CREATE`** (safe). C'est le cas nominal d'une migration en attente (nouveau module, premiere migration). Le rapport liste la table avec toutes ses colonnes attendues.
  - **Table extra** (en DB mais pas dans le DML) : action **`NOTIFY`**. Le framework ne drop JAMAIS une table qu'il n'a pas creee. Le dev nettoie manuellement ou ignore.
  - **Unsafe changes** : `ALTER COLUMN` (changement de type), `DROP COLUMN`, `DROP TABLE` → action `NOTIFY` avec warning explicite. Jamais executees automatiquement — le dev doit approuver via `--force` ou ecrire la migration manuellement.
  - **Output** : le rapport de diff est affiche en console (format table) et optionnellement ecrit en JSON (`--json`). Chaque ligne : `table | column | expected | actual | action (CREATE/ALTER/DROP/NOOP/NOTIFY)`.
  - **Limitation : triggers et fonctions** : `information_schema` ne retourne pas les triggers PostgreSQL ni les fonctions PL/pgSQL. Or, la colonne implicite `updated_at` est maintenue par un trigger `ON UPDATE` genere par les migrations. `db:diff` peut verifier que la colonne `updated_at` existe mais ne peut PAS verifier que le trigger est en place. Si le trigger manque (migration partielle, restauration depuis un dump sans triggers), `updated_at` ne sera jamais mis a jour — silencieusement. Pour combler cette lacune, `db:diff` ajoute une verification supplementaire via `pg_trigger` : il query `SELECT tgname FROM pg_trigger WHERE tgrelid = '{table}'::regclass` pour chaque table et verifie que les triggers attendus (un par table avec `updated_at`) sont presents. Un trigger manquant est reporte avec action `NOTIFY` et warning : `Trigger "set_updated_at" missing on table "{table}". Column updated_at will not be auto-updated.`
  - **Limitation explicite : fonctions PL/pgSQL** : `db:diff` verifie la PRESENCE des triggers (via `pg_trigger`) mais ne peut PAS verifier le CONTENU des fonctions PL/pgSQL associees (ex: `set_updated_at()`). Si la fonction existe mais a une signature incorrecte ou un body corrompu (ex: restauration depuis un dump incomplet), le trigger est en place mais non-fonctionnel. `db:diff` ne detecte PAS ce cas — il ne fait pas d'introspection du body des fonctions (`pg_proc.prosrc`). Raison : parser et comparer des bodies PL/pgSQL est hors scope pour un outil de diagnostic schema. Pour les cas de corruption fonctionnelle, le dev doit utiliser `manta db:migrate --force` pour re-appliquer les migrations ou verifier manuellement via `\df+` dans psql.
  - Garanties : `db:diff` est une commande read-only — elle ne modifie JAMAIS la DB. C'est un outil de diagnostic.

**SPEC-088 : CLI plugin -- add, build, develop, publish**
- Contrat : gestion du lifecycle des plugins.

**SPEC-089 : CLI migrate-from-medusa -- migration automatisee depuis Medusa**
- Contrat : outil CLI qui automatise la migration d'un projet Medusa V2 vers Manta.
- Etapes :
  1. Detecte la config Medusa existante (`medusa-config.ts`) et genere `manta-config.ts` equivalent.
  2. Copie les fichiers custom dans la structure plugin Manta (`src/api/` → routes, `src/workflows/`, `src/subscribers/`, `src/jobs/`, `src/modules/`, `src/links/`).
  3. Verifie la compatibilite DB via `manta db:diff` (read-only).
  4. Genere un rapport de migration avec les actions manuelles restantes (routes Express → Nitro, imports Medusa → Manta, etc.).
- Garanties : read-only sur la DB. Ne modifie pas le projet Medusa source. Output dans un dossier separe. Rapport JSON + console.
- Voir `MIGRATION_STRATEGY.md` pour le detail complet.

**SPEC-100 : CLI build -- compilation backend + bundling frontend**
- Contrat : compile TypeScript backend, bundle frontend admin, genere les types.

**SPEC-101 : CLI user -- creation admin**
- Contrat : creation utilisateur admin avec auth, invitation, assignation RBAC.

---

### 22. Utilitaires framework

**SPEC-107 : refetchEntities / refetchEntity — re-fetching apres mutation**
- Contrat : `refetchEntities<TEntry>(entity, idOrFilter, scope, fields, pagination, withDeleted, options)` pour re-requerir des entites apres mutation via `Query.graph()`. `refetchEntity` retourne le premier element.
- Garanties : typage generique via RemoteQueryEntryPoints. Extraction automatique du 'context' depuis les filtres. Support pagination et withDeleted. Retourne `{data, metadata}` type GraphResultSet.

**SPEC-108 : HTTP compression configurable**
- Contrat : compression HTTP (gzip/deflate) configurable via `projectConfig.http.compression`.
- Garanties : defaults: enabled=false, level=6, memLevel=8, threshold=1024 bytes. Opt-out par requete via header `x-no-compression`.
- Note serverless : generalement gere par l'API Gateway/CDN, pas par le framework.

**SPEC-109 : Soft-delete recursif en cascade avec detection circulaire**
- Contrat : utilitaire pour soft-delete recursif traversant les relations (filtre par cascade 'soft-remove').
- Garanties : detection de dependances circulaires. Batch processing par type d'entite. Retourne `Map<string, entities[]>` des entites affectees. Utilise par le repository de base pour les operations softDelete/restore.

**SPEC-113 : definePolicies — declaration RBAC declarative**
- Contrat : `definePolicies(policies[])` pour enregistrer des politiques RBAC dans des registres globaux.
- Garanties : normalisation snake_case. Operations par defaut: read, create, update, delete, * (ALL). Wildcards supportes. Detection via MedusaPolicySymbol.

**SPEC-114 : defineFileConfig — configuration de fichiers auto-charges**
- Contrat : `defineFileConfig(config?)` enregistre la config dans une Map globale indexee par chemin de fichier (detection auto via `getCallerFilePath()`).
- Garanties : `isFileDisabled(path)` pour desactivation conditionnelle. `isFileSkipped(exported)` via symbole MEDUSA_SKIP_FILE.

**SPEC-115 : wrapHandler — error handling pour routes et middlewares**
- Contrat : wrapper generique pour les handlers de route avec try/catch et propagation des erreurs.
- Garanties : verification des erreurs pre-existantes sur req.errors (retourne 400). Preserve le nom de la fonction originale.

**SPEC-116 : QueryContext — marquage de contexte pour Remote Query**
- Contrat : `QueryContext(query)` ajoute un `__type: 'QueryContext'` pour distinguer le contexte des filtres standards dans le systeme Remote Query.
- Garanties : `QueryContext.isQueryContext(obj)` pour verification. Stateless.

---

### 23. Field Parsing & Query Filtering

**SPEC-119 : FieldParser et IFieldFilter — strategie de parsing et filtrage des champs**
- Contrat : systeme de parsing des champs de requete avec syntaxe `+field` (ajouter), `-field` (exclure), `field.*` (wildcard). `FieldParser` parse les champs demandes en `ParsedFields` (requested, defaults, starred).
- Methodes : `FieldParser.parse()`, `IFieldFilter.filter(parsedFields) -> filteredFields`
- Garanties : Strategy pattern avec deux implementations : `AllowedFieldFilter` (whitelist) et `RestrictedFieldFilter` (blacklist). Utilise par TOUS les endpoints de query pour traiter les champs de reponse.

**SPEC-120 : RBAC Field-Level Filtering via GraphQL schema introspection**
- Contrat : `RBACFieldFilter` implemente `IFieldFilter` pour filtrer les champs de reponse selon les permissions RBAC.
- Methodes : utilise les schemas GraphQL des joiner configs pour resoudre les types d'entites depuis les field paths, puis verifie les permissions `read` par entite.
- Garanties : feature-flagge sous `rbac_filter_fields`. Complementaire au RBAC route-level (SPEC-051).

---

### 24. Workflow Proxy Pattern

**SPEC-124 : Proxy Pattern pour acces lazy aux resultats de steps**
- Contrat : cree des objets JavaScript Proxy qui permettent d'acceder aux proprietes imbriquees des resultats de steps AVANT leur resolution. Ex: `step.result.product.id` cree une reference trackee resolue au runtime.
- Methodes : le Proxy intercepte les acces proprietes (get trap), enregistre le chemin d'acces, et le resout lors de l'execution du workflow.
- Garanties : essentiel au DSL declaratif des workflows. Permet de chainer des steps qui dependent les uns des autres sans code imperatif. Resout PO-005.

---

### 25. Repository Base Contract

**SPEC-126 : IRepository — contrat de base pour l'acces aux donnees**
- Contrat : interface de repository generique que chaque adapter ORM doit implementer. Fondation de tout l'acces aux donnees des modules.
- Methodes : `find(options)`, `findAndCount(options)`, `create(data)`, `update(data)`, `delete(ids)`, `softDelete(ids)`, `restore(ids)`, `serialize(data, options)`, `upsertWithReplace(data, replaceFields)`, `transaction(fn, options?)`
- **Contrat de transaction detaille** :
  - Signature : `transaction<TManager>(task: (transactionManager: TManager) => Promise<any>, options?: TransactionOptions) -> Promise<any>`
  - `TransactionOptions` :
    - `isolationLevel?: 'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE'` — defaut : **READ COMMITTED** (defaut PostgreSQL). L'adapter DOIT respecter ce defaut si non specifie.
    - `transaction?: TManager` — transaction parente existante pour reutilisation ou nesting.
    - `enableNestedTransactions?: boolean` — defaut : **false**.
  - **Comportement quand `enableNestedTransactions = false` (defaut)** :
    - Si une transaction parente existe (`options.transaction`), la task est executee dans la transaction parente sans creer de nouvelle transaction. C'est une reutilisation — la task partage le commit/rollback du parent.
    - Si aucune transaction parente : cree une nouvelle transaction.
  - **Comportement quand `enableNestedTransactions = true`** :
    - Si une transaction parente existe : cree un **SAVEPOINT** (sous-transaction PostgreSQL). Un echec du savepoint rollback uniquement le savepoint, pas la transaction parente.
    - Si aucune transaction parente : cree une nouvelle transaction (meme comportement que false).
  - **Propagation du Context** : le `transactionManager` est propage via le `Context` (SPEC-060). Le decorateur `@InjectTransactionManager()` verifie si `context.transactionManager` existe deja — si oui, il reutilise (pas de double-wrapping). Un nouveau Context est cree avec getters/setters qui referencent l'original pour que les mutations propagent.
  - **Partage de transaction entre services distincts (mecanisme Drizzle)** :
    - Quand le service A ouvre une transaction, `@InjectTransactionManager()` stocke l'instance `DrizzleTransaction` (retour de `db.transaction(fn)`) dans `context.transactionManager`.
    - Quand le service A appelle le service B en passant le meme `Context`, le decorateur `@InjectTransactionManager()` du service B detecte que `context.transactionManager` est deja set. Il ne cree PAS de nouvelle transaction — il execute la methode directement avec le `DrizzleTransaction` existant.
    - **Concretement avec Drizzle** : `DrizzleTransaction` est un objet `PgTransaction` retourne par `db.transaction()`. Il a la meme API que `db` (select, insert, update, delete) mais execute dans la transaction. Le repository utilise `context.transactionManager ?? context.manager` pour choisir la connexion. `manager` = instance Drizzle globale (hors transaction). `transactionManager` = instance transactionnelle (dans une transaction).
    - **Savepoints avec Drizzle** : Drizzle supporte `tx.transaction()` (nested) qui cree un SAVEPOINT PostgreSQL. Fonctionne avec le driver `postgres` et `@neondatabase/serverless`. L'adapter DOIT verifier que le driver utilise supporte les savepoints — sinon `enableNestedTransactions: true` leve une erreur au `register()`.
    - **Rollback** : si une erreur est throw dans la task, Drizzle rollback automatiquement (la transaction wrapper fait le try/catch). Le decorateur `@InjectTransactionManager()` ne fait PAS de try/catch — c'est la responsabilite de l'appelant (workflow step, handler) de gerer l'erreur.
- **Soft-delete auto-filtering** : toutes les methodes de lecture (`find`, `findAndCount`) filtrent automatiquement `WHERE deleted_at IS NULL` par defaut. Pour inclure les entites soft-deletees, passer `options.withDeleted: true`. Ce comportement est une garantie du port — chaque adapter DOIT l'implementer.
- **`upsertWithReplace` — semantique detaillee** :
  - Signature : `upsertWithReplace(data: T[], replaceFields?: (keyof T)[], conflictTarget?: (keyof T)[])`
  - **SQL** : traduit en `INSERT ... ON CONFLICT (conflict_target) DO UPDATE SET ...`. Par defaut, `conflictTarget` = primary key. Le dev peut specifier une contrainte UNIQUE alternative (ex: `conflictTarget: ['user_id', 'key']` pour une table settings avec UNIQUE(user_id, key)). Si `conflictTarget` est specifie, la clause `ON CONFLICT` cible ces colonnes au lieu de la PK.
  - **Comportement** :
    - Si l'entite n'existe PAS (pas de conflit PK) : `INSERT` classique avec toutes les colonnes.
    - Si l'entite existe DEJA (conflit PK) : `UPDATE` uniquement les colonnes listees dans `replaceFields`.
    - Si `replaceFields` n'est pas specifie : `UPDATE` TOUTES les colonnes du payload (full replace du payload, pas de merge).
  - **Relations imbriquees** : `upsertWithReplace` ne gere PAS les relations. Si le payload contient des relations imbriquees, elles sont ignorees. Le dev doit gerer les relations separement. Raison : le merge de relations imbriquees est ambigu (supprimer les absentes ? les garder ? les merger ?) — le framework refuse l'ambiguite.
  - **Usage principal** : Settings (SPEC-104-S) ou chaque `setUserPreference` fait un upsert sur `(user_id, key)`. Evite le pattern read-then-write (race condition en concurrent).
  - **Difference avec `update()`** : `update()` leve `MantaError(NOT_FOUND)` si l'entite n'existe pas. `upsertWithReplace()` cree l'entite si elle n'existe pas.
  - **Pattern recommande pour upsert avec relations** : `upsertWithReplace` ignore les relations par design (ambiguite du merge). Pour les cas ou un upsert doit aussi mettre a jour des relations (ex: Settings avec sous-objets), le pattern recommande est :
    ```typescript
    await db.transaction(async (tx) => {
      const parent = await repo.upsertWithReplace([{ id, name }], ["name"])
      await childRepo.delete({ parent_id: id })  // clear existing
      await childRepo.create(children.map(c => ({ ...c, parent_id: id })))  // re-insert
    })
    ```
    Le tout dans une transaction garantit l'atomicite. Le pattern delete+re-insert est explicite et sans ambiguite.
    **Attention FK constraints** : si d'autres tables referent les child rows via FK (ex: `order_items.product_variant_id → product_variants.id`), le `delete()` du step 2 echouera avec `MantaError(NOT_FOUND)` (PG 23503 — FK violation). Dans ce cas, le dev DOIT soit : (a) utiliser `softDelete()` au lieu de `delete()` pour les children, (b) supprimer d'abord les references dans les tables dependantes, ou (c) configurer `ON DELETE CASCADE` au niveau de la FK (via migration SQL). Le pattern delete+re-insert est safe uniquement quand les child rows ne sont pas references par d'autres tables.
  - **Conflit sur contrainte UNIQUE (autre que PK)** : si `conflictTarget` n'est PAS specifie et qu'un conflit survient sur une contrainte UNIQUE non-PK → leve `MantaError(DUPLICATE_ERROR)` (le ON CONFLICT PK ne match pas, PG retourne 23505). Si le dev veut un upsert sur une contrainte UNIQUE alternative, il DOIT passer `conflictTarget` explicitement. Exemple : `upsertWithReplace([{ user_id, key, value }], ['value'], ['user_id', 'key'])` → `INSERT ... ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value`. Ce pattern corrige le cas Settings (SPEC-104-S) qui necessitait un upsert sur `(user_id, key)` et non sur la PK.
- Garanties : soft-delete recursif en cascade (via SPEC-109). Serialisation avec gestion des relations.

---

### 26. Dev Server & Dev Tooling

**SPEC-125 : Dev Server Architecture — HMR, resource registry, error recovery**
- Contrat : sous-systeme complet pour le developpement interactif. Le Dev Server orchestre le hot-reload par type de ressource.
- Composants :
  - `ResourceLoader` (abstract) : classe de base pour la decouverte filesystem (jobs, subscribers, workflows). Gere scan de dossiers, filtrage de fichiers, imports dynamiques.
  - `ResourceRegistry` : registre des ressources chargees (routes, subscribers, jobs, workflows, modules).
  - `ModuleCacheManager` : invalidation des caches de modules pour le hot-reload.
  - `RecoveryService` : recuperation d'erreurs en dev (retry, fallback).
  - `Reloaders` : sous-classes specialisees par type (BaseReloader -> JobReloader, ModuleReloader, RouteReloader, SubscriberReloader, WorkflowReloader).
  - `Handlers` : handlers pour le dev panel (job-handler, step-handler, subscriber-handler, workflow-handler) permettant d'inspecter et declencher des ressources.
  - `registerDevServerResource()` : enregistre une ressource pour le dev tooling.
- Garanties : support HMR backend via IPC (30s timeout). Fallback vers restart complet si HMR echoue. Non pertinent pour production.

---

### 27. HTTP Middleware Utilities

**SPEC-118 : Middleware utilitaires framework**
- Contrat : ensemble de middlewares framework reutilisables :
  - `applyDefaultFilters(filters)` : applique des filtres par defaut aux filterableFields de la requete.
  - `applyParamsAsFilters(paramNames)` : mappe les parametres URL vers filterableFields.
  - `clearFiltersByKey(keys)` : supprime des cles specifiques des filterableFields.
  - `setContext(contextBuilder)` : injecte du contexte arbitraire sur `req.context`, supporte les fonctions async.
  - `setSecretApiKeyContext` : enrichit la requete avec `secret_key_context` (created_by) quand authentifie par API key.
  - `maybeApplyLinkFilter` : resout les filtres cross-module via `Query.graph()` avant la query principale.
  - `MedusaStoreRequest` : type etendant MedusaRequest avec `publishable_key_context` requis.
  - `SecretKeyContext` : type portant `created_by` pour l'auth par API key.

---

### 28. Event & Config Auto-Generation Patterns

**SPEC-127 : eventBuilderFactory — auto-generation des noms d'events domaine**
- Contrat : `eventBuilderFactory(modelName)` genere automatiquement les noms d'events (created/updated/deleted/attached/detached) a partir du nom de modele.
- Methodes : `buildEventNamesFromModelName(modelName)` -> `{ created: 'model.created', updated: 'model.updated', ... }`
- **Regle de nommage explicite** : le `modelName` est toujours le `name` passe a `model.define(name, ...)`, **lowercased et singulier**. Exemples :
  - `model.define("Product", { ... })` → events `product.created`, `product.updated`, etc.
  - `model.define("ProductCategory", { ... })` → events `product_category.created` (camelCase → snake_case puis lowercase).
  - Le `tableName` du schema Drizzle (qui peut etre different, ex: `my_products`) n'est **jamais** utilise pour les noms d'events.
  - Le `serviceName` du module n'est **pas** utilise non plus.
  - Si `createService()` est utilise avec un modele DML, le nom est deduit automatiquement via `model.__name__`. Si `createService()` est utilise sans DML (override complet), le dev DOIT fournir le nom explicitement via `createService({ modelName: "Product" })`.
- Garanties : convention de nommage standardisee. Utilise par les decorateurs @EmitEvents.

**SPEC-128 : defineJoinerConfig — auto-build joiner config depuis DML**
- Contrat : `defineJoinerConfig(models)` genere automatiquement la joiner config (serviceName, primaryKeys, relationships, schema, linkableKeys) a partir des modeles DML.
- Methodes : `buildLinkConfigFromModelObjects()`, `buildLinkConfigFromLinkableKeys()`, `buildIdPrefixToEntityNameFromDmlObjects()`
- Garanties : elimine la configuration manuelle des joiner configs. Le Module() wrapper appelle ceci automatiquement.

**SPEC-129 : createMedusaContainer — factory du container DI**
- Contrat : `createMedusaContainer()` cree le container Awilix avec les methodes custom `registerAdd` (enregistrements tableau), `aliasTo` (aliases), et le pattern `dispose`.
- Garanties : le container factory est le point d'entree unique pour la creation du container. `initializeContainer()` l'utilise pour le bootstrap standalone (scripts, tests).

**SPEC-130 : WorkflowManager.update() et WorkflowScheduler**
- Contrat : `WorkflowManager.update(workflowId, flow, handlers, options)` met a jour une definition de workflow existante sans re-registration. `WorkflowScheduler` gere le scheduling de workflows via `IDistributedSchedulerStorage` (cron, concurrency control, global singleton).
- Garanties : update preserves l'ID. Le scheduler est initialise une seule fois via pattern global singleton.

**SPEC-131 : Erreurs supplementaires du workflow engine**
- Contrat : 3 types d'erreur supplementaires pour le controle d'execution :
  - `SkipExecutionError` : skip l'execution entiere d'un workflow
  - `SkipStepAlreadyFinishedError` : skip un step deja termine
  - `SkipCancelledExecutionError` : skip une execution annulee

**SPEC-132 : Migrator base class**
- Contrat : classe de base pour l'execution des migrations. `ensureDatabase()`, `ensureMigrationsTable()`, `loadMigrationFiles()`, `getExecutedMigrations()`, `insertMigration()`.
- Garanties : tracking des migrations executees. Support mode allOrNothing et concurrence configurable.

**SPEC-133 : MantaError — hierarchie d'erreurs abstraites du framework**
- Contrat : tous les adapters DOIVENT lever des erreurs du framework, JAMAIS des erreurs specifiques a leur implementation. L'erreur est la frontiere entre adapter et code metier.
- **Classe de base** : `MantaError extends Error`
  - Proprietes : `type: MantaErrorType`, `code?: string`, `date: Date`, `__isMantaError: true`
  - Methode statique : `MantaError.is(err) -> boolean` (type guard)
- **Types d'erreur (MantaErrorType)** :

| Type | Description | HTTP Status | Quand |
|------|-------------|-------------|-------|
| `NOT_FOUND` | Ressource introuvable | 404 | `retrieve()` sans resultat, FK violation (23503) |
| `INVALID_DATA` | Donnees invalides | 400 | Validation Zod, NOT NULL violation (23502), unique constraint (23505) |
| `UNAUTHORIZED` | Auth manquante/invalide | 401 | JWT expire, API key invalide |
| `FORBIDDEN` | Permissions insuffisantes | 403 | RBAC denied |
| `DUPLICATE_ERROR` | Doublon | 422 | Unique constraint (23505) — alternative a INVALID_DATA |
| `CONFLICT` | Conflit concurrent | 409 | Serialization failure (40001), optimistic lock |
| `NOT_ALLOWED` | Operation interdite | 400 | Business rule violation |
| `UNEXPECTED_STATE` | Etat inattendu | 500 | State machine invalide |
| `DB_ERROR` | Erreur base de donnees | 500 | Erreur DB non-mappable |
| `UNKNOWN_MODULES` | Module inconnu | 500 | Module non charge |
| `INVALID_STATE` | Etat invalide du framework | 500 | Scope lifecycle violation, config invalide |

- **Mapper d'erreurs DB (responsabilite de l'adapter)** : chaque adapter ORM DOIT fournir un `dbErrorMapper(err) -> MantaError` qui convertit les erreurs specifiques de l'ORM :
  - PostgreSQL 23505 (UNIQUE) → `MantaError(DUPLICATE_ERROR, "{Table} with {key}: {value} already exists")`
  - PostgreSQL 23503 (FK) → `MantaError(NOT_FOUND, "Entity with {key}: {value} does not exist")`
  - PostgreSQL 23502 (NOT NULL) → `MantaError(INVALID_DATA, "Cannot set {column} to null")`
  - PostgreSQL 40001 (SERIALIZATION) → `MantaError(CONFLICT, detail)`
  - Toute autre erreur DB → `MantaError(DB_ERROR, message)`
- **Codes d'erreur optionnels** (`MantaErrorCode`) : `INSUFFICIENT_INVENTORY`, `CART_INCOMPATIBLE_STATE`, etc. — codes metier pour les adapters commerce.
- Garanties : les tests d'integration n'ont JAMAIS besoin de catcher des erreurs specifiques a un ORM. Ils catchent `MantaError` avec un `type`. Le switch d'adapter ne change pas le comportement d'erreur.

**SPEC-134 : ITranslationPort — interface formelle du module Translation**
- Contrat : port optionnel pour le module Translation (SPEC-105-T*). Formalise l'interface que le module expose.
- Methodes :
  - `applyTranslations<T>(results: T[], locale: string, entityType: string) -> T[]` : applique les traductions sur les resultats de query. No-op si le module est desactive.
  - `createTranslations(data: { reference_id: string, reference: string, locale_code: string, translations: Record<string, string> }[]) -> Translation[]` : cree des traductions en bulk.
  - `updateTranslations(data: { reference_id: string, locale_code: string, translations: Record<string, string> }[]) -> Translation[]` : met a jour des traductions existantes.
  - `deleteTranslations(filters: { reference_id?: string[], locale_code?: string[] }) -> void` : supprime des traductions.
  - `getStatistics(input: { entity_type: string, locale_code?: string }) -> TranslationStats` : metriques de completion.
  - `listLocales() -> Locale[]` : liste les locales disponibles.
- Garanties : le port est `Recommande` (pas `Oui`). Si le module n'est pas charge, `applyTranslations()` retourne les resultats inchanges. Les tests peuvent mocker `ITranslationPort` sans charger le module complet.

---

## PARTIE 2 -- CONTRATS & GARANTIES

Pour chaque port, les garanties minimales qu'un adapter DOIT respecter :

| Port | Garantie | Obligatoire ? |
|------|----------|---------------|
| IContainer | Resolution typesafe, scope isolation, dispose cleanup | Oui |
| IContainer | ServiceLifetime (SINGLETON/SCOPED/TRANSIENT) avec detection inversion lifecycle | Oui |
| IContainer | SCOPED non-resolvable hors scope actif (via AsyncLocalStorage) | Oui |
| IModuleService | Lifecycle hooks (onApplicationStart au minimum) | Oui |
| IWorkflowEnginePort | Durabilite des checkpoints entre invocations | Oui |
| IWorkflowEnginePort | Gestion auto des grouped events (release on success, clear on failure) | Oui |
| IWorkflowEnginePort | Mockable via InMemoryWorkflowEngine pour tests | Oui |
| IWorkflowStoragePort | Persistence durable, merge par stepId (last-write-wins), serialisabilite JSON | Oui |
| IEventBusPort | At-least-once delivery en production | Oui |
| IEventBusPort | Grouped events hold/release avec TTL (defaut 600s) | Oui |
| IEventBusPort | Deduplication par subscriberId | Oui |
| IEventBusPort | Interceptors read-only, fire-and-forget, non-bloquants | Oui |
| IHttpPort | Web Standard Request/Response, routing filesystem-based | Oui |
| IHttpPort | CORS par namespace, error handler, request ID | Oui |
| IHttpPort | Pipeline middleware ordonne (12 etapes, SPEC-039) | Oui |
| IAuthPort | JWT bearer verification | Oui |
| IAuthPort | Methodes transport-agnostiques (verifyJwt, verifyApiKey, verifySession) | Oui |
| IAuthPort | Zero dependance a Request/Headers dans l'interface | Oui |
| IAuthProvider | authenticate(), register(), validateCallback() | Oui |
| IConfigManager | Charge config, env vars prioritaires, validation | Oui |
| IDatabasePort | Connection pooling configurable (min=0 pour serverless) | Oui |
| IDatabasePort | Retry avec backoff sur connexion | Oui |
| IDataModel (DML) | Toutes les proprietes et relations du DSL | Oui |
| IJobSchedulerPort | Cron expressions, interval, concurrency control | Oui |
| IJobSchedulerPort | JobResult (status, error, duration_ms) | Oui |
| IJobSchedulerPort | Retry configurable (maxRetries, backoff) | Oui |
| IJobSchedulerPort | Historique des executions via getJobHistory() | Oui |
| IFileProvider | upload, delete, getPresignedDownloadUrl | Oui |
| IFileProvider | getPresignedUploadUrl | Recommande |
| IFileProvider | Streaming bidirectionnel | Recommande |
| ICachePort | TTL respecte, wildcards pour invalidation | Oui |
| ICachePort | get/set/invalidate/clear | Oui |
| ICachingPort | Tags, multi-providers, auto-invalidation | Recommande |
| ILockingPort | Mutual exclusion sur les cles | Oui |
| ILockingPort | TTL de lock (expire) pour eviter deadlocks | Oui |
| ILockingPort | execute atomique (lock-run-release) | Oui |
| ILoggerPort | 8 niveaux, activity tracking, shouldLog | Oui |
| ILoggerPort | Custom logger injectable | Oui |
| INotificationPort | Idempotence via idempotency_key | Oui |
| INotificationPort | Status tracking PENDING/SUCCESS/FAILURE | Oui |
| INotificationProvider | Channel-based routing | Oui |
| IAnalyticsProvider | track(), identify() | Oui |
| ISearchProvider | Interface de search pluggable | Recommande |
| ISettingsPort | CRUD de configuration persistante | Recommande |
| ITranslationPort | Persistance et application des traductions | Recommande |
| ITranslationPort | applyTranslations() no-op si module desactive | Recommande |
| ITracerPort | trace(), getActiveContext(), propagation | Recommande |
| IRepository | transaction() avec isolationLevel configurable (defaut READ COMMITTED) | Oui |
| IRepository | Nested transactions desactivees par defaut, savepoints si activees | Oui |
| IRepository | Soft-delete auto-filtering (WHERE deleted_at IS NULL par defaut) | Oui |
| IRepository | dbErrorMapper : erreurs ORM → MantaError | Oui |
| MantaError | Hierarchie d'erreurs abstraites, jamais d'erreurs ORM-specifiques | Oui |
| MantaError | Mapper PostgreSQL codes → MantaErrorType | Oui |
| IEventBusPort | Warning si subscriber non-idempotent en mode at-least-once | Recommande |
| IJobSchedulerPort | Concurrency control via ILockingPort (dependance explicite) | Oui |
| IConfigManager | Config chargee une seule fois au cold start (pas de rotation a chaud) | Oui |
| IContainer | Detection scope via AsyncLocalStorage | Oui |
| IContainer | Self-test ALS au boot (detection incompatibilite adapter/ALS) | Oui |
| IHttpPort | Rate limiting opt-in via ICachePort (sliding window, configurable par namespace/route) | Recommande |
| IHttpPort | Cookie session signe (httpOnly, secure, sameSite configurable, COOKIE_SECRET obligatoire) | Oui (si sessions activees) |
| IRepository | Cursor-based pagination (keyset) en plus de limit/offset | Recommande |
| IFileProvider | Multipart upload (initiate/upload part/complete/abort) | Recommande |
| IEventBusPort | Hooks observabilite grouped events (onGroupCreated/Released/Cleared) | Recommande |
| IEventBusPort | getGroupStatus() pour inspection debug | Recommande |
| IWorkflowEnginePort | Compensation failure : continue best-effort, etat FAILED, pas de retry auto du workflow | Oui |
| IWorkflowEnginePort | deriveWorkflowTransactionId() pour subscribers lançant des workflows | Recommande |
| Plugins | Resolution paths relative a la racine du package (require.resolve) | Oui |
| DML Generator | Deterministe (meme input → meme output), testable sans DB | Oui |
| DML Generator | Shadow column bigNumber (`raw_*`) avec detection de conflit | Oui |
| DML Generator | Colonnes implicites (created_at, updated_at, deleted_at) non-redefinissables | Oui |
| DML Generator | Enum detection runtime (array literal ou TypeScript enum Object.values) | Oui |
| DML Generator | Indexes partiels avec serialisation QueryCondition → SQL | Oui |
| DML Generator | Indexes simples/composites incluent `WHERE deleted_at IS NULL` par defaut (sauf where explicite) | Oui |
| IRepository | upsertWithReplace = INSERT ON CONFLICT DO UPDATE, pas de merge relations | Oui |
| IHttpPort | SIGTERM handler global avec timeout 500ms, non-optionnel | Oui |
| Plugins | Route conflict: last-wins en mode normal, erreur en strict mode | Oui |
| Query.graph() | Pagination racine (limit:100 defaut), seuil dur 10000 entites totales (configurable) | Oui |
| Query.graph() | dangerouslyUnboundedRelations opt-out explicite, interdit en strict mode | Oui |
| IEventBusPort | AuthContext propage via metadata.auth_context dans chaque event | Oui |
| IEventBusPort | Message<T> type formalise avec eventName, data, metadata | Oui |
| IEventBusPort | permanentSubscriberFailure() pour erreur non-retriable (DLQ directe). DLQ grouped events = standalone re-processing | Oui |
| IContainer | Propriete id: string (UUID v4) sur chaque scope pour correlation et tests | Oui |
| IContainer | AUTH_CONTEXT enregistre en SCOPED dans le scope de requete | Oui |
| IRepository | Partage de transaction Drizzle entre services via Context.transactionManager | Oui |
| SPEC-012 | Liens dans src/links/, decouverts par manifeste pre-build ou ResourceLoader | Oui |
| CLI db:diff | Read-only, ne modifie jamais la DB, NOTIFY pour extras/unsafe | Oui |
| IAuthProvider | OAuth state via ICachePort : setState get-then-delete, PKCE obligatoire, CSRF via state param | Oui |
| IWorkflowEnginePort | Checkpoint recovery : steps DONE non re-executes, resultat lu depuis storage | Oui |
| IWorkflowEnginePort | Grouped events non re-emis pour steps DONE au redemarrage (fail-safe) | Oui |
| Query.graph() | RelationPagination type formel pour pagination nested relations | Oui |
| IEventBusPort | Grouped events bufferises in-memory (staging), jamais dans la queue avant release | Oui |
| DML Generator | Enum numerique : filtre `typeof v === 'string'`, warning si valeurs numeriques detectees | Oui |
| IContainer | dispose() force close sans drain, idempotent, scopes actifs non attendus | Oui |
| Plugins | PluginConfig type formel avec definePlugin() export | Oui |
| IJobSchedulerPort | 3 dependances explicites : ILockingPort + ILoggerPort + IWorkflowStoragePort | Oui |
| IHttpPort | /health/live (200 ping) + /health/ready (200/503 avec checks DB+Cache+Migrations) | Oui |
| Modules | Version semver declaree, detection mismatch au boot, downgrade interdit | Oui |
| IAuthPort | createSession/destroySession pour session lifecycle complet | Oui (si sessions activees) |
| IEventBusPort | Ordre d'appel des subscribers : PAS un contrat, adapter in-memory concurrentiel | Oui |
| IEventBusPort | DLQ non-configuree : acknowledge + log + event framework (pas de blocage) | Oui |
| IContainer | ALS prerequis non-negociable, self-test au boot, versions Node >= 18.x | Oui |
| IContainer | Scope leak : `assertNoScopeLeak()` test recommande, captures implicites documentees | Recommande |
| IWorkflowStoragePort | Serialisation checkpoints : BigInt converti, Map/Set/Buffer interdits, validation au save | Oui |
| IWorkflowEnginePort | mapExternalError() pour mapper erreurs reseau → MantaError dans les steps | Recommande |
| IJobSchedulerPort | Retry cross-invocation (Vercel Cron) via IWorkflowStoragePort | Oui |
| Plugins | Detection cycles de dependances (DFS topologique) au boot | Oui |
| CLI exec | Pas de transaction auto — dev responsable. Option `--dry-run` disponible. Scope ALS + AuthContext `system/cli`. Events clears en --dry-run | Oui |
| CLI db:diff | Verification triggers `updated_at` via `pg_trigger` | Oui |
| IHttpPort | /health/ready check `migrations` (pending/ok) via module_versions | Oui |
| Modules | autoMigrate en dev, interdit en prod | Oui |
| IRepository | Cursor pagination sur colonnes nullable (WHERE avec IS NULL handling) | Recommande |
| ITranslationPort | T4 (JOIN) : NOT_IMPLEMENTED en v1, erreur explicite si filtre sur champ translatable | Oui |
| Query.graph() | Comptage par batch (total += batch.length), pas par niveau de profondeur | Oui |

---

## PARTIE 3 -- CATALOGUE D'ADAPTERS

### Profil : Local Development

| Port | Adapter | Package |
|------|---------|---------|
| IHttpPort | Nitro (preset node) | `@manta/adapter-nitro` |
| IDatabasePort | Drizzle + PG local | `@manta/adapter-drizzle-pg` |
| ICachePort | In-memory Map | `@manta/adapter-cache-memory` |
| IEventBusPort | In-memory EventEmitter | `@manta/adapter-eventbus-memory` |
| IFilePort | Local filesystem | `@manta/adapter-file-local` |
| ILockingPort | In-memory Map + Promise queue | `@manta/adapter-locking-memory` |
| ILoggerPort | Pino (pretty mode) | `@manta/adapter-logger-pino` |
| IJobSchedulerPort | node-cron | `@manta/adapter-jobs-cron` |
| INotificationProvider | Console log (dev) | `@manta/adapter-notification-local` |
| IWorkflowStoragePort | PG local (meme DB) | `@manta/adapter-workflow-pg` |
| IAnalyticsProvider | Console log (dev) | `@manta/adapter-analytics-local` |

### Profil : Vercel (Production)

| Port | Adapter | Service Vercel |
|------|---------|----------------|
| IHttpPort | Nitro (preset vercel) | Vercel Serverless/Edge |
| IDatabasePort | Drizzle + Neon serverless driver | Neon (Marketplace) |
| ICachePort | Upstash Redis (via Marketplace) | Upstash Redis |
| ICachingPort | Upstash Redis avec tags | Upstash Redis |
| IEventBusPort | Vercel Queues (@vercel/queue) | Vercel Queues |
| IFilePort | Vercel Blob | Vercel Blob Storage |
| ILockingPort | Neon advisory locks | Neon |
| ILoggerPort | Vercel Logs (stdout JSON structured) | Vercel Log Drain |
| IJobSchedulerPort | Vercel Cron | vercel.json crons |
| INotificationProvider | Resend / SendGrid | External |
| IWorkflowStoragePort | Neon | Neon |
| IAnalyticsProvider | PostHog ou custom | External |
| ISearchProvider | Algolia ou Meilisearch | External |

### Profil : Test (unitaires et integration)

| Port | Adapter | Package | Notes |
|------|---------|---------|-------|
| IContainer | Awilix (meme qu'en dev) | `@manta/core` | `withScope()` helper pour tests SCOPED |
| IDatabasePort | Drizzle + PG local (test DB dediee) | `@manta/adapter-drizzle-pg` | Transaction rollback entre tests |
| ICachePort | In-memory Map | `@manta/adapter-cache-memory` | Reset entre tests |
| IEventBusPort | In-memory EventEmitter | `@manta/adapter-eventbus-memory` | Synchrone, at-most-once, inspectable |
| IWorkflowEnginePort | InMemoryWorkflowEngine | `@manta/testing` | Pas de persistence, execution synchrone |
| IWorkflowStoragePort | In-memory Map | `@manta/testing` | Reset entre tests |
| ILockingPort | In-memory (no-op ou real) | `@manta/adapter-locking-memory` | No-op pour unit, real pour integration |
| ILoggerPort | Silent logger ou Pino test | `@manta/testing` | `createTestLogger()` capture les logs |
| IJobSchedulerPort | Manual trigger | `@manta/testing` | `scheduler.runJob(name)` pour trigger manuel |
| IAuthPort | Mock (configurable) | `@manta/testing` | `createTestAuth({ actorType, actorId })` |
| IFilePort | In-memory Map | `@manta/testing` | Pas de filesystem |
| INotificationProvider | In-memory (inspectable) | `@manta/testing` | `notifications.getSent()` pour assertions |
| ITranslationPort | No-op | `@manta/testing` | `applyTranslations()` retourne les resultats inchanges |

**`@manta/testing` exports** : `createTestContainer()`, `withScope(container, fn)`, `createTestLogger()`, `createTestAuth(config)`, `createTestContext(overrides?)`, `assertNoScopeLeak(container, iterations?)`, `mapExternalError(error, context?)`, `InMemoryWorkflowEngine`, `resetAll(container)` (reset tous les adapters in-memory entre tests).

### Profil : AWS (Production)

| Port | Adapter | Service AWS |
|------|---------|-------------|
| IHttpPort | Nitro (preset aws-lambda) | AWS Lambda |
| IDatabasePort | Drizzle + RDS Proxy | Amazon RDS |
| ICachePort | ElastiCache Redis | ElastiCache |
| IEventBusPort | SQS + EventBridge | AWS SQS |
| IFilePort | S3 | Amazon S3 |
| ILockingPort | Redis (ElastiCache) | ElastiCache |
| ILoggerPort | CloudWatch Logs (JSON) | CloudWatch |
| IJobSchedulerPort | CloudWatch Events / EventBridge | EventBridge |
| INotificationProvider | SES / SNS | Amazon SES/SNS |
| IWorkflowStoragePort | DynamoDB ou RDS | DynamoDB |

---

## PARTIE 4 -- DECISIONS D'ARCHITECTURE (toutes resolues)

### PO-001 : RESOLU — Garanties de livraison de l'Event Bus
**Decision** : at-least-once obligatoire en production avec retry automatique et DLQ. At-most-once acceptable en dev.
Medusa fait at-most-once par defaut (meme Redis, attempts=1). Notre framework fait mieux.

### PO-002 : RESOLU — DB Connection Pool
**Decision** : le port IDatabasePort ne gere pas le pool. L'adapter Drizzle+Neon utilise le driver serverless (@neondatabase/serverless) qui n'a pas de pool persistant.

### PO-003 : RESOLU — Auth serverless
**Decision** : JWT par defaut. Sessions optionnelles via adapter Upstash Redis.

### PO-004 : RESOLU — Index module
**Decision** : inclus dans la spec (SPEC-104/105) comme port optionnel, feature-flagge.
C'est un cache de lecture denormalise en PostgreSQL (tables JSONB partitionnees), pas un moteur de recherche. Synchronise en temps reel via events. Alternative performante a query.graph().

### PO-005 : RESOLU
Workflow proxy pattern documente dans SPEC-124.

### PO-006 : RESOLU — Cold start
**Decision** : lazy loading module-par-module + pre-build manifeste via Nitro. Seuls EVENT_BUS et CACHE sont charges au startup. Les autres modules sont charges a la premiere resolution. A valider en implementation.

### PO-007 : RESOLU
Tous les gaps ont ete analyses et integres (SPEC-102 a SPEC-117). Les interfaces sont confirmees par le code source.

---

## Index de tracabilite SPEC -> Section

| SPEC | Section |
|------|---------|
| SPEC-001 a SPEC-003 | 1. Container & DI |
| SPEC-004 a SPEC-018, SPEC-073, SPEC-074 | 2. Module System |
| SPEC-019 a SPEC-033, SPEC-075 | 3. Workflow Engine |
| SPEC-034 a SPEC-036 | 4. Event System |
| SPEC-037 a SPEC-048, SPEC-039b, SPEC-071, SPEC-072, SPEC-076 | 5. HTTP Layer |
| SPEC-049 a SPEC-052 | 6. Auth & Authorization |
| SPEC-053 a SPEC-055 | 7. Configuration |
| SPEC-056 a SPEC-062, SPEC-057f | 8. Database / Data Layer |
| SPEC-063, SPEC-091, SPEC-092 | 9. Scheduled Jobs |
| SPEC-065, SPEC-080, SPEC-081, SPEC-081b | 10. File Storage |
| SPEC-064, SPEC-077 a SPEC-079 | 11. Cache |
| SPEC-066, SPEC-089, SPEC-090 | 12. Locking |
| SPEC-067, SPEC-082, SPEC-083 | 13. Logging |
| SPEC-097 a SPEC-099 | 14. Notification |
| SPEC-068, SPEC-093, SPEC-094 | 15. Plugin / Extension |
| SPEC-102 | 16. Analytics |
| SPEC-103, SPEC-106 | 17. Search / Index |
| SPEC-104 | 18. Settings |
| SPEC-105 | 19. Translation / i18n |
| SPEC-069, SPEC-095, SPEC-096 | 20. Telemetry / Observability |
| SPEC-070, SPEC-084 a SPEC-088, SPEC-100, SPEC-101 | 21. CLI |
| SPEC-107 a SPEC-109, SPEC-113 a SPEC-116 | 22. Utilitaires framework |
| SPEC-104-S, SPEC-117 | 18. Settings |
| SPEC-105-T a SPEC-105-T8 | 19. Translation / i18n |
| SPEC-119, SPEC-120 | 23. Field Parsing & Query Filtering |
| SPEC-124 | 24. Workflow Proxy Pattern |
| SPEC-126 | 25. Repository Base Contract |
| SPEC-125 | 26. Dev Server & Dev Tooling |
| SPEC-118 | 27. HTTP Middleware Utilities |
| SPEC-127 a SPEC-132 | 28. Event & Config Auto-Generation Patterns |
| SPEC-133 | 28. MantaError — Hierarchie d'erreurs |
| SPEC-134 | 19. ITranslationPort — Interface formelle |
| SPEC-045 | ADAPTERS_CATALOG (Express adapter) |
| SPEC-135 | 29. Module Versioning |
| SPEC-136 | 30. Multi-Tenant |
| SPEC-049b | 6. IAuthGateway — Facade d'authentification |
| SPEC-137 | 31. Boot Error Observability |
| SPEC-138 | 32. Event Payload Size Limits |
| SPEC-139 | 33. Blue/Green Migration Compatibility |
| SPEC-140 | 34. Route Conflict Resolution Mechanism |

---

## PARTIE 5 -- EXTENSIONS ARCHITECTURALES

### 29. Module Versioning

**SPEC-135 : Versioning des modules — coexistence et migration**
- Contrat : chaque module declare une version semver dans son `ModuleExports` : `version: "1.0.0"`. La version est stockee dans une table framework `module_versions` (`module_name TEXT PK`, `version TEXT`, `installed_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`).
- **Detection de changement de version au boot** :
  1. Le bootstrap compare la version declaree dans le code avec la version en DB (`module_versions`).
  2. Si la version DB est absente (premier deploy) → insert + executer les migrations du module.
  3. Si la version DB est inferieure a la version code (mise a jour) → le framework log un warning : `Module "product" upgraded from 1.0.0 to 2.0.0. Run "manta db:migrate" to apply schema changes.` Le boot continue mais `/health/ready` retourne **503** avec `"migrations": "pending"` (SPEC-072) jusqu'a ce que `manta db:migrate` soit execute. En production, le load balancer ne route pas le trafic tant que `/health/ready` n'est pas 200.
  4. Si la version DB est superieure a la version code (downgrade) → `MantaError(INVALID_STATE, 'Module "product" version 2.0.0 in DB is newer than code version 1.0.0. Downgrade not supported.')`.
  5. Le boot ne bloque PAS sur un mismatch de version (sauf downgrade). Les migrations sont decouplees du boot (SPEC-074). **Exception unique** : `autoMigrate` en dev (`defineConfig({ boot: { autoMigrate: true } })`) est la seule derogation a ce principe — c'est un mode dev uniquement, interdit en prod (voir ci-dessous).
  6. **Auto-migrate en dev** : configurable via `defineConfig({ boot: { autoMigrate: process.env.APP_ENV === 'dev' } })`. Quand `autoMigrate: true`, le bootstrap detecte les migrations en attente et les execute automatiquement **entre l'etape 8 (core boot complet — DB connection disponible) et l'etape 9 (debut du lazy boot)**. Les migrations bloquent le lazy boot (pas le core boot) avec un timeout de **30s** (configurable via `defineConfig({ boot: { autoMigrateTimeout: 30_000 } })`). Si le timeout est depasse → `MantaError(INVALID_STATE, 'autoMigrate timeout after 30s')` et le boot echoue. Defaut : `false`. En prod, `autoMigrate: true` leve `MantaError(INVALID_STATE, 'autoMigrate is forbidden in production')`. Ce confort de dev evite d'oublier `manta db:migrate` apres un changement de schema. Le warning est quand meme log pour visibilite.
    - **Alternative recommandee** : `manta db:migrate --watch` en dev — un process separe qui surveille les fichiers de migration et les applique automatiquement sans bloquer le boot.
- **Coexistence de versions** : le framework ne supporte PAS deux versions du meme module simultanement. Un module = une version active. La migration entre versions est sequentielle (v1 → v2 → v3). Les breaking changes de schema DML sont geres par les migrations Drizzle (SPEC-014).
- **Migration entre versions majeures** : le dev DOIT fournir des fichiers de migration SQL (generes par `manta db:generate` apres avoir modifie le DML). Il n'y a PAS de migration automatique des donnees — seul le schema est migre. Les transformations de donnees sont de la responsabilite du dev (scripts de migration via `manta exec`).
- **Plugins et versioning** : chaque plugin declare la version de ses modules. Un conflit de version entre deux plugins qui fournissent le meme module leve une erreur au boot : `MantaError(INVALID_STATE, 'Module "product" declared by both "@manta/plugin-a" (v1.0.0) and "@manta/plugin-b" (v2.0.0)')`.
- Garanties : detection au boot, pas de downgrade silencieux, migrations decouplees.
- Compatibilite serverless : ✅ Compatible (lecture de `module_versions` au cold start, < 1 query SQL).

---

### 30. Multi-Tenant

**SPEC-136 : Multi-tenant — hooks et isolation**
- Contrat : le framework fournit des **hooks** pour le multi-tenant, PAS une implementation complete. Le multi-tenant est une responsabilite applicative, pas framework. Le framework fournit les primitives necessaires.
- **Primitives disponibles** :
  1. **Tenant context** : le dev ajoute `tenant_id` dans l'`AuthContext` via `app_metadata` : `{ actor_type: 'user', actor_id: 'u1', app_metadata: { tenant_id: 'tenant_abc' } }`. L'AuthContext est propage partout (SPEC-049).
  2. **Scoped container** : chaque requete a son propre scoped container (SPEC-001). Le `tenant_id` est enregistre dans le scope : `scope.register('TENANT_ID', tenantId, SCOPED)`. Tout service peut `resolve('TENANT_ID')`.
  3. **Database schema isolation** : le dev peut configurer un adapter `IDatabasePort` custom qui switche le schema PostgreSQL (`SET search_path TO tenant_abc`) au debut de chaque scope. Le framework ne fait PAS ca automatiquement — c'est un pattern d'adapter.
  4. **Row-level isolation** (alternative) : le dev ajoute `tenant_id` sur chaque entite DML et ajoute un filtre automatique via un middleware custom dans `defineMiddlewares()` qui injecte `{ tenant_id: ctx.auth.app_metadata.tenant_id }` dans tous les filtres. Plus simple que schema isolation mais moins isole.
  5. **Cache isolation** : le dev prefix les cles cache avec le tenant_id via un wrapper sur `ICachePort` : `set(\`tenant:\${tenantId}:\${key}\`, value)`. Le framework ne force PAS ca.
- **Ce que le framework ne fait PAS** (et pourquoi) :
  - Pas de schema-per-tenant automatique → trop d'opinions sur la strategie d'isolation (schema, row-level, DB separee). Chaque strategie a des trade-offs differents.
  - Pas de routing de connexion par tenant → les connection pools doivent etre geres differemment selon la strategie. Un pool-per-tenant n'est pas viable en serverless.
  - Pas de migration per-tenant automatique → la migration de 1000 schemas en parallele est un probleme operationnel, pas framework.
- **Test helper** : `@manta/testing` fournit `createTestContext({ tenantId?: string, auth?: Partial<AuthContext> })`. Si `tenantId` est passe, le helper enregistre `TENANT_ID` dans le scope et ajoute `app_metadata.tenant_id` dans l'AuthContext. Ceci evite le boilerplate de multi-tenant dans chaque test. Coherent avec `createTestAuth()` (SPEC-060).
- **Guide recommande** : row-level isolation avec `tenant_id` sur les entites est la strategie recommandee pour serverless (un seul pool de connexions, un seul schema, filtrage par row). Schema isolation est recommande uniquement pour les cas B2B avec exigences legales d'isolation stricte.
- Compatibilite serverless : ✅ Row-level, ⚠️ Schema isolation (connection pool management)

---

### 31. Boot Error Observability

**SPEC-137 : Observabilite des erreurs de boot — events et health**
- Contrat : quand le lazy boot echoue, le framework ne se contente PAS de loguer l'erreur — il fournit un mecanisme d'observabilite structure.
- **Event framework** : `manta.boot.failed` emis en fire-and-forget via `IEventBusPort` (si disponible — l'event bus peut etre initialise avant le point d'echec). Payload : `{ phase: 'core' | 'lazy', step: number, stepName: string, error: MantaError, timestamp: number }`. Si l'event bus n'est pas encore initialise (echec en core boot), l'event n'est PAS emis — seul le log reste.
- **Health check enrichi** : `/health/ready` expose la raison de l'echec du boot dans le body 503 :
  ```json
  { "status": "not_ready", "checks": { "boot": "failed", "boot_error": "Lazy boot failed at step 12 (LoadSubscribers): Module 'inventory' not found", "database": "ok", "cache": "ok", "migrations": "ok" } }
  ```
  Le champ `boot_error` n'est present QUE si le boot a echoue. En production, le message d'erreur est sanitise (pas de stack trace, pas de paths systeme). En dev, le message complet est retourne.
- **Retry apres echec** : apres un echec du lazy boot, la prochaine requete re-declenche le lazy boot (avec le cooldown de backoff documente dans SPEC-074). `/health/ready` retourne 503 avec `boot_error` jusqu'au succes ou au cold restart.
- **Event de succes** : `manta.boot.completed` emis au succes du lazy boot. Payload : `{ duration_ms: number, modules_loaded: string[] }`. Utile pour les metriques de cold start.
- Compatibilite serverless : ✅ Compatible.

---

### 32. Event Payload Size Limits

**SPEC-138 : Limites de taille des payloads d'events — validation et truncation**
- Contrat : le framework valide la taille du payload JSON de chaque event AVANT de le passer a l'adapter event bus.
- **Seuil configurable** : `defineConfig({ events: { maxPayloadSize: 64_000 } })` (defaut : **64KB** — aligné sur la limite Vercel Queues). La taille est mesuree sur le **message complet** serialise (`JSON.stringify(message).length` en bytes UTF-8), c'est-a-dire `data` + `metadata` (y compris `metadata.auth_context`). Un `AuthContext` avec un `app_metadata` volumineux compte dans le seuil. Si un AuthContext excessivement large fait depasser la limite, l'erreur est la meme que pour un payload trop gros — le dev doit reduire l'`app_metadata` ou le stocker ailleurs.
- **Comportement au depassement** : `MantaError(INVALID_DATA, 'Event payload size (128000 bytes) exceeds maximum (64000 bytes) for event "export.completed". Use IFilePort to store large data and pass a reference URL in the event payload.')`. L'event n'est PAS emis. L'erreur est levee au moment de l'emission (dans le `IMessageAggregator` ou `IEventBusPort.emit()`), PAS au moment de la publication dans la queue.
- **Recommandation pour les gros payloads** : stocker les donnees volumineuses (exports, images, rapports) dans `IFilePort` (Vercel Blob, S3) et passer une URL de reference dans l'event : `{ data: { exportId: "exp_123", downloadUrl: "https://..." } }`. Ce pattern decouple le transport de l'event du stockage des donnees.
- **Adapter in-memory (dev)** : la validation de taille est AUSSI appliquee en dev (meme seuil). Ceci evite que le dev ecrive des events trop gros qui fonctionnent en dev (pas de limite in-memory) mais echouent en production (queue limit).
- **Seuil d'alerte** : au-dela de **32KB** (50% du seuil), le framework log un warning : `Event "order.created" payload is 45KB (limit: 64KB). Consider reducing payload size.`. Le warning est emis une fois par eventName par process (pas de spam).
- **Validation de serialisation JSON** : avant l'emission, le framework valide que le payload est serialisable en JSON. `JSON.stringify()` est appele dans un try/catch. Si la serialisation echoue (references circulaires, BigInt sans replacer, fonctions, Symbol), le framework leve `MantaError(INVALID_DATA, 'Event payload for "{eventName}" is not JSON-serializable: {error.message}')`. L'event n'est PAS emis. Ce contrat est symetrique avec IWorkflowStoragePort (WS-09). Sans cette validation, un `JSON.stringify()` qui echoue dans l'adapter queue (Vercel Queues) serait silencieux — l'event disparaitrait. Test : E-14.
- Compatibilite serverless : ✅ Compatible (validation in-process, pas d'I/O).

---

### 33. Blue/Green Migration Compatibility

**SPEC-139 : Migrations et deploiement blue/green — guide de compatibilite**
- Contrat : le framework documente explicitement les patterns de migration compatibles et incompatibles avec le deploiement blue/green (deux versions du code tournant simultanement).
- **Le framework NE gere PAS** le blue/green — c'est la responsabilite de l'infra (Vercel, Kubernetes). Le framework fournit un guide et des gardes.
- **Migrations backward-compatible** (safe pour blue/green) :
  - `ADD COLUMN ... DEFAULT ...` (les anciennes versions ignorent la nouvelle colonne)
  - `ADD INDEX` (pas d'impact sur l'ancienne version)
  - `CREATE TABLE` (l'ancienne version ne reference pas la nouvelle table)
- **Migrations backward-INCOMPATIBLE** (unsafe pour blue/green) :
  - `ADD COLUMN ... NOT NULL` sans default (l'ancienne version ne sait pas ecrire cette colonne → echec INSERT)
  - `DROP COLUMN` (l'ancienne version lit/ecrit cette colonne → echec)
  - `RENAME COLUMN` (l'ancienne version reference l'ancien nom → echec)
  - `ALTER TYPE` (l'ancienne version envoie des donnees du mauvais type)
- **Detection par `manta db:diff`** : les migrations generees par `manta db:generate` sont annotees dans le fichier SQL :
  ```sql
  -- @manta:compat backward-incompatible
  -- @manta:reason "DROP COLUMN removes data needed by previous version"
  ALTER TABLE products DROP COLUMN legacy_sku;
  ```
  `manta db:diff` affiche un warning si une migration backward-incompatible est en attente : `Warning: Migration 0003_drop_legacy_sku.sql is backward-incompatible. In blue/green deployments, the previous version will fail after this migration. Consider a two-phase migration (add nullable column → deploy → populate → make NOT NULL).`
- **Pattern recommande — migration en deux phases** : pour les changements backward-incompatibles, le dev decompose en 2 deploys :
  1. Deploy 1 : `ADD COLUMN new_col DEFAULT NULL` + code qui ecrit dans les deux colonnes
  2. Deploy 2 : `DROP COLUMN old_col` + code qui lit uniquement la nouvelle colonne
- Compatibilite serverless : ✅ Compatible (documentation, pas d'implementation runtime).

---

### 34. Route Conflict Resolution Mechanism

**SPEC-140 : Mecanisme concret de resolution des conflits de routes inter-plugins**
- Contrat : le framework contractualise le mecanisme interne de resolution des conflits de routes.
- **Mecanisme** : le route loader construit une `Map<routeKey, RouteRegistration>` ou `routeKey = "${method}:${path}"` (ex: `"GET:/admin/products"`). Les routes sont chargees dans l'ordre :
  1. Plugins, dans l'ordre de `defineConfig({ plugins: [...] })`. Chaque plugin ecrase les routes existantes avec le meme `routeKey` (last-wins).
  2. Projet local (`src/api/`). Les routes du projet ecrasent TOUJOURS les routes des plugins.
  3. `defineMiddlewares()` n'affecte PAS le handler de route — il ajoute des middlewares avant/apres le handler existant.
- **Detection de conflit** : quand un `routeKey` est ecrase, le framework log un warning :
  ```
  Route conflict: GET /admin/products
    Declared by: @manta/plugin-a (overwritten)
    Declared by: @manta/plugin-b (active)
  ```
  En strict mode : `MantaError(INVALID_DATA, 'Route conflict: GET /admin/products declared by both ...')`.
- **Methodes distinctes** : `GET /products` et `POST /products` ne sont PAS en conflit — chaque methode HTTP est une route distincte.
- **Listing des routes** : `manta routes` (CLI) affiche toutes les routes enregistrees avec leur source (plugin ou projet local). Utile pour le debug de conflits.
- Compatibilite serverless : ✅ Compatible (resolution au boot, pas de runtime overhead).
