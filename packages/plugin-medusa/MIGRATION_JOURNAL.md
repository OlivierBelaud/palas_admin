# Plugin Medusa — Journal de migration

Ce document trace tous les findings, decisions, blockers et adaptations
au fur et a mesure de l'integration des modules Medusa dans Manta.

---

## 1. Classification des modules Medusa

### Modules e-commerce (restent dans le plugin Medusa)

Ce sont les modules metier specifiques au commerce. Un dev qui fait un blog ou un CRM n'en a pas besoin.

| Module | Entities | Role |
|--------|----------|------|
| product | 10 | Catalogue produits, variantes, categories, tags |
| order | 23 | Commandes, retours, echanges, claims |
| cart | 9 | Panier, lignes, methodes de livraison |
| payment | 8 | Paiements, sessions, captures, remboursements |
| pricing | 6 | Prix, listes de prix, regles |
| fulfillment | 12 | Expedition, zones, options, profils |
| promotion | 7 | Promotions, campagnes, budgets |
| inventory | 3 | Stock, niveaux, reservations |
| customer | 4 | Clients, groupes, adresses |
| sales-channel | 1 | Canaux de vente |
| tax | 4 | Taxes, regions fiscales, regles |
| currency | 1 | Devises |
| region | 2 | Regions, pays |
| store | 3 | Configuration boutique, locales |
| stock-location | 2 | Emplacements de stock |

### Modules framework — analyse detaillee

Ces modules ne sont PAS du e-commerce. Analyse par priorite.

#### 🔴 STRATEGIQUE — a implementer en priorite

**auth** (2 entities: AuthIdentity, ProviderIdentity)
- Ce que ca fait : authentication multi-provider (emailpass, google, github), JWT, sessions
- Equivalent Manta : `IAuthPort` (crypto JWT) + `IAuthModuleService` (sessions)
- Impact si absent : PAS de login admin, PAS de login storefront
- Decision : Manta doit implementer ce module nativement. Le workflow et les routes admin en dependent.
- Dep framework : `cache` (pour les sessions temporaires) → branche sur `ICachePort`

**user** (2 entities: User, Invite)
- Ce que ca fait : gestion des users admin + systeme d'invitations
- Equivalent Manta : aucun
- Impact si absent : PAS de creation d'admin, PAS d'acces dashboard
- Decision : a implementer. C'est le module qui gere les utilisateurs du backoffice.
- Dep framework : `configModule.jwt_secret` pour generer les tokens d'invitation

#### 🟡 IMPORTANT — necessaire pour les workflows/routes

**notification** (2 entities: Notification, NotificationProvider)
- Ce que ca fait : envoie des notifications (email, SMS, push) via providers
- Equivalent Manta : `INotificationPort`
- Impact si absent : pas de confirmation de commande, pas de reset password par email
- Decision : le port Manta existe, il faut mapper `notificationModuleService` dessus
- Qui l'appelle : workflows de commande, subscribers, reset password

**file** (0 entities, provider-based)
- Ce que ca fait : stockage de fichiers (images produits, factures)
- Equivalent Manta : `IFilePort` (InMemory dev, Vercel Blob prod)
- Impact si absent : pas d'upload d'images produits dans l'admin
- Decision : le port Manta existe, mapper directement

**locking** (0 entities, provider-based)
- Ce que ca fait : advisory locks pour concurrence (eviter double traitement)
- Equivalent Manta : `ILockingPort` (InMemory dev, Neon advisory locks prod)
- Impact si absent : risque de double traitement en concurrent
- Decision : le port Manta existe, mapper directement
- Note : le module Medusa utilise `manager` (EntityManager) pour les locks SQL.
  Notre `ILockingPort` fait la meme chose via Drizzle.

**translation** (3 entities: Translation, Locale, Settings)
- Ce que ca fait : traductions des entites (titres produits en plusieurs langues)
- Equivalent Manta : `ITranslationPort` dans la spec, pas encore implemente
- Impact si absent : pas de multi-langue sur les produits
- Decision : implementer plus tard, pas bloquant pour le MVP

#### ⚪ PAS PRIORITAIRE

**api-key** (1 entity: ApiKey)
- Ce que ca fait : gestion des cles API pour le storefront (publishable keys)
- Impact si absent : le storefront utilise un bearer token au lieu d'une API key
- Decision : a implementer quand on fait le storefront. Pas bloquant pour l'admin.

**settings** (2 entities: ViewConfiguration, UserPreference)
- Ce que ca fait : preferences UI par utilisateur dans l'admin (colonnes affichees, filtres sauves)
- C'est du e-commerce ? **OUI** — c'est specifique au dashboard Medusa
- Decision : reste dans le plugin Medusa, pas un module framework
- ⚠️ RECLASSIFICATION : settings devrait etre dans COMMERCE_MODULES

**analytics** (0 entities, provider-based)
- Ce que ca fait : tracking Posthog dans l'admin dashboard
- Impact si absent : pas de tracking usage, pas grave
- Decision : pas prioritaire, implementer si besoin

**rbac** (4 entities: RbacPolicy, RbacRole, RbacRoleParent, RbacRolePolicy)
- Ce que ca fait : roles et permissions (feature flag chez Medusa, pas active par defaut)
- Impact si absent : tous les admins ont tous les droits (comportement par defaut Medusa)
- Decision : pas prioritaire, Medusa ne l'active meme pas par defaut

---

## 2. Deps manquantes — analyse reelle (pas de stubs)

Quand un module Medusa echoue a l'instanciation, c'est parce qu'il depend d'un service
qui doit exister dans le container. Voici l'analyse pour chaque dep manquante.

### `event_bus` — utilise par product, stock-location, et la plupart des modules

**Ce que Medusa fait** : `EventBusModuleService` — emet des domain events (`product.created`, `order.placed`, etc.)
via Redis ou in-memory. Les modules l'utilisent pour notifier les subscribers apres chaque mutation CRUD.

**Ce que Manta a** : `IEventBusPort` — meme concept, implementation in-memory (dev) ou Upstash (prod).
Le `MessageAggregator` bufferise les events et les release a la fin de la requete.

**Action** : Mapper `event_bus` → `IEventBusPort` de Manta. C'est un mapping direct, pas un stub.
Le module product emet `product.created` → notre EventBus le recoit → les subscribers sont notifies.

**Status** : 🔴 A faire

### `cache` — utilise par auth

**Ce que Medusa fait** : Module cache (Redis/in-memory) pour stocker les sessions, tokens temporaires.

**Ce que Manta a** : `ICachePort` — meme concept, in-memory (dev), Upstash (prod).

**Action** : Mapper `cache` → `ICachePort` de Manta.

**Status** : 🔴 A faire

### `manager` — utilise par locking

**Ce que Medusa fait** : MikroORM `EntityManager` — acces DB bas niveau.

**Ce que Manta a** : `IDatabasePort` + `IRepository` via Drizzle. Pas d'EntityManager.

**Action** : Creer un adapter `DrizzleManagerProxy` qui expose les methodes que le module locking utilise.
C'est un vrai sujet d'adaptation car MikroORM et Drizzle n'ont pas la meme API.

**Status** : 🔴 A analyser en detail

### `xxxProviderService` — analytics, auth, caching, file, locking

**Ce que Medusa fait** : Pattern provider — un service qui gere N providers (ex: multiple auth providers: emailpass, google, github).

**Ce que Manta a** : Pattern `IXxxProvider` — meme concept mais interface differente.

**Action** : Mapper les ProviderServices Medusa vers les Providers Manta. Ex: `authProviderService` → wrapper autour de `IAuthProvider[]`.

**Status** : 🔴 A analyser par provider

### `configModule` avec `jwt_secret` — utilise par user

**Ce que Medusa fait** : `configModule.projectConfig.jwt_secret` — lu depuis `medusa-config.ts`.

**Ce que Manta a** : `manta.config.ts` — config differente. Le JWT secret est dans `IAuthPort`.

**Action** : Mapper `configModule` vers la config Manta. Le jwt_secret vient de `IAuthPort.config` ou de env vars.

**Status** : 🔴 A faire

### `pricingRepository` — repo custom pricing

**Ce que Medusa fait** : Repo MikroORM avec `clearAvailableAttributes()`, `setAvailableAttributes()` — gere les attributs de pricing dynamiques.

**Ce que Manta a** : `IRepository` generique. Besoin d'un repo Drizzle avec les memes methodes custom.

**Action** : Creer `DrizzlePricingRepository` avec les queries specifiques pricing.

**Status** : 🟡 Module charge avec interface minimale, methodes custom a implementer

### `rbacRepository` — repo custom RBAC

**Ce que Medusa fait** : Repo avec queries specifiques pour la resolution des permissions (roles, policies).

**Action** : Creer `DrizzleRbacRepository` avec les queries de resolution de permissions.

**Status** : 🟡 Module charge avec InternalService, queries custom a implementer

### `manager` — EntityManager (locking)

**Ce que Medusa fait** : MikroORM EntityManager — utilise par le module locking pour les advisory locks SQL (`SELECT pg_advisory_lock()`).

**Ce que Manta a** : `IDatabasePort` + Drizzle. Pas d'EntityManager.

**Action** : Creer `DrizzleManagerAdapter` qui expose `execute(query)` et `fork()` via le client Drizzle.
En dev (InMemory), le locking utilise deja `InMemoryLockingAdapter` de Manta.

**Status** : 🟡 Module charge avec manager minimal, SQL execution a brancher sur Drizzle

---

## 3. Interface declarative — differences Medusa vs Manta

### Ce qui est identique (apres harmonisation)

| Element | Medusa | Manta | Identique ? |
|---------|--------|-------|-------------|
| `model.define()` | `model.define('post', { ... })` | idem | OUI |
| Modifiers | `.nullable()`, `.default()`, `.unique()`, `.index()`, `.primaryKey()`, `.computed()`, `.searchable()`, `.translatable()` | idem | OUI |
| `Module()` | `Module('post', { service })` | idem | OUI |
| Service factory | `MedusaService({ Post })` | `createService({ Post })` | Nom different, API identique |
| CRUD signatures | `retrieve(id, config?, ctx?)` | idem | OUI |
| Constructor | `constructor(container)` Awilix cradle | idem (Awilix) | OUI |
| Methodes generees | 12 methodes (8 CRUD + events) | idem | OUI |

### Ce qu'un dev Medusa doit changer pour Manta

| Changement | Avant (Medusa) | Apres (Manta) |
|-----------|---------------|---------------|
| Import package | `@medusajs/framework/utils` | `@manta/core` |
| Nom de la factory | `MedusaService({ Post })` | `createService({ Post })` |
| Errors | `MedusaError` | `MantaError` |
| Container keys | `Modules.PRODUCT` | `ContainerRegistrationKeys.XXX` ou string direct |

---

## 4. Decisions prises

| Date | Decision | Raison |
|------|----------|--------|
| 2026-03-18 | Container = Awilix | Battle-tested, compat Medusa, cradle, Object.keys, dispose |
| 2026-03-18 | DML modifiers ISO Medusa | `.nullable()` pas `.setNullable()`, meme DX |
| 2026-03-18 | Classes typees par property | TextProperty, NumberProperty, etc. pour type inference |
| 2026-03-18 | CRUD params: context en dernier | ISO Medusa, optionnel |
| 2026-03-18 | Constructor: `baseRepository` | ISO Medusa, accepte Awilix cradle |
| 2026-03-18 | Module(): `Module(name, { service })` | ISO Medusa |
| 2026-03-18 | Naming: `XxxModuleService` | Convention Medusa |
| 2026-03-18 | caching/index-module exclus | Modules infra qui dependent d'un adapter specifique |
| 2026-03-18 | PAS de stubs pour les deps | Les deps manquantes doivent etre mappees vers les ports Manta, pas stubbees |
| 2026-03-18 | getFreshManager dans le plugin, pas dans le core | C'est du MikroORM compat — wrapper dans `wrapRepoForMedusa()`, pas sur `IRepository` |
| 2026-03-18 | settings = framework, pas commerce | Preferences UI + vues sauvegardees = dashboard, pas e-commerce |
| 2026-03-18 | getEventManager = no-op | MikroORM ORM events remplacés par MessageAggregator dans Manta |
| 2026-03-18 | Workflows = WDK (Vercel Workflow Dev Kit) | On ne reinvente pas le moteur de workflow. WDK est open source, battle-tested, avec le pattern World (adapter) qui match notre archi ports/adapters. Local World (dev), Postgres World (self-hosted), Vercel World (managed). |

---

## 5. Pont MikroORM → Drizzle : getFreshManager explique

### Ce que fait getFreshManager dans Medusa

```
1. service.listProducts(filters, config, sharedContext)
2. @InjectManager intercepte → appelle baseRepository_.getFreshManager()
   → retourne un EntityManager MikroORM (fork = copie isolee pour cette requete)
3. Le manager est mis dans sharedContext.manager
4. InternalService.list() appelle this.productRepository.find(options, sharedContext)
5. Le repo fait getActiveManager(sharedContext) → prend le manager
6. manager.find(ProductEntity, where, options) → SQL query via MikroORM
```

Le manager sert a 2 choses :
- **Isolation des queries** : chaque requete HTTP a son propre fork (unit of work MikroORM)
- **Event subscribers ORM** : `manager.getEventManager()` enregistre des listeners sur afterCreate/afterUpdate

### Ce qu'on fait dans Manta

```
1. getFreshManager() → retourne le repo lui-meme (Drizzle est stateless, pas de fork necessaire)
2. getActiveManager() → idem, prend le transactionManager si dispo
3. getEventManager() → retourne un registre no-op (les events passent par MessageAggregator)
```

**Pourquoi ca marche** : les sous-services (InternalService) n'appellent JAMAIS `manager.find(Entity, ...)`.
Ils appellent `this.repository.find(options, context)`. Le manager est utilise seulement pour les event subscribers ORM,
qu'on remplace par notre MessageAggregator.
