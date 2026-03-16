# Adapters Catalog — Implementations des Ports
> Chaque adapter implemente un ou plusieurs ports du framework
> Organise par port, puis par plateforme cible
> Derniere mise a jour : 2026-03-09

---

## Decisions d'infrastructure

| Composant | Dev Local | Vercel Prod | Justification |
|-----------|-----------|-------------|---------------|
| HTTP | Nitro (preset node) | Nitro (preset vercel) | Universel, Web Standards, zero config deploy |
| DB | Drizzle + PG local | Drizzle + Neon | Serverless-natif, driver Neon |
| Cache | In-memory | Upstash Redis (Marketplace) | Remplace Vercel KV (deprecie) |
| Events | In-memory EventEmitter | Vercel Queues | Pub/sub natif, at-least-once, DLQ |
| Files | Local filesystem | Vercel Blob | Presigned URLs, natif Vercel |
| Locking | In-memory | Neon advisory locks | Meme DB, zero service externe |
| Logger | Pino (pretty) | Pino (JSON) | Structured logging partout |
| Jobs | node-cron | Vercel Cron | Natif Vercel |
| Workflow | PG local | Neon | Dev doit matcher prod |
| Notifications | Console log | Resend / SendGrid | A adapter depuis Medusa |
| Analytics | Console log | PostHog ou custom | Pas prioritaire |
| Search | — | Algolia / Meilisearch | Pas prioritaire |
| Auth | JWT | JWT | Stateless, zero store |

---

## 1. IHttpPort

### Nitro Adapter (Principal — Dev + Production)
- **Port** : IHttpPort
- **Package** : `@manta/adapter-nitro`
- **Dependances npm** : `nitro`, `h3`
- **Pourquoi Nitro** :
  - Serveur universel H3/unjs — Web Standards natif (Request/Response)
  - Presets deploiement : `node` (local), `vercel` (serverless), `vercel-edge`, `aws-lambda`, `cloudflare-workers`, `deno`, `bun`
  - File-system routing natif (meme convention que notre framework)
  - Zero config pour changer de plateforme : `nitro.config.ts` → `preset: 'vercel'`
  - Pas de wrapper serverless necessaire (contrairement a Express)
  - Leger, rapide au cold start
- **Configuration** :
  ```typescript
  // nitro.config.ts
  export default defineNitroConfig({
    preset: 'vercel', // ou 'node', 'aws-lambda', 'cloudflare', etc.
  })
  ```
- **Exemple minimal** :
  ```typescript
  import { createMantaHandler } from '@manta/adapter-nitro'
  export default defineEventHandler(createMantaHandler(container))
  ```
- **Limitations** :
  - Pas de session middleware natif (utiliser JWT ou KV-backed sessions)
  - Le file-system routing Nitro est distinct de celui du framework — l'adapter doit faire le pont

### Next.js Integration (via Nitro preset vercel)
- **Port** : IHttpPort
- **Package** : `@manta/adapter-nextjs`
- **Dependances npm** : `next` (peer dependency)
- **Usage** : pour les projets Next.js qui veulent integrer Manta dans leurs API routes
- **Approche recommandee** : Nitro preset vercel (le framework gere le serveur, deploye comme serverless functions Vercel)
- **Approche alternative** : Next.js Route Handlers directement
- **Exemple minimal** :
  ```typescript
  // app/api/[...route]/route.ts
  import { createNextjsAdapter } from '@manta/adapter-nextjs'
  import { container } from '@/lib/container'
  const handler = createNextjsAdapter(container)
  export { handler as GET, handler as POST, handler as PUT, handler as DELETE }
  ```
- **Limitations** :
  - Timeout serverless (10s Hobby, 60s Pro sur Vercel)
  - Pas de middleware Express (utiliser Next.js middleware)

### Express Adapter (Legacy / Migration Medusa uniquement)
- **Port** : IHttpPort
- **Package** : `@manta/adapter-express`
- **Dependances npm** : `express`, `cookie-parser`, `cors`
- **Statut** : **NON PRIORITAIRE** — uniquement pour migration progressive depuis Medusa (Phase 1 du MIGRATION_STRATEGY.md)
- **Note** : sera deprecie a terme. Nitro est le seul adapter HTTP maintenu activement.

---

## 2. IDatabasePort

### Drizzle + PG Local Adapter (Dev)
- **Port** : IDatabasePort
- **Package** : `@manta/adapter-drizzle-pg`
- **Dependances npm** : `drizzle-orm`, `pg`, `drizzle-kit`
- **Configuration** :
  ```typescript
  database: {
    url: 'postgresql://localhost:5432/mydb',
    pool: { min: 2, max: 10 }
  }
  ```
- **Note** : PG local obligatoire en dev. Pas de SQLite. Le dev doit matcher la prod.

### Drizzle + Neon Adapter (Vercel / Serverless)
- **Port** : IDatabasePort
- **Package** : `@manta/adapter-drizzle-neon`
- **Dependances npm** : `drizzle-orm`, `@neondatabase/serverless`, `drizzle-kit`
- **Configuration** :
  ```typescript
  database: {
    url: process.env.DATABASE_URL,  // Neon connection string
    pool: { min: 0, max: 10 },      // min=0 crucial pour serverless
    ssl: true
  }
  ```
- **Limitations** :
  - Neon serverless driver utilise WebSocket, pas TCP natif
  - Cold start : ~200ms pour la premiere connexion
- **Service Vercel** : Neon via Marketplace (Vercel Postgres est DEPRECIE)

### MikroORM Adapter (Migration Medusa uniquement)
- **Port** : IDatabasePort
- **Package** : `@manta/adapter-mikroorm`
- **Dependances npm** : `@mikro-orm/core`, `@mikro-orm/knex`, `@mikro-orm/migrations`, `@mikro-orm/postgresql`
- **Statut** : **NON PRIORITAIRE** — uniquement pour migration progressive (Phase 1 du MIGRATION_STRATEGY.md, meme ORM que Medusa pour zero risque)
- **Note** : sera deprecie a terme au profit de Drizzle

---

## 3. ICachePort

### In-Memory Cache Adapter (Dev)
- **Port** : ICachePort
- **Package** : `@manta/adapter-cache-memory`
- **Dependances npm** : aucune
- **Configuration** : aucune
- **Limitations** :
  - Perdu entre invocations serverless
  - Pas de partage entre instances
- **Exemple minimal** :
  ```typescript
  import { InMemoryCacheAdapter } from '@manta/adapter-cache-memory'
  const cache = new InMemoryCacheAdapter()
  await cache.set('key', 'value', 30) // TTL 30s
  ```

### Upstash Redis Cache Adapter (Vercel Prod)
- **Port** : ICachePort
- **Package** : `@manta/adapter-cache-upstash`
- **Dependances npm** : `@upstash/redis`
- **Configuration** :
  ```typescript
  cache: {
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
    namespace: 'myapp',  // prefixe des cles
    ttl: 30               // defaut en secondes
  }
  ```
- **Pourquoi Upstash Redis** :
  - Vercel KV est DEPRECIE (mars 2026)
  - Upstash Redis disponible via Vercel Marketplace
  - API REST natif (pas de connexion persistante — parfait pour serverless)
  - Compatible ioredis si besoin
- **Limitations** :
  - API REST = leger overhead vs Redis TCP natif (~2-5ms par operation)
- **Invalidation wildcard** :
  - NE PAS utiliser `SCAN` + `DEL` pour invalider des cles par pattern (couteux, O(n), facture par commande)
  - Utiliser le pattern **version key** : les cles cache incluent un numero de version (`cache:v5:products:123`), la version courante est stockee dans une cle dediee (`cache:version`). Pour tout invalider, on incremente la version. Les anciennes cles expirent naturellement via TTL. C'est O(1) et zero scan.
- **Exemple minimal** :
  ```typescript
  import { UpstashCacheAdapter } from '@manta/adapter-cache-upstash'
  const cache = new UpstashCacheAdapter({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
  })
  ```
- **Service Vercel** : Upstash Redis via Marketplace

---

## 4. IEventBusPort

### In-Memory EventEmitter Adapter (Dev)
- **Port** : IEventBusPort
- **Package** : `@manta/adapter-eventbus-memory`
- **Dependances npm** : aucune
- **Configuration** : aucune
- **Garanties** : at-most-once (acceptable en dev)
- **Grouped events** : stockes en Map in-memory, pas de TTL (persistent pour la duree du process)
- **Interceptors** : supportes (read-only, fire-and-forget, comme en prod)
- **Limitations** :
  - Events perdus entre invocations
  - Pas de retry, pas de DLQ
  - Pas de grouped events persistants

### Vercel Queues Adapter (Vercel Prod)
- **Port** : IEventBusPort
- **Package** : `@manta/adapter-eventbus-vercel-queues`
- **Dependances npm** : `@vercel/queue`
- **Configuration** :
  ```typescript
  eventBus: {
    // Configuration via Vercel Dashboard + env vars
    // OIDC auth automatique
    groupedEventsTTL: 600  // defaut 600s, configurable pour workflows long-running
  }
  ```
- **Pourquoi Vercel Queues** :
  - Pub/sub natif avec consumer groups (fan-out)
  - At-least-once delivery garanti
  - Retry configurable + DLQ
  - OIDC auth
  - $0.60/1M operations
  - Public Beta (fevrier 2026)
- **Garanties** : at-least-once avec retry et DLQ
- **Grouped events** : stockes dans une queue staging avec TTL (defaut 600s). Expiration automatique si le process meurt sans release.
- **Interceptors** : supportes (read-only, fire-and-forget)
- **Limitations** :
  - Public Beta (fevrier 2026)
  - Vercel uniquement (pas portable)
- **Alternative portable** : Inngest (`@manta/adapter-eventbus-inngest`) si portabilite multi-plateforme requise (pas de lock-in Vercel)

---

## 5. IFilePort

### Local Filesystem Adapter (Dev)
- **Port** : IFilePort
- **Package** : `@manta/adapter-file-local`
- **Dependances npm** : aucune (fs natif)
- **Configuration** :
  ```typescript
  file: {
    uploadDir: './static',         // convention Medusa : dossier 'static' par defaut
    baseUrl: 'http://localhost:9000'  // sert le contenu de static/ publiquement
  }
  ```
- **Compatibilite Medusa** : Medusa utilise `static/` comme dossier par defaut, servi publiquement. Notre adapter local doit respecter cette convention pour la migration.
- **Upload handling** : Medusa utilise `multer` (Express middleware). Avec Nitro, on utilise `readMultipartFormData()` de h3 nativement — zero dependance supplementaire.
- **Limitations** : filesystem ephemere en serverless. Dev uniquement.

### Vercel Blob Adapter (Vercel Prod)
- **Port** : IFilePort
- **Package** : `@manta/adapter-file-vercel-blob`
- **Dependances npm** : `@vercel/blob`
- **Configuration** :
  ```typescript
  file: {
    token: process.env.BLOB_READ_WRITE_TOKEN
  }
  ```
- **Limitations** : pas de dossiers (flat namespace), taille max par fichier selon plan Vercel

### S3 Adapter (AWS)
- **Port** : IFilePort
- **Package** : `@manta/adapter-file-s3`
- **Dependances npm** : `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`
- **Configuration** :
  ```typescript
  file: {
    bucket: process.env.S3_BUCKET,
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
  ```

---

## 6. ILockingPort

### In-Memory Locking Adapter (Dev)
- **Port** : ILockingPort
- **Package** : `@manta/adapter-locking-memory`
- **Dependances npm** : aucune
- **Limitations** : aucun partage entre instances. Dev uniquement.

### Neon Advisory Lock Adapter (Vercel Prod)
- **Port** : ILockingPort
- **Package** : `@manta/adapter-locking-neon`
- **Dependances npm** : `@neondatabase/serverless`
- **Configuration** : utilise la connexion Neon existante (meme DB que l'application)
- **Limitations** : memes limites que PostgreSQL advisory locks, via WebSocket

### PostgreSQL Advisory Lock Adapter (Dev / Serveur classique)
- **Port** : ILockingPort
- **Package** : `@manta/adapter-locking-postgres`
- **Dependances npm** : `pg` ou driver Drizzle
- **Configuration** : utilise la meme connexion DB que IDatabasePort

---

## 7. ILoggerPort

### Pino Logger Adapter (Dev + Prod)
- **Port** : ILoggerPort
- **Package** : `@manta/adapter-logger-pino`
- **Dependances npm** : `pino`, `pino-pretty` (dev)
- **Configuration** :
  ```typescript
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.NODE_ENV === 'production' ? 'json' : 'pretty'
  }
  ```
- **Pourquoi Pino** :
  - Le plus rapide des loggers Node.js (benchmarks)
  - JSON structured natif (capture par Vercel Log Drain, CloudWatch, etc.)
  - `pino-pretty` pour le dev local (output lisible)
  - Leger, zero overhead en production
- **Dev** : `pino-pretty` pour output lisible avec couleurs
- **Prod** : JSON vers stdout, capture par Vercel Log Drain
- **Exemple minimal** :
  ```typescript
  import { PinoLoggerAdapter } from '@manta/adapter-logger-pino'
  const logger = new PinoLoggerAdapter({ level: 'info' })
  logger.info('Server started', { port: 9000 })
  ```

---

## 8. IWorkflowEnginePort

### Saga Engine (Defaut — Dev + Prod)
- **Port** : IWorkflowEnginePort
- **Package** : `@manta/core` (inclus dans le core)
- **Dependances npm** : aucune (implementation interne)
- **Description** : TransactionOrchestrator — moteur Saga local. Execute les workflows in-process avec checkpoints persistes via IWorkflowStoragePort.
- **Responsabilites** :
  - Orchestrer les steps (invoke/compensate)
  - Persister les checkpoints apres chaque step
  - Appeler `IEventBusPort.releaseGroupedEvents()` en cas de succes
  - Appeler `IEventBusPort.clearGroupedEvents()` en cas d'echec
- **Limitations** : in-process uniquement. Pas de distribution cross-instances.

### InMemory Workflow Engine (Tests)
- **Port** : IWorkflowEnginePort
- **Package** : `@manta/testing`
- **Dependances npm** : aucune
- **Description** : moteur mock pour tests unitaires. Execute les steps synchroniquement sans persistence.
- **Usage** : `const engine = new InMemoryWorkflowEngine()` — permet de mocker le moteur complet dans les tests.

---

## 9. IJobSchedulerPort

### node-cron Adapter (Dev)
- **Port** : IJobSchedulerPort
- **Package** : `@manta/adapter-jobs-cron`
- **Dependances npm** : `node-cron`
- **Configuration** : lit les configs des fichiers `src/jobs/`
- **Retry** : implemente via `retryExecution()` en local (wrapping du handler)
- **Historique** : `getJobHistory()` persiste les resultats via IWorkflowStoragePort
- **Limitations** : necessite process persistant

### Vercel Cron Adapter (Vercel Prod)
- **Port** : IJobSchedulerPort
- **Package** : `@manta/adapter-jobs-vercel-cron`
- **Dependances npm** : aucune
- **Configuration** :
  ```json
  // vercel.json
  { "crons": [{ "path": "/api/cron/my-job", "schedule": "0 * * * *" }] }
  ```
- **Securite** : DOIT verifier le header `x-vercel-cron-signature` pour valider que l'invocation vient de Vercel
- **Retry** : pas de retry natif — l'adapter wrape le handler avec `retryExecution()` configurable par job
- **Timeout** : HTTP 504 mappe vers `JobResult { status: 'failure', error: JobTimeoutError }`
- **Historique** : `getJobHistory()` persiste les resultats via IWorkflowStoragePort (Neon)
- **Limitations** :
  - Cron minimum : 1/heure (Hobby), 1/minute (Pro)
  - Le job est invoque via HTTP (route handler)
  - Pas de concurrency control natif (gerer via ILockingPort)

---

## 10. IWorkflowStoragePort

### PG Local Storage (Dev)
- **Port** : IWorkflowStoragePort
- **Package** : `@manta/adapter-workflow-pg`
- **Dependances npm** : `pg` ou driver Drizzle
- **Configuration** : utilise la meme connexion PG que IDatabasePort
- **Schema isolation** : les donnees workflow utilisent un schema SQL separe (`workflow`) distinct du schema applicatif (`app`). Meme DB, isolation logique. Si demain on veut migrer vers un storage dedie, c'est un changement d'adapter, pas de code.
- **Note** : PG en dev, pas in-memory. Le dev doit matcher la prod pour les workflows (checkpoints, compensation, retry).

### Neon Storage (Vercel Prod)
- **Port** : IWorkflowStoragePort
- **Package** : `@manta/adapter-workflow-neon`
- **Dependances npm** : `@neondatabase/serverless`
- **Configuration** : utilise la connexion Neon existante
- **Schema isolation** : meme pattern que PG local — schema `workflow` separe dans Neon.
- **Limitations** : a evaluer performance pour workflows intensifs

---

## 11. INotificationPort

### Local Notification Provider (Dev)
- **Port** : INotificationPort
- **Package** : `@manta/adapter-notification-local`
- **Dependances npm** : aucune
- **Limitations** : log en console, pas d'envoi reel

### Resend Provider (Vercel-friendly)
- **Port** : INotificationPort
- **Package** : `@manta/adapter-notification-resend`
- **Dependances npm** : `resend`
- **Configuration** :
  ```typescript
  notification: {
    resend: { apiKey: process.env.RESEND_API_KEY }
  }
  ```

### SendGrid Provider
- **Port** : INotificationPort
- **Package** : `@manta/adapter-notification-sendgrid`
- **Dependances npm** : `@sendgrid/mail`
- **Configuration** :
  ```typescript
  notification: {
    sendgrid: { apiKey: process.env.SENDGRID_API_KEY }
  }
  ```

### Note sur les providers Medusa
Medusa V2 inclut deja de nombreux notification providers (SendGrid, Resend, Twilio SMS, etc.). Le plugin `@manta/plugin-medusa-commerce` pourra adapter ces providers existants vers le port INotificationPort de Manta.

---

## 12. IAnalyticsProvider

### Local Analytics Provider (Dev)
- **Port** : IAnalyticsProvider
- **Package** : `@manta/adapter-analytics-local`
- **Limitations** : log en console uniquement. Pas prioritaire.

### PostHog Provider (Production)
- **Port** : IAnalyticsProvider
- **Package** : `@manta/adapter-analytics-posthog`
- **Dependances npm** : `posthog-node`

---

## 13. ISearchProvider

> Pas prioritaire. A implementer si besoin.

### Algolia Provider
- **Port** : ISearchProvider
- **Package** : `@manta/adapter-search-algolia`
- **Dependances npm** : `algoliasearch`

### Meilisearch Provider
- **Port** : ISearchProvider
- **Package** : `@manta/adapter-search-meilisearch`
- **Dependances npm** : `meilisearch`

---

## Ordre d'implementation recommande

### Tier 1 — Sans ces adapters, rien ne boot (prerequis absolus)
1. `@manta/adapter-logger-pino` — trivial, zero dependance, debloque les logs partout
2. `@manta/adapter-cache-memory` — requis au boot (SPEC-015), ~30 lignes de Map
3. `@manta/adapter-eventbus-memory` — requis au boot (SPEC-015), EventEmitter wrape
4. Container (Awilix) — inclus dans `@manta/core` via SPEC-129, pas un adapter separe

### Tier 2 — Pour avoir quelque chose qui fonctionne de bout en bout
5. `@manta/adapter-drizzle-pg` — la DB locale, avec le dbErrorMapper complet (SPEC-133)
6. `@manta/adapter-nitro` — le serveur HTTP avec pipeline 11 etapes (SPEC-039)
7. `@manta/adapter-locking-memory` — necessaire pour les jobs (SPEC-066)
8. `@manta/adapter-jobs-cron` — pour tester le scheduler
9. `@manta/adapter-workflow-pg` — persistence des checkpoints workflow

### Tier 3 — Pour le deploiement Vercel
10. `@manta/adapter-drizzle-neon`
11. `@manta/adapter-cache-upstash`
12. `@manta/adapter-eventbus-vercel-queues`
13. `@manta/adapter-jobs-vercel-cron`
14. `@manta/adapter-file-vercel-blob`
15. `@manta/adapter-locking-neon`
16. `@manta/adapter-workflow-neon`

**Recommandation** : ecrire l'Adapter Conformance Suite (voir TEST_STRATEGY.md) avant de commencer le Tier 3. Une fois les tests de conformite definis, implementer les adapters Vercel devient mecanique — chaque adapter doit passer la meme suite.

---

## Resume : SPEC deplacees vers Adapters

| SPEC | Sujet | Adapter |
|------|-------|---------|
| SPEC-045 | Express server | Express Adapter (legacy) |
| SPEC-061 (partiel) | MikroORM couche ORM | MikroORM Adapter (legacy) |
| SPEC-078 | Redis cache | Upstash Redis Adapter |
| SPEC-082 | Winston logger | Supprime — remplace par Pino |
| SPEC-090 | Locking providers | Locking Adapters |

---

## Services Vercel a jour (mars 2026)

| Service | Statut | Usage Manta |
|---------|--------|-------------|
| Vercel Queues | Public Beta | Event bus (IEventBusPort) |
| Vercel Cron | GA | Scheduled jobs (IJobSchedulerPort) |
| Vercel Blob | GA | File storage (IFilePort) |
| Vercel Edge Config | GA | Feature flags (optionnel) |
| Neon (Marketplace) | GA | PostgreSQL serverless (IDatabasePort) |
| Upstash Redis (Marketplace) | GA | Cache (ICachePort), Sessions optionnelles |
| ~~Vercel KV~~ | **DEPRECIE** | → Upstash Redis |
| ~~Vercel Postgres~~ | **DEPRECIE** | → Neon |
