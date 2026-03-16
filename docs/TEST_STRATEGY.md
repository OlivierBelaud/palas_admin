# Test Strategy — Manta Framework
> Strategie de test exhaustive pour le framework Manta
> Adapter Conformance Suites + Integration Patterns + Migration Tests + Strict Mode + Helpers @manta/testing
> Derniere mise a jour : 2026-03-09

---

## Resume executif

Ce document definit **comment tester chaque port du framework**, garantir la conformite des adapters, et valider les integrations end-to-end. Le principe fondamental : **le code metier ne teste jamais un adapter specifique — il teste le port**. Un adapter qui passe sa Conformance Suite est certifie compatible. Point final.

---

## 1. Philosophie de test

### Principes

1. **Chaque port a une Adapter Conformance Suite** — un ensemble de tests qui definit le contrat comportemental du port. Si un adapter passe la suite, il est certifie compatible avec le framework.
2. **Un adapter qui passe la suite est certifie compatible** — pas de "presque compatible". C'est binaire : la suite passe ou elle ne passe pas.
3. **Les tests metier ne testent JAMAIS un adapter specifique** — ils importent le port, pas l'adapter. Le container injecte l'implementation. En test, c'est toujours un adapter in-memory sauf besoin explicite.
4. **`@manta/testing` fournit les helpers** — container de test, adapters in-memory, scoped context, spies sur events, base de donnees de test avec rollback automatique.
5. **Pas de mocks generiques** — on utilise les adapters in-memory fournis par le framework, pas des `jest.mock()` sur des modules. Les in-memory adapters implementent le vrai contrat du port.
6. **Chaque Conformance Suite est un export reutilisable** — un dev qui cree un adapter custom importe la suite et la lance contre son implementation. Zero effort.

### Structure des tests

```
tests/
├── conformance/          ← Adapter Conformance Suites (exportees par @manta/testing)
│   ├── cache.test.ts
│   ├── event-bus.test.ts
│   ├── locking.test.ts
│   ├── database.test.ts
│   ├── repository.test.ts
│   ├── workflow-engine.test.ts
│   ├── workflow-storage.test.ts
│   ├── job-scheduler.test.ts
│   ├── file.test.ts
│   ├── logger.test.ts
│   ├── auth.test.ts
│   ├── http.test.ts
│   ├── notification.test.ts
│   ├── translation.test.ts
│   ├── container.test.ts
│   ├── dml-generator.test.ts
│   └── message-aggregator.test.ts
├── integration/          ← Tests d'integration entre ports
│   ├── bootstrap.test.ts
│   ├── workflow-e2e.test.ts
│   ├── http-lifecycle.test.ts
│   ├── module-lifecycle.test.ts
│   ├── auth-propagation.test.ts
│   ├── query-external-timeout.test.ts
│   ├── link-treeshaking.test.ts
│   └── entity-threshold.test.ts
└── e2e/                  ← Full stack (CI/CD only)
    └── vercel-deploy.test.ts
```

### Pattern d'une Conformance Suite

Chaque suite est une fonction exportee par `@manta/testing` :

```typescript
// @manta/testing/conformance/cache
import { runCacheConformance } from '@manta/testing'

// Pour tester l'adapter Upstash :
runCacheConformance({
  createAdapter: () => new UpstashCacheAdapter(config),
  cleanup: async (adapter) => await adapter.clear(),
})

// Pour tester l'adapter in-memory :
runCacheConformance({
  createAdapter: () => new InMemoryCacheAdapter(),
  cleanup: async (adapter) => await adapter.clear(),
})
```

La suite genere automatiquement tous les tests. Le dev n'a rien a ecrire — juste fournir la factory et le cleanup.

### Versioning des Conformance Suites

Chaque Conformance Suite est versionnee avec le framework (`@manta/testing` suit la version de `@manta/framework`). Les regles de versioning :
- **Ajout de tests** (nouveau test dans une suite existante) = **minor version**. Les adapters existants ne cassent pas (sauf si leur implementation etait incomplete).
- **Modification de tests** (changement de contrat comportemental) = **major version**. Un adapter qui passait la suite avant peut echouer apres. C'est un breaking change — le CHANGELOG doit le documenter explicitement.
- **Suppression de tests** (ex: T4 NOT_IMPLEMENTED passe a implemented) = test existant retire + nouveau test ajoute = **major version**. Le test T-11 (verifier NOT_IMPLEMENTED) est retire et remplace par les tests T4 reels.
- **Tests temporaires (v1-only)** : les tests qui verifient un comportement temporaire (ex: T-11 teste NOT_IMPLEMENTED en v1) sont marques `@since("1.0.0") @until("2.0.0")`. La suite de conformance utilise le `version` passe a `runXxxConformance()` pour inclure/exclure automatiquement ces tests. En v2, T-11 est exclu sans action manuelle. Chaque test temporaire DOIT avoir un `@until` — les tests permanents n'ont pas de `@until`.
- Chaque `runXxxConformance()` accepte un `version?: string` optionnel pour cibler une version specifique de la suite (utile pendant la migration entre majors). Par defaut, la derniere version est utilisee.

---

## 2. Adapter Conformance Suites

### 2.1 ICachePort Conformance

| # | Test | Description | Assertion |
|---|------|-------------|-----------|
| C-01 | `set/get > roundtrip basique` | `set("key", "value", 60)` puis `get("key")` | Retourne `"value"` |
| C-02 | `set/get > TTL respecte` | `set("key", "value", 1)` puis attendre 1.1s puis `get("key")` | Retourne `null` |
| C-03 | `get > cle inexistante` | `get("nonexistent")` | Retourne `null` |
| C-04 | `invalidate > cle exacte` | `set("user:1", "a")`, `set("user:2", "b")` puis `invalidate("user:1")` | `get("user:1")` = `null`, `get("user:2")` = `"b"` |
| C-04b | `version-key > invalidation groupee` | `set("cache:v1:user:1", "a")`, `set("cache:v1:user:2", "b")`, incrementer version courante a v2 | Code metier lisant version courante ne trouve plus les anciennes cles. `get("cache:v1:user:1")` = `"a"` (encore en cache, expire via TTL). `computeKey("user:1")` retourne `"cache:v2:user:1"` → `get()` = `null` (pas encore set). **Note** : ce test appartient a la Conformance Suite ICachingPort (SPEC-079), PAS ICachePort. Il teste le pattern version-key qui est une abstraction au-dessus du port. Un adapter ICachePort qui implemente correctement `get/set/invalidate` passe C-01 a C-09 — C-04b est optionnel pour ICachePort et obligatoire pour ICachingPort. |
| C-05 | `clear > supprime tout` | `set("a", "1")`, `set("b", "2")` puis `clear()` | `get("a")` = `null`, `get("b")` = `null` |
| C-06 | `version-key > invalidation par version` | `set("cache:v1:users", data, 300)`, incrementer version → `set("cache:v2:users", newData, 300)` | `get("cache:v1:users")` = data encore present (TTL), `get("cache:v2:users")` = newData. Le code metier ne lit que la version courante. |
| C-07 | `set/get > concurrent access` | 100 `set()` paralleles avec des cles differentes | Toutes les valeurs recuperables sans corruption |
| C-08 | `set > ecrase valeur existante` | `set("key", "v1")` puis `set("key", "v2")` | `get("key")` = `"v2"` |
| C-09 | `set/get > serialisation JSON` | `set("obj", { nested: { deep: true } })` puis `get("obj")` | Retourne l'objet identique (deep equality) |

---

### 2.2 IEventBusPort Conformance

| # | Test | Description | Assertion |
|---|------|-------------|-----------|
| E-01 | `emit/subscribe > delivery basique` | `subscribe("order.created", handler)` puis `emit("order.created", payload)` | `handler` appele avec `payload` |
| E-02 | `emit > sans subscriber` | `emit("unknown.event", payload)` | Pas d'erreur, silencieux |
| E-03 | `grouped > hold empile les events` | `emit("order.created", p1, { groupId: "tx-1" })` — hold actif | `handler` PAS appele immediatement |
| E-04 | `grouped > release delivre tout en FIFO` | Hold 3 events (eventA, eventB, eventC) avec meme groupId, puis `release("tx-1")`. Un subscriber unique ecoute les 3 event names | Les 3 events sont delivres dans l'**ordre FIFO d'emission** (eventA avant eventB avant eventC). **Note** : l'ordre FIFO concerne l'ordre des events emis depuis le groupe, PAS l'ordre d'appel des handlers entre subscribers differents. Si 3 subscribers ecoutent le meme event, l'ordre entre eux n'est PAS garanti (SPEC-034). Ce test utilise un seul subscriber qui ecoute les 3 events pour verifier le FIFO |
| E-05 | `grouped > clear supprime tout` | Hold 3 events, puis `clear("tx-1")` | Aucun handler appele, events perdus |
| E-06 | `grouped > TTL expiration` | Hold events avec TTL=1s, attendre 1.5s | Events expires, `release()` ne delivre rien |
| E-07 | `subscriber > deduplication par subscriberId` | `subscribe("evt", handler, { subscriberId: "sub-1" })` x2 | Handler appele UNE seule fois par emit |
| E-08 | `interceptors > appeles mais non-bloquants` | Enregistrer un interceptor lent (100ms), emettre | L'emit retourne avant que l'interceptor ait fini |
| E-09 | `interceptors > lecture seule` | Interceptor modifie le payload | Le subscriber recoit le payload ORIGINAL (non modifie) |
| E-10 | `makeIdempotent > duplicate skip` | Subscriber wrape avec `makeIdempotent()`, emettre 2x avec meme eventId | Handler appele UNE seule fois |
| E-11 | `makeIdempotent > events differents passes` | Subscriber wrape, emettre 2 events avec eventId differents | Handler appele 2 fois |
| E-12 | `subscribe > multiple subscribers` | 3 subscribers sur meme event, emettre 1x | Les 3 appeles |
| E-13 | `grouped > maxActiveGroups depasse` | Configurer `maxActiveGroups: 5`, creer 5 groupes sans release, tenter `emit(event, { groupId: "6th" })` | `MantaError(RESOURCE_EXHAUSTED)`. Les 5 groupes existants ne sont pas affectes |
| E-14 | `emit > payload non-serialisable` | `emit("test.event", { circular: ref })` ou `ref` a une reference circulaire | `MantaError(INVALID_DATA, 'Event payload for "test.event" is not JSON-serializable: ...')`. Meme comportement pour BigInt sans replacer, fonctions, Symbol. L'event n'est PAS emis |

---

### 2.3 ILockingPort Conformance

| # | Test | Description | Assertion |
|---|------|-------------|-----------|
| L-01 | `execute > exclusion mutuelle` | 2 appels `execute("lock-1", fn)` concurrents, `fn` prend 50ms | Les 2 executions sont serialisees (total > 100ms) |
| L-02 | `execute > resultat retourne` | `execute("lock-1", () => 42)` | Retourne `42` |
| L-03 | `execute > erreur propagee` | `execute("lock-1", () => { throw new Error("boom") })` | L'erreur est propagee, le lock est libere |
| L-04 | `acquire/release > lifecycle manuel` | `acquire("lock-1")` → true, `acquire("lock-1")` → false, `release("lock-1")`, `acquire("lock-1")` → true | Lock exclusif, liberable |
| L-05 | `TTL > expiration auto` | `acquire("lock-1", { ttl: 1000 })`, attendre 1.1s, `acquire("lock-1")` | Second acquire reussit (lock expire) |
| L-06 | `multi-key > atomicite` | `acquire(["key-1", "key-2"])` — si key-2 deja pris | Aucune cle lockee (rollback atomique) |
| L-07 | `execute > timeout` | `execute("lock-1", slowFn, { timeout: 100 })` avec `slowFn` qui prend 500ms | MantaError(TIMEOUT) leve, lock libere |

---

### 2.4 IDatabasePort Conformance

| # | Test | Description | Assertion |
|---|------|-------------|-----------|
| D-01 | `connection > etablissement` | Creer adapter, appeler une query simple (`SELECT 1`) | Retourne sans erreur |
| D-02 | `pool > min=0 fonctionne` | Configurer pool avec `min: 0`, laisser idle, puis query | Connection etablie on-demand (pattern serverless) |
| D-03 | `connection > retry on failure` | Configurer avec un host invalide puis corriger | Retry automatique selon config (pas d'erreur fatale immediate) |
| D-04 | `transaction > commit` | Demarrer transaction, INSERT, COMMIT, SELECT | Donnee presente |
| D-05 | `transaction > rollback` | Demarrer transaction, INSERT, ROLLBACK, SELECT | Donnee absente |
| D-06 | `transaction > isolation READ COMMITTED` | Transaction A INSERT, Transaction B SELECT (avant commit A) | Transaction B ne voit PAS la donnee non commitee |
| D-07 | `transaction > isolation SERIALIZABLE` | 2 transactions concurrentes modifiant la meme row | Une des deux echoue avec serialization failure |
| D-08 | `nested transaction > savepoint` | Transaction parent, nested transaction avec savepoint, rollback nested | Parent toujours active, donnees du savepoint annulees |
| D-09 | `nested transaction > desactive par defaut` | `enableNestedTransactions: false` (defaut), nested call | Reutilise la transaction parent (pas de savepoint) |
| D-10 | `dbErrorMapper > PG 23505 → DUPLICATE_ERROR` | INSERT qui viole un UNIQUE constraint | MantaError avec type `DUPLICATE_ERROR` |
| D-11 | `dbErrorMapper > PG 23503 → NOT_FOUND` | INSERT avec FK vers row inexistante | MantaError avec type `NOT_FOUND` |
| D-12 | `dbErrorMapper > PG 23502 → INVALID_DATA` | INSERT avec NULL sur colonne NOT NULL | MantaError avec type `INVALID_DATA` |
| D-13 | `dbErrorMapper > PG 40001 → CONFLICT` | Serialization failure (voir D-07) | MantaError avec type `CONFLICT` |
| D-14 | `connection > dispose ferme le pool` | `dispose()` puis query | Erreur de connexion (pool ferme) |

---

### 2.5 IRepository Conformance

| # | Test | Description | Assertion |
|---|------|-------------|-----------|
| R-01 | `find > filtre soft-delete auto` | Creer entite, soft-delete, `find()` | Entite absente du resultat |
| R-02 | `find > withDeleted:true inclut soft-deleted` | Creer entite, soft-delete, `find({ withDeleted: true })` | Entite presente avec `deleted_at` non null |
| R-03 | `create > insertion` | `create({ name: "test" })` | Entite creee avec `id` genere, `created_at` rempli |
| R-04 | `update > modification` | Creer puis `update(id, { name: "updated" })` | `name` = `"updated"`, `updated_at` mis a jour |
| R-05 | `delete > suppression hard` | `delete(id)` | Entite absente meme avec `withDeleted: true` |
| R-06 | `softDelete > suppression logique` | `softDelete(id)` | `deleted_at` rempli, `find()` ne le retourne pas, `find({ withDeleted: true })` le retourne |
| R-07 | `restore > restauration` | Soft-delete puis `restore(id)` | `deleted_at` = null, `find()` le retourne a nouveau |
| R-08 | `upsertWithReplace > INSERT si nouveau` | `upsertWithReplace({ id: "new", name: "test" })` | Entite creee |
| R-09 | `upsertWithReplace > UPDATE si existant` | Creer entite, puis `upsertWithReplace({ id: existing, name: "updated" })` | `name` mis a jour |
| R-10 | `upsertWithReplace > replaceFields controle` | Upsert avec `replaceFields: ["name"]` sur entite existante avec `name` et `email` | Seul `name` ecrase, `email` inchange |
| R-11 | `transaction > propagation via Context` | Demarrer transaction, passer le context au repo, INSERT | INSERT dans la meme transaction |
| R-12 | `nested transaction > savepoint quand active` | `enableNestedTransactions: true`, transaction parent, repo operation dans nested | Savepoint cree, rollback du nested n'affecte pas le parent |
| R-13 | `find > pagination` | Creer 50 entites, `find({ limit: 10, offset: 20 })` | 10 entites retournees, skip des 20 premieres |
| R-14 | `find > tri` | Creer entites avec noms differents, `find({ order: { name: "ASC" } })` | Resultats tries alphabetiquement |
| R-15 | `softDelete > retour contient Record<string, string[]>` | Creer entite Product avec link vers Collection (defineLink, deleteCascade:true), puis `softDelete(productId)` | Retour est `Record<string, string[]>` contenant les IDs des liens cascades : `{ "collection_product": ["link_id_1"] }`. Le format est `{ [linkTableName]: string[] }` |
| R-16 | `softDelete > retour sans cascade` | Creer entite Product sans liens, puis `softDelete(productId)` | Retour est `Record<string, string[]>` vide `{}` (pas de liens cascades) |
| R-17 | `restore > ne restaure PAS les liens cascades` | Creer entite + link, softDelete (cascade link), puis `restore(productId)` | Entite restauree (`deleted_at = null`). Le link reste soft-deleted (`deleted_at` non null). Verifier via query sur la table de link avec `withDeleted: true` |
| R-18 | `transaction > rollback inter-services` | Deux services (serviceA, serviceB) dans la meme transaction via `Context.transactionManager`. `serviceA.create()` reussit, puis `serviceB.create()` throw | Les donnees de serviceA sont rollback (absentes de la DB). Verifie que le partage de transaction via Context fonctionne pour le cas critique : un service reussit, l'autre echoue, TOUT est rollback. C'est le test principal du mecanisme SPEC-126 |
| R-19 | `cursor pagination > traversal complet sans doublon` | Creer 50 entites, paginer par `cursor` avec `limit: 10` | 5 pages traversees. Aucun doublon (set des IDs = 50 uniques). Aucun trou (tous les 50 sont presents). `hasMore = true` pour les 4 premieres pages, `hasMore = false` pour la 5eme. Le cursor retourne par chaque page est utilisable pour la suivante |

---

### 2.6 IWorkflowEnginePort Conformance

| # | Test | Description | Assertion |
|---|------|-------------|-----------|
| W-01 | `run > execution sequentielle` | Workflow avec steps A → B → C | Executes dans l'ordre, resultat final correct |
| W-02 | `compensation > rollback inverse` | Steps A → B → C, C echoue | Compensation de B puis A (ordre inverse) |
| W-03 | `compensation > step sans compensate` | Step B n'a pas de `compensate`, C echoue | A compense, B skippe (pas d'erreur) |
| W-04 | `checkpoint > persistence` | Run step A, simuler crash, relancer | Reprend a partir du checkpoint de A (A pas re-execute) |
| W-05 | `parallel > tous compenses si un echoue` | 3 steps paralleles, 1 echoue | Les 2 reussis sont compenses |
| W-06 | `parallel > resultats agreges` | 3 steps paralleles, tous reussissent | Resultat = objet avec les 3 outputs |
| W-07 | `async > suspend/resume` | Step async qui retourne `StepStatus.WAITING` | Workflow suspendu, `setStepSuccess(id, data)` le reprend |
| W-08 | `async > setStepFailure` | Step async, `setStepFailure(id, error)` | Compensation declenchee |
| W-09 | `grouped events > released on success` | Workflow avec events groupes, succes | Tous les events emis a la fin |
| W-10 | `grouped events > cleared on failure` | Workflow avec events groupes, echec | Aucun event emis |
| W-11 | `idempotency > meme transactionId = meme resultat` | Run 2x avec meme `transactionId` | Second run retourne le resultat du premier (pas de re-execution) |
| W-12 | `timeout > step timeout` | Step avec timeout: 100ms qui prend 500ms | MantaError(TIMEOUT), compensation declenchee |
| W-13 | `nested workflow > invoke` | Workflow parent appelle un workflow enfant | Resultats propagees, compensation cascade |
| W-14 | `checkpoint > recovery sans re-execution` | Steps A (DONE) → B (non-complete), simuler reprise | A pas re-execute, resultat A lu depuis storage, B execute normalement |
| W-15 | `checkpoint > events non re-emis pour steps DONE` | Step A emet events, marque DONE, simuler reprise | Les events de A ne sont PAS re-emis au redemarrage |
| W-16 | `subscribe > STEP_SUCCESS notifie` | `engine.subscribe({ event: 'STEP_SUCCESS' }, handler)`, run workflow avec step reussi | `handler` appele avec `{ workflowId, transactionId, stepId, result }`. Handler est appele de maniere **asynchrone** (fire-and-forget, PAS bloquant pour le workflow) |
| W-17 | `subscribe > FINISH notifie` | `engine.subscribe({ event: 'FINISH' }, handler)`, run workflow jusqu'a completion | `handler` appele avec `{ workflowId, transactionId, status: 'DONE' }` |
| W-18 | `subscribe > handler error non-bloquant` | `engine.subscribe({ event: 'STEP_SUCCESS' }, () => { throw new Error('boom') })`, run workflow | Le workflow complete normalement. L'erreur du handler est loguee via ILoggerPort mais NE bloque PAS le workflow. Les subscribe handlers sont des observateurs, pas des participants |
| W-19 | `subscribe > unsubscribe` | Subscribe, verifier notification, unsubscribe, re-run | Handler appele la premiere fois, PAS la seconde |
| W-20 | `parallel > message aggregator merge` | Workflow avec `parallelize(stepA, stepB)`, chaque step emet 1 event via `save()` | Apres succes, `releaseGroupedEvents()` publie les 2 events. Les events proviennent de 2 IMessageAggregator SCOPED differents, merges par le workflow engine. L'ordre des 2 events n'est PAS garanti. |
| W-21 | `parallel > message aggregator cleared on failure` | Workflow avec `parallelize(stepA, stepB)`, stepA emet 1 event, stepB echoue | Aucun event emis. Le engine appelle `clearMessages()` sur les 2 IMessageAggregator (stepA reussi + stepB echoue). |

---

### 2.7 IWorkflowStoragePort Conformance

| # | Test | Description | Assertion |
|---|------|-------------|-----------|
| WS-01 | `save/load > roundtrip` | `save(transactionId, stepId, data)` puis `load(transactionId, stepId)` | Retourne `data` identique. Note : le premier argument est `transactionId` (pas workflowId) — c'est la cle de transaction du workflow run |
| WS-02 | `merge > par stepId` | 3 steps paralleles ecrivent chacun leur checkpoint via `save(txId, stepA/B/C, data)` | `load(txId)` sans stepId retourne un merge des 3 checkpoints |
| WS-03 | `merge > last-write-wins sur meme key` | 2 ecritures sur meme `stepId` | Derniere valeur gagne |
| WS-04 | `serialisation > JSON valide` | Sauver un objet avec dates, nested objects, arrays | Retourne des donnees identiques apres deserialisation |
| WS-05 | `schema isolation > separation workflow/app` | Les tables de workflow sont dans un schema separe | Query sur le schema app ne voit pas les tables workflow |
| WS-06 | `load > workflow inexistant` | `load("nonexistent")` | Retourne `null` ou objet vide (pas d'erreur) |
| WS-07 | `cleanup > suppression apres retention` | Checkpoints plus vieux que la retention period | Supprimes automatiquement ou par appel explicite |
| WS-08 | `serialisation > BigInt roundtrip` | `save(wfId, stepId, { amount: BigInt(999999999999) })` puis `load(wfId, stepId)` | Retourne `{ amount: BigInt(999999999999) }` (converti via replacer/reviver interne) |
| WS-09 | `serialisation > Map interdit` | `save(wfId, stepId, { data: new Map() })` | `MantaError(INVALID_DATA, 'Step result contains non-serializable type: Map...')` |
| WS-10 | `serialisation > Date converti en string` | `save(wfId, stepId, { createdAt: new Date('2026-01-01') })` puis load | Retourne `{ createdAt: '2026-01-01T00:00:00.000Z' }` (string ISO, pas Date object) |
| WS-11 | `nested workflows > transactionIds distincts` | Deux sous-workflows avec le meme `workflowId` mais des `transactionId` differents ecrivent chacun des checkpoints via `save(txIdA, stepX, dataA)` et `save(txIdB, stepX, dataB)` | `load(txIdA, stepX)` retourne `dataA`, `load(txIdB, stepX)` retourne `dataB` — les checkpoints ne se partagent PAS. Ce test detecte un bug subtil ou le storage utiliserait `workflowId` comme cle au lieu de `transactionId`. |

---

### 2.8 IJobSchedulerPort Conformance

| # | Test | Description | Assertion |
|---|------|-------------|-----------|
| J-01 | `register > cron expression` | `register("daily-sync", "0 0 * * *", handler)` | Job enregistre sans erreur |
| J-02 | `execute > retourne JobResult` | Executer un job manuellement | `JobResult { status: "success", duration_ms: number }` |
| J-03 | `execute > echec retourne erreur` | Job qui throw | `JobResult { status: "failure", error: Error, duration_ms: number }` |
| J-04 | `concurrency > forbid skip si locked` | Configurer `concurrency: "forbid"`, lancer 2x en parallele | Second skip avec `status: "skipped"` |
| J-05 | `retry > maxRetries avec backoff` | Job qui echoue 2x puis reussit, `maxRetries: 3` | 3 tentatives, la 3eme reussit. **Profil de test par adapter** : pour l'adapter in-memory (node-cron), le retry est in-process (3 appels dans le meme process). Pour l'adapter Vercel Cron, le retry est cross-invocation — le test DOIT simuler 3 invocations HTTP separees via un mock IWorkflowStoragePort partage entre les invocations (la suite de conformance fournit `createSharedStorageMock()` qui persiste l'etat entre appels `createAdapter()`). Ce n'est PAS un test e2e HTTP — c'est un test unitaire avec persistence mockee. |
| J-06 | `retry > maxRetries epuise` | Job qui echoue toujours, `maxRetries: 2` | `status: "failure"` apres 2 retries |
| J-07 | `getJobHistory > historique` | Executer un job 3x | `getJobHistory("job-id")` retourne 3 entries |
| J-08 | `timeout > job depasse le timeout` | Job avec `timeout: 100`, execution prend 500ms | `JobResult { status: "failure", error: TimeoutError }` |
| J-09 | `dependances > 3 ports requis` | Adapter construit sans ILockingPort, ILoggerPort, ou IWorkflowStoragePort | Erreur a la construction pour chaque dependance manquante |
| J-10 | `cron > AuthContext systeme propage` | Executer un job cron, le handler resolve `AUTH_CONTEXT` depuis le scope | Retourne `{ actor_type: 'system', actor_id: 'cron' }`. Le scope est cree par l'adapter via createScope() + ALS. Un handler qui appelle un service avec `@EmitEvents()` propage l'auth context systeme dans les events |

---

### 2.9 IFilePort / IFileProvider Conformance

| # | Test | Description | Assertion |
|---|------|-------------|-----------|
| F-01 | `upload/get > roundtrip` | `upload("test.txt", buffer)` puis `getFile("test.txt")` | Contenu identique |
| F-02 | `delete > suppression` | Upload puis `delete("test.txt")` puis `getFile("test.txt")` | `null` ou erreur NOT_FOUND |
| F-03 | `presigned download > URL valide` | `getPresignedDownloadUrl("test.txt")` | URL string, accessible (HTTP 200) |
| F-04 | `presigned upload > URL valide` | `getPresignedUploadUrl("test.txt")` (si supporte) | URL string, upload via PUT fonctionne |
| F-05 | `stream > download` | `getDownloadStream("test.txt")` | ReadableStream avec le contenu correct |
| F-06 | `stream > upload` | `getUploadStream("test.txt")` → ecrire → fermer → `getFile("test.txt")` | Contenu correct |
| F-07 | `upload > fichier volumineux` | Upload 10MB | Pas de timeout, contenu integre |
| F-08 | `get > fichier inexistant` | `getFile("nonexistent.txt")` | `null` ou MantaError(NOT_FOUND) |

---

### 2.10 ILoggerPort Conformance

| # | Test | Description | Assertion |
|---|------|-------------|-----------|
| LG-01 | `niveaux > 8 niveaux produisent du output` | Appeler `trace`, `debug`, `info`, `warn`, `error`, `panic`, `activity`, `progress` | Chaque niveau produit du output quand le threshold est assez bas |
| LG-02 | `threshold > filtre les niveaux inferieurs` | Configurer `level: "warn"`, appeler `info()` et `warn()` | `info()` silencieux, `warn()` produit du output |
| LG-03 | `shouldLog > retourne le bon boolean` | `shouldLog("info")` avec level="warn" | Retourne `false` |
| LG-04 | `shouldLog > retourne true au threshold` | `shouldLog("warn")` avec level="warn" | Retourne `true` |
| LG-05 | `activity/progress/success/failure > lifecycle` | `activity("task")` → `progress("50%")` → `success("done")` | Chaque appel produit du output, pas d'erreur |
| LG-06 | `setLogLevel > change le threshold a runtime` | `setLogLevel("debug")` puis `debug("test")` | Output produit (avant c'etait filtre) |
| LG-07 | `JSON mode > structured output` | Configurer en mode JSON, `info("message", { key: "val" })` | Output contient les cles `level`, `msg`, `time` |
| LG-08 | `JSON mode > pas de pretty print` | Mode JSON | Output est une seule ligne JSON parseable |

---

### 2.11 IAuthPort Conformance (crypto pure, zero dependance)

| # | Test | Description | Assertion |
|---|------|-------------|-----------|
| A-01 | `JWT > create/verify roundtrip` | `createJwt({ userId: "u1" })` puis `verifyJwt(token)` | Retourne `{ userId: "u1" }` |
| A-02 | `JWT > token expire retourne null` | `createJwt(payload, { expiresIn: "1s" })`, attendre 1.5s, `verifyJwt(token)` | Retourne `null` |
| A-03 | `JWT > token invalide retourne null` | `verifyJwt("garbage-token")` | Retourne `null` (pas d'exception) |
| A-04 | `JWT > token modifie retourne null` | Creer token, modifier 1 caractere, verifier | Retourne `null` |
| A-05 | `API Key > cle valide` | `verifyApiKey("sk_valid_key_123")` | Retourne `AuthContext { type: "api_key", ... }` |
| A-06 | `API Key > cle invalide retourne null` | `verifyApiKey("sk_invalid")` | Retourne `null` |
| A-07 | `zero dependance > pas de ICachePort` | Le constructeur IAuthPort n'accepte PAS ICachePort — uniquement AuthConfig | Aucune dependance externe |
| A-08 | `zero dependance HTTP > pas de Request/Headers` | Aucune methode n'accepte Request, Headers, ou IncomingMessage en parametre | Signatures utilisent uniquement des strings et objets simples |
| A-09 | `JWT > claims custom` | `createJwt({ userId: "u1", role: "admin", custom: { orgId: "o1" } })` puis verify | Tous les claims retournes |

### 2.11b IAuthModuleService Session Conformance (business logic, necessite ICachePort)

| # | Test | Description | Assertion |
|---|------|-------------|-----------|
| AS-01 | `Session > createSession roundtrip` | `createSession({ actor_type: 'user', actor_id: 'u1' })` puis `verifySession(sessionId)` | Retourne l'AuthContext original. Le sessionId est un UUID v4. L'AuthContext est stocke dans ICachePort sous `session:{sessionId}` |
| AS-02 | `Session > destroySession` | `createSession(auth)` puis `destroySession(sessionId)` puis `verifySession(sessionId)` | `verifySession` retourne `null` apres destroy |
| AS-03 | `Session > TTL expiration` | `createSession(auth, { ttl: 1 })` (1s), attendre 1.5s, `verifySession(sessionId)` | Retourne `null` (session expiree via TTL du cache) |
| AS-04 | `Session > session inexistante` | `verifySession("nonexistent-id")` | Retourne `null` |
| AS-05 | `Session > ICachePort mock` | Injecter un InMemoryCacheAdapter, verifier que createSession/verifySession fonctionnent | Pas de dependance a un adapter cache specifique |

### 2.11c IAuthGateway Conformance (facade d'authentification, SPEC-049b)

| # | Test | Description | Assertion |
|---|------|-------------|-----------|
| AG-01 | `Bearer > JWT valide retourne AuthContext` | `gateway.authenticate({ bearer: validJwt })` | Retourne l'AuthContext decode du JWT (delegue a IAuthPort.verifyJwt) |
| AG-02 | `Bearer > JWT invalide (non-sk_) retourne null` | `gateway.authenticate({ bearer: "garbage" })` (ne commence PAS par `sk_`) | Retourne `null`. `verifyApiKey` n'est PAS appele (verifier via spy) — le fallback sk_ ne s'applique que si le bearer commence par `sk_` |
| AG-03 | `API Key > cle valide retourne AuthContext` | `gateway.authenticate({ apiKey: "sk_valid_123" })` | Retourne l'AuthContext de l'API key (delegue a IAuthPort.verifyApiKey) |
| AG-04 | `API Key > cle invalide retourne null` | `gateway.authenticate({ apiKey: "sk_invalid" })` | Retourne `null` |
| AG-05 | `Session > sessionId valide retourne AuthContext` | `gateway.authenticate({ sessionId: validSessionId })` | Retourne l'AuthContext de la session (delegue a IAuthModuleService.verifySession) |
| AG-06 | `Session > sessionId invalide retourne null` | `gateway.authenticate({ sessionId: "nonexistent" })` | Retourne `null` |
| AG-07 | `Priorite > Bearer prioritaire sur session et API key` | `gateway.authenticate({ bearer: validJwt, sessionId: validSessionId, apiKey: "sk_valid" })` | Retourne l'AuthContext du JWT. verifySession et verifyApiKey ne sont JAMAIS appeles (verifier via spy) |
| AG-08 | `Priorite > API Key prioritaire sur session` | `gateway.authenticate({ apiKey: "sk_valid", sessionId: validSessionId })` sans bearer | Retourne l'AuthContext de l'API key. verifySession n'est JAMAIS appele (verifier via spy) |
| AG-09 | `Aucun credential > retourne null` | `gateway.authenticate({})` | Retourne `null`. Aucune methode de IAuthPort ni IAuthModuleService n'est appelee |
| AG-10 | `Bearer invalide (non-sk_) > rejet definitif meme avec session valide` | `gateway.authenticate({ bearer: "invalid", sessionId: validSessionId })` (bearer ne commence PAS par `sk_`) | Retourne `null`. `verifySession` n'est PAS appele (verifier via spy). **Regle** : un Bearer present mais invalide (non-sk_) est un rejet definitif — le gateway ne tombe JAMAIS en fallback sur session ou API key. Ceci couvre le cas ou un JWT expire est envoye avec un cookie session valide : le gateway rejette, il ne "degrade" pas vers la session |
| AG-11 | `Dependances > constructor prend IAuthPort + IAuthModuleService` | Inspecter le constructeur du gateway | Exactement 2 dependances. Pas de ICachePort, pas de IHttpPort, pas de Request/Headers |
| AG-12 | `Bearer sk_ > fallback vers verifyApiKey` | `gateway.authenticate({ bearer: "sk_valid_123" })` avec verifyJwt qui retourne null | `verifyJwt("sk_valid_123")` appele d'abord (retourne null), puis `verifyApiKey("sk_valid_123")` appele (retourne AuthContext). Le fallback ne s'active que pour les bearers commencant par `sk_` |
| AG-13 | `Bearer sk_ invalide > fallback echoue` | `gateway.authenticate({ bearer: "sk_invalid" })` avec verifyJwt=null et verifyApiKey=null | Retourne `null`. Les deux methodes sont appelees, les deux retournent null |
| AG-14 | `Bearer sk_ invalide + session valide > rejet definitif` | `gateway.authenticate({ bearer: "sk_invalid", sessionId: validSessionId })` avec verifyJwt=null et verifyApiKey=null | Retourne `null`. `verifySession` n'est PAS appele — meme un bearer sk_ invalide (apres fallback verifyApiKey echoue) bloque le fallback session |

---

### 2.12 IHttpPort Conformance

| # | Test | Description | Assertion |
|---|------|-------------|-----------|
| H-01 | `routing > path vers handler` | Enregistrer route `GET /api/users`, envoyer request | Handler appele, response retournee |
| H-02 | `routing > parametres dynamiques` | Route `GET /api/users/:id`, request `/api/users/123` | Handler recoit `params.id = "123"` |
| H-03 | `pipeline > 12 etapes dans l'ordre` | Intercepter chaque etape du pipeline | Ordre : RequestID → CORS → RateLimit → Scope → BodyParser → Auth → PublishableKey → Validation → Custom → RBAC → Handler → ErrorHandler |
| H-04 | `CORS > headers par namespace` | Configurer CORS differemment pour `/admin` et `/store` | Chaque namespace recoit ses propres headers CORS |
| H-05 | `requestId > generation` | Envoyer request sans header X-Request-Id | Response contient un X-Request-Id genere |
| H-06 | `requestId > propagation` | Envoyer request avec header X-Request-Id: "abc" | Response contient X-Request-Id: "abc" (propage) |
| H-07 | `scoped container > par requete` | 2 requetes concurrentes | Chaque requete a son propre scoped container (pas de leak) |
| H-08 | `error handler > MantaError vers HTTP` | Handler throw `MantaError(NOT_FOUND, "Order not found")` | Response HTTP 404, body `{ type: "NOT_FOUND", message: "Order not found" }` |
| H-09 | `error handler > MantaError(INVALID_DATA)` | Handler throw `MantaError(INVALID_DATA)` | Response HTTP 400, body `{ type: "INVALID_DATA", message: "..." }` |
| H-10 | `error handler > MantaError(UNAUTHORIZED)` | Handler throw `MantaError(UNAUTHORIZED)` | Response HTTP 401, body `{ type: "UNAUTHORIZED", message: "..." }` |
| H-11 | `error handler > erreur inconnue` | Handler throw `new Error("oops")` | Response HTTP 500, body `{ type: "UNEXPECTED_STATE", message: "An unexpected error occurred" }` (pas de leak) |
| H-19 | `error handler > MantaError with code` | Handler throw `MantaError(NOT_FOUND, "msg", { code: "ORDER_NOT_FOUND" })` | Body contient `{ type: "NOT_FOUND", code: "ORDER_NOT_FOUND" }` |
| H-20 | `error handler > Zod validation error` | Request body invalide avec schema Zod | Body contient `{ type: "INVALID_DATA", details: [{ path: [...], message: "..." }] }` |
| H-21 | `error handler > no stack in prod` | `NODE_ENV=production`, handler throw | Body ne contient PAS de champ `stack` |
| H-22 | `rate limit > 429 apres depassement` | Configurer rate limit 5 req/min, envoyer 6 requetes | 5 premieres retournent 200, la 6eme retourne 429 avec headers `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` |
| H-23 | `rate limit > reset apres window` | Configurer rate limit 5 req/60s, envoyer 5 req, attendre window, envoyer 1 req | La requete apres le reset retourne 200 |
| H-24 | `rate limit > custom keyFn` | Configurer `keyFn: (req) => req.headers['x-api-key']`, 2 API keys differentes | Chaque key a son propre compteur (10 req totales = 5 par key) |
| H-25 | `rate limit > desactive par defaut` | Pas de config rate limit | Aucune requete bloquee, pas de headers rate limit |
| H-26 | `rate limit > par namespace` | Config differente pour /store (100/min) et /auth (20/min) | Chaque namespace respecte son propre seuil |
| H-12 | `Web Standards > Request/Response` | Handler recoit un `Request` standard et retourne un `Response` standard | Pas de `req`/`res` Express |
| H-13 | `body parser > JSON` | Request avec `Content-Type: application/json` et body JSON | Handler recoit le body parse |
| H-14 | `body parser > form data` | Request avec `Content-Type: multipart/form-data` | Handler recoit les champs parses |
| H-15 | `health > /health/live returns 200` | GET /health/live | 200 OK avec `{ status: "alive", uptime_ms: number }` |
| H-16 | `health > /health/ready returns 200 when ready` | GET /health/ready avec DB et cache up | 200 OK avec checks all "ok" |
| H-17 | `health > /health/ready returns 503 when DB down` | GET /health/ready avec DB connection failed | 503 avec `{ status: "not_ready", checks: { database: "timeout" } }` |
| H-18 | `health > no auth on health endpoints` | GET /health/live sans Authorization header | 200 OK (pas d'auth requise) |
| H-27 | `health > /health/ready 503 when migrations pending` | Boot avec module version DB < code version | 503 avec `{ checks: { migrations: "pending" } }` |
| H-28 | `health > /health/ready 200 after migration` | Boot avec migration pending, executer `db:migrate`, re-check | 200 avec `{ checks: { migrations: "ok" } }` |

---

### 2.13 INotificationPort Conformance

| # | Test | Description | Assertion |
|---|------|-------------|-----------|
| N-01 | `send > status lifecycle` | `send({ to: "user@test.com", channel: "email", ... })` | Retourne `{ status: "SUCCESS" }` (ou PENDING puis SUCCESS) |
| N-02 | `idempotency_key > duplicate skip` | `send({ ..., idempotency_key: "idem-1" })` x2 | Seconde fois retourne le meme resultat sans re-envoi |
| N-03 | `channel routing > provider par channel` | Configurer email=Resend, sms=Twilio, envoyer sur chaque channel | Chaque envoi utilise le bon provider |
| N-04 | `channel routing > channel non configure` | Envoyer sur channel sans provider | MantaError(INVALID_DATA) avec message clair |
| N-05 | `batch > envoi multiple` | `sendBatch([notification1, notification2, notification3])` | 3 resultats, un par notification |
| N-06 | `batch > erreur partielle` | Batch de 3, le 2eme echoue | Resultat aggrege : 2 SUCCESS, 1 FAILURE (pas d'interruption) |
| N-07 | `send > provider failure` | Provider throw une erreur | Retourne `{ status: "FAILURE", error: ... }` (pas d'exception propagee) |

---

### 2.14 ITranslationPort Conformance

| # | Test | Description | Assertion |
|---|------|-------------|-----------|
| T-01 | `applyTranslations > remplace les champs` | Entite avec `name` en FR, locale="fr" | `name` remplace par la traduction FR |
| T-02 | `applyTranslations > no-op si module desactive` | Module translation non charge | Retourne l'entite inchangee, pas d'erreur |
| T-03 | `applyTranslations > fallback si locale manquante` | Demander locale "ja" non traduite | Retourne l'entite avec les valeurs par defaut |
| T-04 | `createTranslations > creation` | `createTranslations("product", "p1", "fr", { name: "Produit" })` | Traduction creee |
| T-05 | `updateTranslations > mise a jour` | Creer traduction puis `updateTranslations(...)` | Traduction mise a jour |
| T-06 | `deleteTranslations > suppression` | Creer traduction puis `deleteTranslations(...)` | Traduction supprimee, `applyTranslations` retourne valeur par defaut |
| T-07 | `getStatistics > comptages corrects` | 3 entites, 2 traduites en FR, 1 en EN | Stats retourne les bons comptages par locale |
| T-08 | `listLocales > locales disponibles` | Creer traductions en FR, EN, DE | `listLocales()` retourne `["de", "en", "fr"]` (triees) |
| T-09 | `applyTranslations > batch` | 100 entites avec traductions | Toutes traduites en un seul appel |
| T-10 | `applyTranslations > champs non-traductibles inchanges` | Entite avec `id`, `price`, `name` — seul `name` est traductible | `id` et `price` inchanges |
| T-11 | `T4 > NOT_IMPLEMENTED en v1` | `query.graph({ entity: "product", filters: { title: { $ilike: "%chemise%" } } }, { locale: "fr" })` ou `title` est `.translatable()` | `MantaError(NOT_IMPLEMENTED, 'Filtering on translatable fields (T4 JOIN) is not supported in v1...')` |

---

### 2.15 IContainer Conformance

| # | Test | Description | Assertion |
|---|------|-------------|-----------|
| CT-01 | `SINGLETON > meme instance` | `register("svc", Service, SINGLETON)`, `resolve("svc")` x2 | Meme reference |
| CT-02 | `SCOPED > instance par scope` | `createScope()` x2, `resolve("svc")` dans chaque | Instances differentes |
| CT-03 | `SCOPED > meme instance dans le meme scope` | `resolve("svc")` x2 dans le meme scope | Meme reference |
| CT-04 | `TRANSIENT > nouvelle instance` | `resolve("svc")` x2 | Instances differentes |
| CT-05 | `lifecycle inversion > SINGLETON depends on SCOPED` | Register SINGLETON qui depend de SCOPED | MantaError au moment du `register()` |
| CT-06 | `SCOPED hors scope > erreur` | `resolve("scoped-svc")` depuis le container global (hors scope) | MantaError(INVALID_STATE) |
| CT-07 | `registerAdd > multiples valeurs` | `registerAdd("plugins", A)`, `registerAdd("plugins", B)` | `resolve("plugins")` retourne `[A, B]` |
| CT-08 | `aliasTo > alias resout vers target` | `register("real", Service)`, `aliasTo("alias", "real")` | `resolve("alias")` retourne la meme instance que `resolve("real")` |
| CT-09 | `dispose > appele sur les services` | Register service avec methode `dispose()`, appeler `container.dispose()` | `service.dispose()` appele |
| CT-10 | `dispose > ignore les services sans dispose` | Register service sans methode `dispose()`, appeler `container.dispose()` | Pas d'erreur |
| CT-11 | `resolve > cle inexistante` | `resolve("nonexistent")` | MantaError(NOT_FOUND) ou undefined selon config |
| CT-12 | `scope > herite des singletons parent` | Register SINGLETON dans parent, creer scope, resolve dans scope | Retourne le singleton du parent |
| CT-13 | `id > UUID v4 unique par scope` | `createScope()` x2, lire `scope.id` sur chaque | Les deux IDs sont des UUID v4 valides et differents |
| CT-14 | `id > container global a un id` | Lire `container.id` sur le container global | UUID v4 valide |
| CT-15 | `dispose > with active scope` | **Setup** : creer un scope via `asyncLocalStorage.run(scope, callback)` avec un callback qui `await` une Promise non-resolue (simulant un handler en cours). Pendant que le callback attend, appeler `container.dispose()` depuis l'exterieur du scope. Puis resoudre la Promise pour que le callback continue et tente un `resolve()`. **Mecanisme de simulation** : `const gate = createDeferred(); await withScope(container, async (scope) => { const svc = scope.resolve("svc"); await gate.promise; /* <-- bloque ici */ scope.resolve("other-svc"); /* apres dispose */ }); /* en parallele */ await container.dispose(); gate.resolve();` | `dispose()` complete sans attendre le scope actif. Les SINGLETON sont disposes. `svc` (deja resolu avant dispose) est utilisable. `scope.resolve("other-svc")` (apres dispose) leve `MantaError(INVALID_STATE, 'Container is disposed')` |
| CT-16 | `scope leak > memoire stable apres N scopes` | Creer 1000 scopes en sequence, enregistrer des services SCOPED, laisser les scopes se terminer | La memoire du process ne croit pas lineairement (heap usage apres 1000 scopes ≈ heap usage apres 10 scopes, tolerance +20%). Utiliser `assertNoScopeLeak(container, 1000)` de `@manta/testing` |
| CT-17 | `scope lifecycle > fin normale sans dispose` | `withScope(container, async (scope) => { scope.resolve("scoped-svc") })` puis tenter `scope.resolve("scoped-svc")` apres | Apres la fin du callback, `asyncLocalStorage.getStore()` retourne `undefined`. `dispose()` n'est PAS appele sur le scoped container. Le scoped container est eligible au GC (WeakRef test). Tenter de resolve depuis le scope apres la fin du callback fonctionne techniquement (le container existe encore) mais `asyncLocalStorage.getStore()` ne pointe plus vers lui |
| CT-18 | `dispose > TRANSIENT instances NOT disposed` | Enregistrer un service TRANSIENT avec methode `dispose()`, resoudre 3 instances, appeler `container.dispose()` | `dispose()` n'est appele sur AUCUNE des 3 instances TRANSIENT. Les SINGLETON sont disposes normalement. Le container n'a aucune reference vers les instances TRANSIENT |

---

## 3. Integration Test Patterns

### 3.1 Full Bootstrap Test

**Objectif** : Verifier que le framework demarre correctement avec tous les adapters in-memory.

```typescript
describe("Bootstrap", () => {
  it("boot with all in-memory adapters completes 18 steps", async () => {
    const app = await createMantaApp({
      modules: [...],
      adapters: { /* all in-memory */ },
    })
    expect(app.isReady()).toBe(true)
    expect(app.bootSteps).toHaveLength(18)
  })

  it("event buffer released after lazy boot", async () => {
    const spy = spyOnEvents(container)
    // Emit events during core boot — they should be buffered
    emit("early.event", payload)
    await completeLazyBoot()
    // Events now delivered
    expect(spy.received("early.event")).toBe(true)
  })

  it("core boot completes without lazy modules", async () => {
    // Verify core boot completes with only required modules (EVENT_BUS, CACHE)
    // Performance (< 50ms) is a guideline, NOT a contract — tested separately via `manta bench`
    const app = await createMantaApp({ /* minimal config */ })
    expect(app.isReady()).toBe(true)
    expect(app.container.resolve("EVENT_BUS")).toBeDefined()
    expect(app.container.resolve("CACHE")).toBeDefined()
  })

  it("lazy boot timeout returns 503", async () => {
    // Configure lazy boot to exceed 30s timeout
    const response = await sendRequest("/api/lazy-endpoint")
    expect(response.status).toBe(503)
  })
})
```

### 3.2 Workflow End-to-End

**Objectif** : Verifier qu'un workflow complet fonctionne avec checkpoints, compensation, et events groupes.

```typescript
describe("Workflow E2E", () => {
  it("3-step workflow with checkpoints", async () => {
    const workflow = createWorkflow("test-wf", {
      steps: [stepA, stepB, stepC],
    })
    const result = await engine.run(workflow, { input: "data" })
    expect(result.status).toBe("success")
    expect(result.output).toEqual(expectedOutput)
    // Verify checkpoints exist
    const checkpoints = await storage.load("test-wf")
    expect(Object.keys(checkpoints)).toEqual(["stepA", "stepB", "stepC"])
  })

  it("failure triggers compensation in reverse order", async () => {
    const compensationOrder: string[] = []
    // stepC configured to fail
    await engine.run(workflow, { input: "data" })
    expect(compensationOrder).toEqual(["stepB", "stepA"])
  })

  it("grouped events released on success, cleared on failure", async () => {
    const spy = spyOnEvents(container)
    // Success case
    await engine.run(successWorkflow, {})
    expect(spy.received("order.created")).toBe(true)
    // Failure case
    spy.reset()
    await engine.run(failWorkflow, {})
    expect(spy.received("order.created")).toBe(false)
  })
})
```

### 3.3 HTTP Request Lifecycle

**Objectif** : Verifier le cycle de vie complet d'une requete HTTP a travers le pipeline.

```typescript
describe("HTTP Lifecycle", () => {
  it("full pipeline execution", async () => {
    const response = await sendRequest("POST /api/orders", {
      headers: { Authorization: "Bearer valid-jwt" },
      body: { items: [{ sku: "ABC", qty: 1 }] },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("X-Request-Id")).toBeTruthy()
  })

  it("scoped container created per request", async () => {
    let scopeId1: string, scopeId2: string
    // Route handler captures scope id (IContainer.id — SPEC-001)
    registerRoute("GET /test", (req, ctx) => {
      return new Response(ctx.container.id)
    })
    const [r1, r2] = await Promise.all([
      sendRequest("GET /test"),
      sendRequest("GET /test"),
    ])
    expect(await r1.text()).not.toBe(await r2.text())
  })

  it("auth context propagated to handler", async () => {
    registerRoute("GET /me", (req, ctx) => {
      return Response.json({ userId: ctx.auth.userId })
    })
    const response = await sendRequest("GET /me", {
      headers: { Authorization: "Bearer valid-jwt" },
    })
    expect(await response.json()).toEqual({ userId: "u1" })
  })

  it("MantaError caught by error handler", async () => {
    registerRoute("GET /fail", () => {
      throw new MantaError("NOT_FOUND", "Order not found")
    })
    const response = await sendRequest("GET /fail")
    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.type).toBe("NOT_FOUND")
    expect(body.message).toBe("Order not found")
  })
})
```

### 3.4 Module Lifecycle

**Objectif** : Verifier le cycle de vie des modules (chargement, hooks, desactivation, hot-reload).

```typescript
describe("Module Lifecycle", () => {
  it("onApplicationStart called on boot", async () => {
    const startSpy = vi.fn()
    const testModule = defineModule({
      name: "test-module",
      onApplicationStart: startSpy,
    })
    await createMantaApp({ modules: [testModule] })
    expect(startSpy).toHaveBeenCalledOnce()
  })

  it("disabled module is not loaded", async () => {
    const app = await createMantaApp({
      modules: [{ module: testModule, enabled: false }],
    })
    expect(() => app.container.resolve("testModuleService")).toThrow()
  })

  it("hot-reload re-registers module in dev", async () => {
    const app = await createMantaApp({ env: "dev", modules: [testModule] })
    const v1 = app.container.resolve("testModuleService")
    await app.hotReload("test-module")
    const v2 = app.container.resolve("testModuleService")
    expect(v1).not.toBe(v2) // Nouvelle instance
  })
})
```

### 3.5 AuthContext Propagation E2E

**Objectif** : Verifier que l'AuthContext survit a N niveaux de subscribers en cascade (SPEC-049 chemin complet).

```typescript
describe("AuthContext Propagation", () => {
  it("propagates auth_context through subscriber cascade", async () => {
    const spy = spyOnEvents(container)
    const originalAuth = { actor_type: "user", actor_id: "u1" }

    // subscriber A ecoute "order.created" et emet "inventory.reserved"
    // subscriber B ecoute "inventory.reserved" et emet "notification.sent"
    registerSubscriber("order.created", async (event) => {
      // L'AuthContext du trigger original est dans metadata
      expect(event.metadata.auth_context).toEqual(originalAuth)
      await inventoryService.reserve(event.data, event.metadata)
    })
    registerSubscriber("inventory.reserved", async (event) => {
      expect(event.metadata.auth_context).toEqual(originalAuth)
      await notificationService.send(event.data, event.metadata)
    })

    // Trigger depuis un handler HTTP avec auth
    await withScope(container, async (scope) => {
      scope.register("AUTH_CONTEXT", originalAuth, SCOPED)
      await orderService.create({ items: [...] })
    })

    // Verifier cascade : les 3 events portent le meme auth_context
    expect(spy.payloads("order.created")[0].metadata.auth_context).toEqual(originalAuth)
    expect(spy.payloads("inventory.reserved")[0].metadata.auth_context).toEqual(originalAuth)
    expect(spy.payloads("notification.sent")[0].metadata.auth_context).toEqual(originalAuth)
  })

  it("subscriber without auth_context in event does not crash", async () => {
    // Event emis sans metadata.auth_context (ex: event systeme)
    await eventBus.emit("system.tick", { ts: Date.now() })
    // Le subscriber recoit metadata.auth_context = undefined, pas un crash
  })

  it("cron job propagates system AuthContext through cascade", async () => {
    const spy = spyOnEvents(container)
    // Simuler un job cron qui emet un event
    await withScope(container, async (scope) => {
      scope.register("AUTH_CONTEXT", { actor_type: "system", actor_id: "cron" }, SCOPED)
      await cleanupService.run()
    })
    expect(spy.payloads("cleanup.completed")[0].metadata.auth_context)
      .toEqual({ actor_type: "system", actor_id: "cron" })
  })
})
```

### 3.6 Query.graph() External Module Timeout

**Objectif** : Verifier que Query.graph() timeout correctement sur un module externe lent.

```typescript
describe("Query.graph() External Module", () => {
  it("timeout after configured delay", async () => {
    // Module externe simule avec un delai de 6s (timeout = 5s)
    const slowModule = createMockExternalModule({
      name: "inventory",
      delay: 6000,
      timeout: 5000,
    })
    const app = await createMantaApp({ modules: [productModule, slowModule] })

    await expect(
      app.query.graph({
        entity: "product",
        fields: ["title", "inventory_items.*"],
      })
    ).rejects.toThrow(MantaError)
    // Verify error type
    try {
      await app.query.graph({ entity: "product", fields: ["inventory_items.*"] })
    } catch (e) {
      expect(e.type).toBe("UNEXPECTED_STATE")
      expect(e.message).toContain("timed out after 5000ms")
    }
  })

  it("fast module returns normally", async () => {
    const fastModule = createMockExternalModule({
      name: "inventory",
      delay: 50,
      timeout: 5000,
    })
    const app = await createMantaApp({ modules: [productModule, fastModule] })
    const result = await app.query.graph({
      entity: "product",
      fields: ["title", "inventory_items.*"],
    })
    expect(result.data).toBeDefined()
  })
})
```

### 3.7 defineLink Tree-Shaking

**Objectif** : Verifier que les liens dans `src/links/` sont decouverts apres build, et que les liens hors de `src/links/` en strict mode levent une erreur.

```typescript
describe("defineLink Discovery", () => {
  it("links in src/links/ are discovered after build", async () => {
    // Setup : projet avec src/links/product-collection.ts contenant defineLink()
    const manifest = await buildManifest(projectFixture)
    expect(manifest.links).toContain("src/links/product-collection.ts")

    const app = await createMantaApp({ manifest })
    // Le link est actif — on peut creer une relation
    await app.link.create("product", "p1", "collection", "c1")
    const linked = await app.query.graph({
      entity: "product",
      fields: ["collections.*"],
      filters: { id: "p1" },
    })
    expect(linked.data[0].collections).toHaveLength(1)
  })

  it("links outside src/links/ in strict mode throws at boot", async () => {
    // Setup : defineLink() dans src/services/product.ts (wrong location)
    await expect(
      createMantaApp({ strict: true, ...projectFixtureWithMisplacedLink })
    ).rejects.toThrow(MantaError)
  })

  it("plugin link declared in definePlugin() but file missing throws at build", async () => {
    // PL-04 : definePlugin({ links: ["./links/product-collection.ts"] }) mais le fichier n'existe pas
    const plugin = definePlugin({
      name: "test-plugin",
      links: ["./links/nonexistent.ts"],
    })
    await expect(
      buildManifest({ plugins: [plugin] })
    ).rejects.toThrow(MantaError) // MantaError(NOT_FOUND, 'Plugin link file not found: ...')
  })

  it("plugin link present in src/links/ but NOT declared in definePlugin() is ignored in production", async () => {
    // PL-05 : fichier src/links/undeclared.ts existe dans le plugin, mais n'est PAS dans definePlugin({ links: [...] })
    const plugin = definePlugin({
      name: "test-plugin",
      links: [], // intentionnellement vide
    })
    // Le fichier src/links/undeclared.ts est present dans le plugin package
    const manifest = await buildManifest({ plugins: [plugin] })
    expect(manifest.links).not.toContain("test-plugin/src/links/undeclared.ts")
    // Le link n'est PAS decouvert — definePlugin() est la source de verite en production
  })
})
```

### 3.8 Entity Counting Threshold

**Objectif** : Verifier le comptage iteratif des entites et le seuil dur (10000).

```typescript
describe("Query.graph() Entity Threshold", () => {
  it("counts root + nested entities iteratively", async () => {
    // 100 products x 50 variants = 5100 total
    const app = await createMantaApp({ query: { maxTotalEntities: 10000 } })
    // Should succeed (5100 < 10000)
    const result = await app.query.graph({
      entity: "product",
      fields: ["variants.*"],
    })
    expect(result.data).toHaveLength(100)
  })

  it("throws when threshold exceeded", async () => {
    // Configure low threshold for test
    const app = await createMantaApp({ query: { maxTotalEntities: 500 } })
    // 100 products x 50 variants = 5100 > 500
    await expect(
      app.query.graph({ entity: "product", fields: ["variants.*"] })
    ).rejects.toThrow(/exceeding the maximum of 500/)
  })

  it("stops before resolving next level", async () => {
    // 100 products ok, but + 50 variants each would exceed
    const resolveSpy = vi.fn()
    // Verify that "options" relation is NOT resolved if variants already exceed
    const app = await createMantaApp({ query: { maxTotalEntities: 500 } })
    await expect(
      app.query.graph({ entity: "product", fields: ["variants.*", "variants.options.*"] })
    ).rejects.toThrow()
    // options should not have been queried (fail-fast after variants)
  })
})
```

### 3.9 withDeleted + External Module Propagation

**Objectif** : Verifier que `withDeleted: true` est propage aux modules externes et que le comportement est correct meme si le module externe ignore le flag.

```typescript
describe("Query.graph() withDeleted + External Module", () => {
  it("propagates withDeleted to external module via HTTP body", async () => {
    const requestSpy = vi.fn()
    const externalModule = createMockExternalModule({
      name: "inventory",
      onRequest: (body) => {
        requestSpy(body)
        return { data: [{ id: "inv1", quantity: 10 }] }
      },
    })
    const app = await createMantaApp({ modules: [productModule, externalModule] })

    await app.query.graph({
      entity: "product",
      fields: ["inventory_items.*"],
      withDeleted: true,
    })

    // Verify the flag was sent in the HTTP request body
    expect(requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({ withDeleted: true })
    )
  })

  it("handles external module ignoring withDeleted gracefully", async () => {
    // External module ignores withDeleted — returns only active entities
    const externalModule = createMockExternalModule({
      name: "inventory",
      onRequest: (_body) => {
        // Ignores withDeleted, returns only active
        return { data: [{ id: "inv1", quantity: 10 }] }
      },
    })
    const app = await createMantaApp({ modules: [productModule, externalModule] })

    // Should NOT throw — the external module's response is accepted as-is
    const result = await app.query.graph({
      entity: "product",
      fields: ["inventory_items.*"],
      withDeleted: true,
    })
    expect(result.data).toBeDefined()
    // No error, no warning — the framework trusts the external module's response
  })
})
```

### 3.10 Query.graph() beforeFetch Hook (Circuit Breaker)

**Objectif** : Verifier que `remoteJoiner.beforeFetch(module, query)` fonctionne comme point d'extension pour le circuit breaker.

```typescript
describe("Query.graph() beforeFetch Hook", () => {
  it("hook returns result → short-circuit (skip fetch)", async () => {
    const cachedResult = [{ id: "inv1", quantity: 99 }]
    const fetchSpy = vi.fn()
    const app = await createMantaApp({
      modules: [productModule, inventoryModule],
      remoteJoiner: {
        beforeFetch: (module, query) => {
          if (module === "inventory") return cachedResult
          return null // normal fetch
        },
      },
    })
    // Spy on actual inventory module fetch
    inventoryModule.onFetch = fetchSpy

    const result = await app.query.graph({
      entity: "product",
      fields: ["inventory_items.*"],
    })
    // Inventory data comes from cache, not from module
    expect(result.data[0].inventory_items[0].quantity).toBe(99)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("hook returns null → normal fetch proceeds", async () => {
    const fetchSpy = vi.fn(() => [{ id: "inv1", quantity: 10 }])
    const app = await createMantaApp({
      modules: [productModule, inventoryModule],
      remoteJoiner: {
        beforeFetch: () => null, // no short-circuit
      },
    })
    inventoryModule.onFetch = fetchSpy

    await app.query.graph({
      entity: "product",
      fields: ["inventory_items.*"],
    })
    expect(fetchSpy).toHaveBeenCalled()
  })

  it("hook throws → error propagated as MantaError", async () => {
    const app = await createMantaApp({
      modules: [productModule, inventoryModule],
      remoteJoiner: {
        beforeFetch: (module) => {
          if (module === "inventory") {
            throw new MantaError("UNEXPECTED_STATE", "Circuit breaker open for inventory")
          }
          return null
        },
      },
    })

    await expect(
      app.query.graph({ entity: "product", fields: ["inventory_items.*"] })
    ).rejects.toThrow("Circuit breaker open for inventory")
  })
})
```

### 3.11 Bootstrap onApplicationStart + Events

**Objectif** : Verifier que les events emis dans `onApplicationStart` sont bufferises et releasees correctement, et que les erreurs dans les hooks n'empechent pas les autres modules de demarrer.

```typescript
describe("Bootstrap onApplicationStart Events", () => {
  it("events emitted in onApplicationStart are buffered and released", async () => {
    const spy = spyOnEvents()
    const testModule = createTestModule({
      onApplicationStart: async (container) => {
        const eventBus = container.resolve("IEventBusPort")
        await eventBus.emit("test.module.started", { ts: Date.now() })
      },
    })

    const app = await createMantaApp({ modules: [testModule] })
    // After boot completes, the buffered event should have been released
    expect(spy.received("test.module.started")).toBe(true)
  })

  it("hook error does not block other modules", async () => {
    const spy = spyOnEvents()
    const failingModule = createTestModule({
      name: "failing",
      onApplicationStart: async () => { throw new Error("hook failed") },
    })
    const healthyModule = createTestModule({
      name: "healthy",
      onApplicationStart: async (container) => {
        const eventBus = container.resolve("IEventBusPort")
        await eventBus.emit("healthy.started", { ts: Date.now() })
      },
    })

    const app = await createMantaApp({ modules: [failingModule, healthyModule] })
    // Healthy module's event was still emitted
    expect(spy.received("healthy.started")).toBe(true)
    // Failing module is DEGRADED
    expect(app.container.resolve("MODULE_STATE").get("failing")).toBe("DEGRADED")
  })

  it("events from throwing hook are cleared", async () => {
    const spy = spyOnEvents()
    const module = createTestModule({
      onApplicationStart: async (container) => {
        const scope = container.createScope()
        const ma = scope.resolve("IMessageAggregator")
        ma.save([{ eventName: "should.not.appear", data: {}, metadata: { timestamp: Date.now() } }])
        throw new Error("hook failed after save")
      },
    })

    const app = await createMantaApp({ modules: [module] })
    // Event was cleared due to error — never released
    expect(spy.received("should.not.appear")).toBe(false)
  })
})
```

### 3.12 Module Loader Idempotence (reloadSingleModule)

**Objectif** : Verifier que `reloadSingleModule()` n'introduit pas de doublons quand les loaders sont re-executes.

```typescript
describe("Module Loader Idempotence", () => {
  it("ML-01: reloadSingleModule 2x does not create duplicate seed data", async () => {
    const testModule = defineModule({
      name: "test-module",
      loaders: [async (container) => {
        const repo = container.resolve("testRepo")
        // Loader DOIT etre idempotent : INSERT ON CONFLICT DO NOTHING
        await repo.upsertWithReplace([
          { id: "seed-1", name: "Seed Item" },
        ])
      }],
    })
    const app = await createMantaApp({ modules: [testModule] })

    // First load: 1 entity
    let items = await app.container.resolve("testRepo").find()
    expect(items).toHaveLength(1)

    // Reload: still 1 entity (not 2)
    await app.reloadSingleModule("test-module")
    items = await app.container.resolve("testRepo").find()
    expect(items).toHaveLength(1)
  })
})
```

### 3.13 Query.gql() Removed — Explicit Error

**Objectif** : Verifier que `Query.gql()` leve une erreur explicite (pas `undefined is not a function`).

```typescript
describe("Query.gql() Removed", () => {
  it("QG-01: calling gql() throws NOT_IMPLEMENTED", async () => {
    const app = await createMantaApp({ modules: [productModule] })
    expect(() => (app.query as any).gql("{ products { id } }"))
      .toThrow(MantaError)
    try {
      ;(app.query as any).gql("{ products { id } }")
    } catch (e) {
      expect(e.type).toBe("NOT_IMPLEMENTED")
      expect(e.message).toContain("Query.graph()")
    }
  })
})
```

---

## 4. @manta/testing API

### 4.1 createTestContainer

```typescript
import { createTestContainer } from '@manta/testing'

const container = createTestContainer({
  // Tous les adapters in-memory par defaut
  // Override specifiques :
  overrides: {
    cachePort: new CustomCacheForTest(),
  },
})
```

- Cree un container configure avec des adapters in-memory pour TOUS les ports
- Les overrides permettent de remplacer un adapter specifique
- Le container est pret a l'emploi — pas de boot necessaire
- Chaque appel retourne un container isole (pas de state partage entre tests)

### 4.2 withScope

```typescript
import { withScope } from '@manta/testing'

await withScope(container, async (scopedContainer) => {
  const service = scopedContainer.resolve("orderService")
  // Service resolu dans un scope actif (AsyncLocalStorage)
  // Les services SCOPED fonctionnent correctement ici
})
// Scope automatiquement desactive a la fin (PAS dispose)
```

- Execute une fonction dans un scoped context via `asyncLocalStorage.run()`
- Les services SCOPED sont resolvables sans erreur dans le callback
- A la fin du callback, le scope est **desactive** (ALS store = undefined) — PAS `dispose()`. Le scoped container est eligible au GC. `dispose()` n'est JAMAIS appele par `withScope` — il n'y a rien a disposer (les SCOPED sont des instances legeres, les SINGLETON sont partages avec le parent)
- Equivalent du scope cree par une requete HTTP, mais pour les tests

### 4.3 createTestLogger

```typescript
import { createTestLogger } from '@manta/testing'

const logger = createTestLogger()
logger.info("test message", { key: "value" })

expect(logger.logs).toEqual([
  { level: "info", msg: "test message", data: { key: "value" } },
])
logger.clear()
```

- Logger silencieux (pas d'output console)
- Capture tous les logs dans `logger.logs` pour assertions
- Methode `clear()` pour reset entre tests
- Implemente `ILoggerPort` completement

### 4.4 createTestAuth

```typescript
import { createTestAuth } from '@manta/testing'

const auth = createTestAuth({
  jwt: { userId: "u1", role: "admin" }, // Tout token valide retourne ce payload
  apiKeys: {
    "sk_test_123": { type: "api_key", userId: "u2" },
  },
  sessions: {
    "sess_abc": { type: "session", userId: "u3" },
  },
})

const result = await auth.verifyJwt("any-token")
// → { userId: "u1", role: "admin" }

const result2 = await auth.verifyApiKey("sk_test_123")
// → { type: "api_key", userId: "u2" }
```

- Mock IAuthPort avec reponses configurables
- JWT : tout token retourne le payload configure (pas de verification cryptographique)
- API Keys : map statique cle → AuthContext
- Sessions : map statique sessionId → AuthContext
- `null` pour toute valeur non configuree

### 4.5 InMemoryWorkflowEngine

```typescript
import { InMemoryWorkflowEngine } from '@manta/testing'

const engine = new InMemoryWorkflowEngine()
const result = await engine.run(workflow, { input: "data" })
```

- Execution synchrone des workflows (pas de queue, pas de persistence)
- Les steps sont executes sequentiellement dans le meme process
- Utile pour les tests unitaires qui veulent tester la logique sans infra
- Compensation fonctionne correctement
- PAS de checkpoint persistence (pour ca, utiliser le vrai engine avec PG)

### 4.6 resetAll

```typescript
import { resetAll } from '@manta/testing'

afterEach(async () => {
  await resetAll(container)
})
```

- Reset tous les adapters in-memory du container
- Cache vide, events vides, locks liberes, logs vides
- A appeler dans `afterEach` pour isolation entre tests
- Ne detruit pas le container — juste l'etat interne

### 4.7 createTestDb

```typescript
import { createTestDb } from '@manta/testing'

const db = await createTestDb({
  schema: [usersTable, ordersTable],
})

// Chaque test dans une transaction rollback
await db.withRollback(async (tx) => {
  await tx.insert(usersTable).values({ name: "test" })
  const users = await tx.select().from(usersTable)
  expect(users).toHaveLength(1)
})
// Rollback automatique — la table est vide apres
```

- Cree une base de donnees PG de test (necessite PG local)
- Schema applique automatiquement (migrations Drizzle)
- `withRollback()` : chaque test tourne dans une transaction qui est rollback a la fin
- Zero cleanup necessaire — la base est toujours propre
- Profile `integration` requis (PG local obligatoire)

### 4.8 spyOnEvents

```typescript
import { spyOnEvents } from '@manta/testing'

const spy = spyOnEvents(container)

await orderService.create({ items: [...] })

expect(spy.received("order.created")).toBe(true)
expect(spy.payloads("order.created")).toEqual([
  { orderId: "o1", items: [...] },
])
expect(spy.count("order.created")).toBe(1)

spy.reset()
```

- Intercepte tous les events emis via IEventBusPort
- `received(eventName)` : boolean, l'event a ete emis
- `payloads(eventName)` : array de tous les payloads emis pour cet event
- `count(eventName)` : nombre d'emissions
- `all()` : array de tous les events emis `[{ name, payload, timestamp }]`
- `reset()` : vide l'historique
- Non-intrusif : les vrais subscribers recoivent aussi les events

### 4.9 createTestContext

```typescript
import { createTestContext } from '@manta/testing'

const ctx = createTestContext({
  auth_context: { actor_type: 'user', actor_id: 'u1' },
  // Tout le reste est optionnel avec des defauts raisonnables
})

// ctx.transactionManager = undefined (pas de transaction)
// ctx.manager = mock no-op (queries retournent [])
// ctx.eventGroupId = undefined
// ctx.idempotencyKey = auto-generated UUID
// ctx.messageAggregator = InMemoryMessageAggregator (vide)
// ctx.auth_context = ce que tu as passe

await myService.createProduct(ctx, { title: "Test" })
```

- Cree un Context (SPEC-060) minimal valide pour les tests
- Evite de construire manuellement tous les champs du Context
- Le dev ne setter que les champs pertinents pour son test
- Compatible avec `@Ctx()` decorator

### 4.10 assertNoScopeLeak

```typescript
import { assertNoScopeLeak } from '@manta/testing'

// Verifie que la creation de N scopes ne cause pas de fuite memoire
await assertNoScopeLeak(container, 1000)
// Cree 1000 scopes, enregistre des services SCOPED, laisse les scopes se terminer
// Verifie que heap usage apres 1000 ≈ heap usage apres 10 (tolerance +20%)
```

- Detecte les fuites de scoped containers (captures implicites par SINGLETON)
- A inclure dans les tests d'integration pour chaque adapter custom
- Profile `integration` recommande (heap mesure via `process.memoryUsage()`)

---

## 5. Test Naming Convention

### Adapter Conformance

Format : `[PortName] > [methode] > [scenario]`

```
ICachePort > set/get > returns null after TTL expiration
ICachePort > invalidate > pattern glob removes matching keys
IEventBusPort > grouped > release delivers all held events
ILockingPort > execute > mutual exclusion serializes concurrent calls
IDatabasePort > dbErrorMapper > PG 23505 maps to DUPLICATE_ERROR
IContainer > SCOPED > different instance per scope
```

### Integration Tests

Format : `[Feature] > [scenario]`

```
Bootstrap > completes 18 steps with in-memory adapters
Bootstrap > cold start under 50ms target
Workflow E2E > failure triggers compensation in reverse order
HTTP Lifecycle > scoped container created per request
Module Lifecycle > hot-reload re-registers module in dev
```

### Tests Metier (dans les modules)

Format : `[Module] > [use case] > [scenario]`

```
OrderModule > create order > emits order.created event
OrderModule > create order > fails with empty items
ProductModule > search > delegates to ISearchProvider
```

---

## 6. Test Profiles

### `unit` — Pas de dependance externe

- **Quand** : `npm test` (defaut), CI a chaque push
- **Infra** : Tout in-memory via `createTestContainer()`
- **PG** : Non requis
- **Duree cible** : < 10s pour toute la suite
- **Ce qu'on teste** :
  - Logique metier des modules
  - Logique des workflows (via InMemoryWorkflowEngine)
  - Validation Zod
  - Mapping et transformations
  - Error handling
- **Ce qu'on ne teste PAS** :
  - SQL reel
  - Comportement reseau
  - Timeouts reels (utiliser fake timers)

### `integration` — PG local requis, le reste in-memory

- **Quand** : `npm test:integration`, CI avant merge
- **Infra** : PG local (via Docker ou installation locale), reste in-memory
- **PG** : Obligatoire — `createTestDb()` cree les tables
- **Duree cible** : < 60s pour toute la suite
- **Ce qu'on teste** :
  - Adapter Conformance Suites (IDatabasePort, IRepository, IWorkflowStoragePort)
  - Queries SQL reelles via Drizzle
  - Transactions, isolation levels, savepoints
  - dbErrorMapper avec de vrais codes PG
  - Schema migrations (up/down)
  - Full bootstrap avec PG
- **Ce qu'on ne teste PAS** :
  - Services externes (Upstash, Vercel, etc.)
  - Deploiement

### `e2e` — Full Vercel stack (CI/CD only)

- **Quand** : `npm test:e2e`, CI avant release uniquement
- **Infra** : Full stack Vercel (Neon, Upstash, Vercel Blob, Vercel Queues, Vercel Cron)
- **PG** : Neon (base de staging)
- **Duree cible** : < 5min
- **Ce qu'on teste** :
  - Deploy reel sur Vercel preview
  - Cold start reel
  - Full HTTP lifecycle via URL publique
  - Events via Vercel Queues (delivery reelle)
  - File upload via Vercel Blob
  - Cron jobs via Vercel Cron (trigger manuel)
  - Auth flow complet (JWT creation, verification, session)
- **Ce qu'on ne teste PAS** :
  - Edge cases deja couverts par unit/integration
  - Performance benchmarks (outil separe)
- **Precautions** :
  - Base de staging isolee (pas de donnees de prod)
  - Cleanup automatique apres chaque run
  - Secrets dans les variables d'environnement CI (jamais en dur)

---

## 7. Execution des Conformance Suites par adapter

Chaque adapter du ADAPTERS_CATALOG.md doit passer sa Conformance Suite. Voici la matrice :

| Port | Adapter | Profile | Suite |
|------|---------|---------|-------|
| ICachePort | InMemoryCacheAdapter | `unit` | C-01 → C-09 |
| ICachePort | UpstashCacheAdapter | `e2e` | C-01 → C-09 |
| IEventBusPort | InMemoryEventBus | `unit` | E-01 → E-14 |
| IEventBusPort | VercelQueueAdapter | `e2e` | E-01 → E-14 |
| ILockingPort | InMemoryLockingAdapter | `unit` | L-01 → L-07 |
| ILockingPort | NeonAdvisoryLockAdapter | `integration` | L-01 → L-07 |
| IDatabasePort | DrizzlePgAdapter (local) | `integration` | D-01 → D-14 |
| IDatabasePort | DrizzleNeonAdapter | `e2e` | D-01 → D-14 |
| IRepository | DrizzleRepository | `integration` | R-01 → R-19 |
| IWorkflowEnginePort | InMemoryWorkflowEngine | `unit` | W-01 → W-13 |
| IWorkflowEnginePort | PgWorkflowEngine | `integration` | W-01 → W-13 |
| IWorkflowStoragePort | InMemoryWorkflowStorage | `unit` | WS-01 → WS-11 |
| IWorkflowStoragePort | PgWorkflowStorage | `integration` | WS-01 → WS-11 |
| IJobSchedulerPort | NodeCronAdapter | `unit` | J-01 → J-10 |
| IJobSchedulerPort | VercelCronAdapter | `e2e` | J-01 → J-10 |
| IFilePort | LocalFilesystemAdapter | `unit` | F-01 → F-08 |
| IFilePort | VercelBlobAdapter | `e2e` | F-01 → F-08 |
| ILoggerPort | PinoAdapter | `unit` | LG-01 → LG-08 |
| IAuthPort | JwtAuthAdapter | `unit` | A-01 → A-09 |
| IAuthModuleService | SessionService | `unit` | AS-01 → AS-05 |
| IAuthGateway | AuthGateway | `unit` | AG-01 → AG-11 |
| IHttpPort | NitroAdapter | `integration` | H-01 → H-28 |
| INotificationPort | ConsoleNotificationAdapter | `unit` | N-01 → N-07 |
| ITranslationPort | PgTranslationAdapter | `integration` | T-01 → T-11 |
| IContainer | AwilixContainerAdapter | `unit` | CT-01 → CT-18 |
| IJobSchedulerPort (cron auth) | Any adapter | `unit` | J-10 |

| CLI db:* | MigrationTestContext | `integration` | M-01 → M-16 |
| DML Generator | generateDrizzleSchema | `unit` | DG-01 → DG-20 |
| IMessageAggregator | InMemoryMessageAggregator | `unit` | MA-01 → MA-08 |
| Strict mode | All adapters | `unit` + `integration` | SM-01 → SM-06 |

**Total** : 27 adapter/profile combinaisons, 258 tests de conformite (253 + E-14, R-18, R-19, PL-04, PL-05).

---

## 8. Regles pour les developpeurs

1. **Tout nouveau port DOIT avoir sa Conformance Suite** avant d'etre merge. Pas de port sans tests.
2. **Tout nouvel adapter DOIT passer la suite existante**. Si un test ne passe pas, c'est l'adapter qui a un bug — pas la suite.
3. **Les tests metier utilisent `createTestContainer()`**. Jamais d'import direct d'un adapter dans un test metier.
4. **Les fake timers sont obligatoires** pour les tests de TTL en profile `unit`. Pas de `setTimeout` reel.
5. **`afterEach(() => resetAll(container))`** dans chaque fichier de test qui utilise un container.
6. **Les tests d'integration utilisent `createTestDb()` avec `withRollback()`**. Pas de cleanup manuel.
7. **Les tests e2e sont idempotents** — relancer 2x donne le meme resultat. Pas de dependance a l'ordre d'execution.
8. **Les Conformance Suites sont immutables** une fois publiees dans une version majeure. Ajouter des tests = OK. Modifier/supprimer = breaking change.

---

## 9. Tests de Migration (CLI db:*)

### 9.1 Strategie

Les commandes `manta db:generate`, `manta db:migrate`, `manta db:diff` et `manta db:rollback` touchent au schema de production. Elles DOIVENT avoir leur propre suite de tests.

**Infrastructure** : chaque test de migration utilise `createTestDb()` avec une DB ephemere PG locale. Le workflow complet CLI est simule via les fonctions internes du framework (pas de spawn de process CLI).

### 9.2 Migration Conformance Suite

| # | Test | Description | Assertion |
|---|------|-------------|-----------|
| M-01 | `db:generate > schema from DML` | Definir un DML avec 3 entites, executer le generateur | Fichier SQL de migration genere, contient CREATE TABLE pour les 3 entites + colonnes implicites |
| M-02 | `db:migrate > apply migration` | Generer migration, puis appliquer | Tables presentes en DB (`information_schema.tables`) |
| M-03 | `db:migrate > idempotent` | Appliquer la meme migration 2x | Pas d'erreur (migration deja tracee dans `migrations` table) |
| M-04 | `db:diff > detect missing column` | Ajouter un champ au DML sans re-generer, executer db:diff | Rapport contient `{ table: "products", column: "new_field", action: "CREATE" }` |
| M-05 | `db:diff > detect extra column` | Ajouter une colonne manuellement en DB, executer db:diff | Rapport contient `{ table: "products", column: "extra_col", action: "NOTIFY" }` |
| M-06 | `db:diff > detect type change` | Changer un `text` en `integer` dans le DML, executer db:diff | Rapport contient `{ action: "NOTIFY", warning: "unsafe ALTER COLUMN" }` |
| M-07 | `db:diff > clean schema = no diff` | DML et DB en sync | Rapport vide (pas de differences) |
| M-08 | `db:rollback > reverse migration` | Appliquer migration, ecrire fichier de rollback SQL, executer rollback | Tables supprimees, migration retiree du tracking |
| M-09 | `db:rollback > missing rollback file` | Tenter rollback sans fichier de rollback | `MantaError(NOT_FOUND, 'Rollback file not found for migration ...')` |
| M-10 | `db:generate > shadow columns bigNumber` | DML avec `model.bigNumber("price")` | Migration contient `raw_price JSONB` en plus de `price NUMERIC` |
| M-11 | `db:generate > implicit columns present` | DML basique | Migration contient `created_at`, `updated_at`, `deleted_at` |
| M-12 | `db:migrate > locking prevents concurrent` | Lancer 2 migrations en parallele | Une seule s'execute, l'autre attend ou echoue avec lock timeout |
| M-13 | `db:diff > detect missing trigger` | Creer table avec `updated_at` mais supprimer le trigger manuellement, executer db:diff | Rapport contient `{ table: "products", trigger: "set_updated_at", action: "NOTIFY", warning: "Trigger missing..." }` |
| M-14 | `db:diff > trigger present = no diff` | Table avec trigger `set_updated_at` en place | Pas de ligne trigger dans le rapport |
| M-15 | `db:diff > detect missing table` | DML avec entite `products`, DB sans la table `products` | Rapport contient `{ table: "products", action: "CREATE", columns: [...] }` — safe, migration en attente |
| M-16 | `db:diff > detect extra table` | Table `legacy_table` en DB mais pas dans le DML | Rapport contient `{ table: "legacy_table", action: "NOTIFY" }` — le framework ne drop jamais une table qu'il n'a pas creee |

### 9.3 Helpers @manta/testing pour les migrations

```typescript
import { createMigrationTestContext } from '@manta/testing'

const ctx = await createMigrationTestContext({
  // Cree une DB ephemere PG, configure le generateur DML et le migrator
})

// Definir un DML
ctx.defineDml([
  model.define("Product", { title: model.text(), price: model.bigNumber() })
])

// Generer la migration
const migration = await ctx.generate()
expect(migration.sql).toContain("CREATE TABLE")

// Appliquer
await ctx.migrate()

// Verifier
const diff = await ctx.diff()
expect(diff.differences).toHaveLength(0)

// Cleanup automatique a la fin du test
await ctx.cleanup()
```

- `createMigrationTestContext()` : cree une DB ephemere, configure le generateur et le migrator
- `ctx.generate()` : execute le pipeline DML → Drizzle → drizzle-kit generate
- `ctx.migrate()` : applique les migrations
- `ctx.diff()` : execute db:diff et retourne le rapport structure
- `ctx.rollback()` : execute le rollback
- `ctx.cleanup()` : supprime la DB ephemere
- Profile `integration` requis (PG local obligatoire)

---

## 9b. DML Generator Conformance Suite

### 9b.1 Strategie

Le generateur DML → Drizzle (SPEC-057f) est le composant le plus critique du framework. Il est deterministe et testable sans DB (pure transformation en memoire). Ces tests sont du pur test unitaire (profile `unit`).

### 9b.2 DML Generator Conformance Suite

| # | Test | Description | Assertion |
|---|------|-------------|-----------|
| DG-01 | `bigNumber > shadow column` | `model.bigNumber("price")` | Schema Drizzle contient `price` (NUMERIC) ET `raw_price` (JSONB) |
| DG-02 | `bigNumber > shadow conflict` | `model.bigNumber("price")` + `model.json("raw_price")` explicite | `MantaError(INVALID_DATA, 'Column raw_price conflicts with bigNumber shadow column')` |
| DG-03 | `enum > array literal` | `model.enum(['draft', 'published'])` | CHECK constraint `(status IN ('draft','published'))` |
| DG-04 | `enum > TypeScript enum string` | `enum Status { DRAFT = 'draft', PUBLISHED = 'published' }`, `model.enum(Status)` | CHECK constraint sur les valeurs string |
| DG-05 | `enum > TypeScript enum numerique` | `enum Flags { A = 0, B = 1 }`, `model.enum(Flags)` | Warning leve. CHECK constraint sur `["A", "B"]` (noms, pas valeurs) |
| DG-06 | `computed > pas de colonne` | `model.text("fullName").computed()` | Le champ n'est PAS dans le schema Drizzle (aucune colonne generee). Le type TypeScript inclut `fullName?: string` |
| DG-07 | `implicit > created_at present` | DML basique sans declaration explicite | Schema contient `created_at` TIMESTAMPTZ NOT NULL DEFAULT NOW() |
| DG-08 | `implicit > redeclaration interdite` | `model.dateTime("created_at")` dans le DML | `MantaError(INVALID_DATA, 'Property created_at is implicit and cannot be redefined')` |
| DG-09 | `implicit > updated_at present` | DML basique | Schema contient `updated_at` TIMESTAMPTZ NOT NULL |
| DG-10 | `implicit > deleted_at present` | DML basique | Schema contient `deleted_at` TIMESTAMPTZ nullable |
| DG-11 | `index partial > QueryCondition serialisation` | `.indexes([{ on: ['qty'], where: { qty: { $gt: 0 } } }])` | Index genere avec `WHERE qty > 0` |
| DG-12 | `index partial > $in operator` | `.indexes([{ on: ['status'], where: { status: { $in: ['a','b'] } } }])` | Index genere avec `WHERE status IN ('a','b')` |
| DG-13 | `index partial > $ne null` | `.indexes([{ on: ['email'], where: { email: { $ne: null } } }])` | Index genere avec `WHERE email IS NOT NULL` |
| DG-14 | `manyToMany > pivot table` | `model.manyToMany(() => Tag)` sans pivotTable | Table pivot generee avec nom `{tableA}_{tableB}` (ordre alphabetique sur les **noms de tables** snake_case, PAS les noms d'entites PascalCase — ex: `product_categories_tags` et non `ProductCategory_Tag`), colonnes FK + id + timestamps |
| DG-15 | `manyToMany > pivotEntity custom` | `model.manyToMany(() => Tag, { pivotEntity: CustomPivot })` | Table pivot utilise les colonnes du DML CustomPivot + FK obligatoires fusionnees |
| DG-16 | `hasOneWithFK > FK column` | `model.hasOne(() => Address, { foreignKey: true })` | Colonne `address_id` generee sur la table Owner |
| DG-17 | `nullable > not null absent` | `model.text("bio").nullable()` | Colonne sans `.notNull()` |
| DG-18 | `non-nullable > not null present` | `model.text("name")` (sans .nullable()) | Colonne avec `.notNull()` |
| DG-19 | `default > json auto-stringifie` | `model.json("config").default({ theme: "dark" })` | `.default('{"theme":"dark"}')` dans le schema |
| DG-20 | `index GIN > JSONB` | `.indexes([{ on: ['data'], type: 'GIN' }])` | `index().using('gin', table.data)` |
| DG-21 | `index simple > implicit soft-delete filter` | `model.text("email").index()` (index simple, sans `where` explicite) | Index genere avec `WHERE deleted_at IS NULL` implicitement. Verifie que TOUS les index sans `where` explicite incluent le filtre soft-delete par defaut (SPEC-057f). |
| DG-22 | `index composite > implicit soft-delete filter` | `.indexes([{ on: ['status', 'created_at'] }])` (composite, sans `where`) | Index composite genere avec `WHERE deleted_at IS NULL`. Meme regle que DG-21 appliquee aux indexes composites. |
| DG-23 | `index avec where explicite > PAS de soft-delete implicite` | `.indexes([{ on: ['email'], where: 'email IS NOT NULL' }])` | Index genere avec `WHERE email IS NOT NULL` SEULEMENT. Le `deleted_at IS NULL` n'est PAS ajoute car `where` est explicitement specifie — le dev prend le controle. |

### 9b.3 Helper

```typescript
import { parseDmlEntity, generateDrizzleSchema } from '@manta/testing'

// Test unitaire pur — pas de DB necessaire
const dml = model.define("Product", {
  title: model.text(),
  price: model.bigNumber(),
})

const schema = generateDrizzleSchema(dml)
expect(schema.columns).toContainKey("price")
expect(schema.columns).toContainKey("raw_price")
```

---

## 9c. IMessageAggregator Conformance Suite

### 9c.1 Strategie

Le `IMessageAggregator` est SCOPED et accumule les events domaine par requete/workflow step. Une regression ici = events emis en double ou pas du tout.

### 9c.2 IMessageAggregator Conformance Suite

| # | Test | Description | Assertion |
|---|------|-------------|-----------|
| MA-01 | `save/getMessages > roundtrip` | `save([msg1, msg2])` puis `getMessages()` | Retourne `[msg1, msg2]` |
| MA-02 | `save > accumulation` | `save([msg1])` puis `save([msg2])` | `getMessages()` retourne `[msg1, msg2]` |
| MA-03 | `clearMessages > vide tout` | `save([msg1])`, `clearMessages()`, `getMessages()` | Retourne `[]` |
| MA-04 | `getMessages > groupBy` | 3 events de 2 eventNames differents, `getMessages({ groupBy: 'eventName' })` | Retourne un objet groupe par eventName |
| MA-05 | `getMessages > sortBy` | 3 events avec timestamps differents, `getMessages({ sortBy: 'timestamp' })` | Retourne dans l'ordre chronologique |
| MA-06 | `SCOPED > isolation entre scopes` | 2 scopes, chacun fait `save([msg])` | `getMessages()` dans chaque scope ne retourne QUE ses propres messages |
| MA-07 | `interaction @EmitEvents > save apres mutation` | Service avec `@EmitEvents()`, appeler une methode qui emet | `getMessages()` contient l'event emis |
| MA-08 | `interaction @EmitEvents > clear sur erreur` | Service avec `@EmitEvents()`, methode qui throw | `getMessages()` retourne `[]` (clearMessages appele) |

---

## 10. Tests en Strict Mode

### 10.1 Strategie

`defineConfig({ strict: true })` modifie le comportement de plusieurs features (SPEC-007 principe 7). Les tests DOIVENT couvrir les deux modes (normal et strict).

### 10.2 Approche : flag dans la Conformance Suite

Les Conformance Suites ne sont PAS dupliquees. A la place, chaque suite accepte un parametre optionnel `strict: boolean` :

```typescript
runCacheConformance({
  createAdapter: () => new InMemoryCacheAdapter(),
  cleanup: async (adapter) => await adapter.clear(),
  strict: true, // Run in strict mode
})
```

Le runner execute les tests communs (identiques en normal et strict) + les tests specifiques au mode.

### 10.3 Tests specifiques au strict mode

| # | Test | Feature | Normal | Strict |
|---|------|---------|--------|--------|
| SM-01 | Route conflict inter-plugins | SPEC-068 | Warning + last-wins | `MantaError(INVALID_DATA)` at boot |
| SM-02 | `dangerouslyUnboundedRelations` | SPEC-011 | Autorise (warning) | `MantaError(INVALID_DATA)` interdit |
| SM-03 | Seuil dur Query.graph() | SPEC-011 | 10000 entites | 5000 entites |
| SM-04 | Link hors src/links/ | SPEC-012 | Ignore silencieusement | Erreur au boot |
| SM-05 | Auto-discovery filesystem | SPEC-074 | Active (scan dirs) | Desactive (manifeste requis) |
| SM-06 | Event name auto-generation | SPEC-127 | Active | Desactive (declaration explicite requise) |

### 10.4 Pattern d'ecriture

```typescript
describe("Query.graph() strict mode", () => {
  it("rejects dangerouslyUnboundedRelations in strict mode", async () => {
    const app = await createMantaApp({ strict: true })
    await expect(
      app.query.graph({ entity: "product", fields: ["*"] }, { dangerouslyUnboundedRelations: true })
    ).rejects.toThrow(MantaError)
  })

  it("allows dangerouslyUnboundedRelations in normal mode", async () => {
    const app = await createMantaApp({ strict: false })
    // Should not throw
    await app.query.graph({ entity: "product", fields: ["*"] }, { dangerouslyUnboundedRelations: true })
  })
})
```

### 10.5 `dangerouslyUnboundedRelations` et strict mode — exception pour les tests

Le strict mode interdit `dangerouslyUnboundedRelations` en application. Cependant, les tests de migration ou d'export qui ont besoin de charger toutes les donnees peuvent utiliser le **test profile** qui bypass cette restriction :

```typescript
const app = await createMantaApp({
  strict: true,
  testing: { allowUnboundedRelations: true } // Uniquement dans @manta/testing
})
```

`testing.allowUnboundedRelations` est uniquement disponible via `createTestContainer()` et `createMantaApp()` avec le flag `testing`. Il n'est PAS disponible en production. Il leve une erreur si `NODE_ENV === 'production'`.

---

## 11. Plugin Resolution Tests

### 11.1 Strategie

La resolution de plugins ESM/CJS est l'un des points les plus fragiles de l'ecosysteme Node.js. Ces tests verifient que le framework resout correctement les plugins dans les trois cas de figure reels (CJS, ESM, compile). Ils doivent tourner dans le profil `integration` car ils necessitent un filesystem reel avec des `node_modules` simules.

### 11.2 Plugin Resolution Suite

| # | Test | Description | Assertion |
|---|------|-------------|-----------|
| PL-01 | `resolution CJS > monorepo pnpm` | Plugin CJS (`"type": "commonjs"` ou absent dans package.json) dans un monorepo pnpm simule (symlink dans `node_modules`) | `require.resolve(pluginName + '/package.json')` resout vers le bon dossier. Les chemins de discovery (`subscribers`, `jobs`, etc.) sont resolus relativement a la racine du package. |
| PL-02 | `resolution ESM > import.meta.resolve` | Plugin ESM (`"type": "module"` dans package.json) | `import.meta.resolve(pluginName + '/package.json')` resout vers le bon dossier. Les chemins de discovery sont resolus depuis l'URL retournee. |
| PL-03 | `resolution compile > dist/` | Plugin compile distribue via npm, avec chemins de discovery pointant vers `dist/` (ex: `{ subscribers: "dist/subscribers" }`) | La resolution trouve `dist/subscribers/` (pas `src/subscribers/`). Le `definePlugin()` du plugin compile override les chemins par defaut. |

### 11.3 createService() Override Test

| # | Test | Description | Assertion |
|---|------|-------------|-----------|
| CS-01 | `override > throw before super prevents insert and events` | Sous-classe de `ProductServiceBase` qui throw `MantaError` avant d'appeler `super.createProducts()` | L'insert n'a PAS lieu (repository vide). `messageAggregator.getMessages()` retourne un tableau vide (aucun event bufferise). L'erreur est propagee a l'appelant. |
