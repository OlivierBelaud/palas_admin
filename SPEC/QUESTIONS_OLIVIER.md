# Questions pour Olivier -- TOUTES RESOLUES

> 7 questions d'architecture identifiees lors de l'audit multi-agents
> Toutes resolues le 2026-03-09

---

## Decisions prises

### QH-001 : Garanties Event Bus
**Decision** : at-least-once en production avec retry automatique et DLQ. At-most-once acceptable en dev (in-memory).
**Justification** : Medusa fait at-most-once par defaut (meme avec Redis BullMQ, `attempts=1`). Pas de DLQ. C'est faible. Notre framework fait mieux.
**Adapter production** : Vercel Queues (pub/sub natif, fan-out, at-least-once, retry, DLQ).

### QH-002 : Lazy loading modules (cold start serverless)
**Decision** : lazy loading module-par-module. Seuls les modules requis (EVENT_BUS, CACHE) sont charges au startup. Les autres sont charges a la premiere resolution.
**Justification** : 30+ modules au demarrage = 5-15s cold start. Inacceptable en serverless. Le pre-build Nitro elimine le scan filesystem. Le lazy loading elimine le chargement inutile.
**Note** : sujet d'implementation a valider en phase de code.

### QH-003 : DML agnostique ORM
**Decision** : DML abstrait. Adapter Drizzle par defaut.
**Justification** : Drizzle est le meilleur ORM pour serverless — leger, driver serverless Neon natif, pas de connexion persistante, excellent TypeScript. Choisi par Next.js/Vercel.

### QH-004 : Session auth vs JWT
**Decision** : JWT par defaut. Sessions optionnelles via adapter (Upstash Redis).
**Justification** : JWT est stateless, zero store externe, parfait pour serverless. Sessions necessitent un store (Redis/KV) = dependance et latence supplementaire.

### QH-005 : Adapter Event Bus pour Vercel
**Decision** : Vercel Queues (Public Beta, fev 2026).
**Justification** : Pub/sub natif avec consumer groups (fan-out), at-least-once, retry configurable, DLQ, OIDC auth. C'est un vrai event bus, pas juste une queue. $0.60/1M operations.
**Alternative** : Inngest si portabilite multi-plateforme requise (pas de lock-in Vercel).
**Note** : Vercel KV et Vercel Postgres sont DEPRECIES. Utiliser Upstash Redis et Neon via Vercel Marketplace.

### QH-006 : Index module
**Decision** : inclus dans la spec comme port optionnel (SPEC-104/105).
**Clarification** : ce n'est PAS des index SQL ni un moteur de recherche. C'est un cache de lecture denormalise en PostgreSQL — copie les donnees de plusieurs modules dans des tables JSONB partitionnees, synchronise en temps reel via events, expose via `query.index()` comme alternative performante a `query.graph()`.
**Statut** : framework pur (optimisation d'infra). Feature-flagge, desactive par defaut.

### QH-007 : Pre-build du manifeste
**Decision** : oui, pre-build a la Nitro. `manta build` genere le manifeste (routes, subscribers, jobs, modules). Au runtime, chargement direct du manifeste sans scan filesystem.
**Justification** : Nitro fait deja ca pour les routes. On etend le pattern a tout le framework.

---

## Decisions d'infrastructure

| Composant | Decision | Raison |
|-----------|----------|--------|
| Serveur HTTP | **Nitro** (pas Express) | Universel, Web Standards, presets deploiement natifs |
| ORM | **Drizzle** (pas MikroORM) | Serverless-natif, leger, driver Neon |
| Event Bus (Vercel) | **Vercel Queues** | Pub/sub natif, at-least-once, DLQ |
| Cache (Vercel) | **Upstash Redis** (via Marketplace) | Vercel KV deprecie |
| DB (Vercel) | **Neon** (via Marketplace) | Vercel Postgres deprecie |
| Auth | **JWT** par defaut | Stateless, zero store |
| Files (Vercel) | **Vercel Blob** | Natif, presigned URLs |

---

## Services Vercel a jour (mars 2026)

| Service | Statut | Usage |
|---------|--------|-------|
| Vercel Queues | Public Beta | Event bus |
| Vercel Cron | GA | Scheduled jobs |
| Vercel Blob | GA | File storage |
| Vercel Edge Config | GA | Feature flags, config rapide |
| Vercel Workflow | Disponible | Orchestration multi-step |
| Neon (Marketplace) | GA | PostgreSQL serverless |
| Upstash Redis (Marketplace) | GA | Cache, sessions |
| ~~Vercel KV~~ | DEPRECIE | → Upstash Redis |
| ~~Vercel Postgres~~ | DEPRECIE | → Neon |
