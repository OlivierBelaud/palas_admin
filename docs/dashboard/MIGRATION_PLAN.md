# Manta Dashboard — Plan de migration

## Contexte

Le dashboard JSON-Render a ete developpe et prouve dans le cadre de Medusa.
Il faut maintenant l'extraire et le faire fonctionner dans le framework Manta.

Le travail sur `@manta/dashboard-medusa` (adapter Medusa) est en PAUSE.
La priorite est `@manta/dashboard-core` + `@manta/dashboard-manta`.

---

## Phase 0 — Extraction du core (depuis le dashboard Medusa actuel)

**Objectif** : Extraire tout ce qui n'a aucune dependance Medusa dans `@manta/dashboard-core`.

### Ce qui migre dans core

| Source actuel | Destination core |
|---|---|
| `src/blocks/index.ts` | `dashboard-core/src/blocks/` |
| `src/renderers/SpecRenderer.tsx` | `dashboard-core/src/renderers/` |
| `src/renderers/index.ts` (registry + renderers) | `dashboard-core/src/renderers/` |
| `src/pages/types.ts` | `dashboard-core/src/pages/types.ts` |
| `src/data/index.ts` (resolveDataPath, resolveStateRef, buildQueryParams) | `dashboard-core/src/data/` |
| `src/override/index.ts` (createResolver) | `dashboard-core/src/override/resolver.ts` |
| `src/override/runtime-overrides.ts` | `dashboard-core/src/override/runtime-store.ts` |
| `src/shell/*` | `dashboard-core/src/shell/` |
| `src/ai/*` | `dashboard-core/src/ai/` |

### Ce qui RESTE dans dashboard-medusa

| Source actuel | Reste dans |
|---|---|
| `src/pages/index.ts` (54 PageSpecs) | `dashboard-medusa/src/pages/` |
| `src/components/index.ts` (DataComponents) | `dashboard-medusa/src/components/` |
| `src/lib/sdk.ts` | `dashboard-medusa/src/adapter/auth.ts` |
| `src/hooks/api/auth.ts` | `dashboard-medusa/src/adapter/auth.ts` |
| `src/hooks/api/users.ts` | `dashboard-medusa/src/adapter/auth.ts` |
| `src/shell/form-routes.ts` (lazy imports Medusa) | `dashboard-medusa/src/forms/` |

### Refactoring necessaire dans core

1. **SpecRenderer** : remplacer `fetch()` en dur par `useDataSource().fetch()`
2. **Renderers (delete action)** : remplacer `fetch(DELETE)` par `useDataSource().mutate()`
3. **data/index.ts** : extraire `entityEndpointMap` et `entityQueryKeyMap` → injectes par le DataSource
4. **Shell** : extraire les hooks Medusa (auth, user) → deleguer au AuthAdapter
5. **AI chat** : les tools (create_page, etc.) passent par l'OverrideStore injecte

### Livrables

```
packages/dashboard-core/
├── package.json
│   {
│     "name": "@manta/dashboard-core",
│     "version": "0.1.0",
│     "type": "module",
│     "main": "src/index.ts",
│     "peerDependencies": {
│       "react": "^18.0.0",
│       "react-dom": "^18.0.0",
│       "react-router-dom": "^6.0.0",
│       "@tanstack/react-query": "^5.0.0",
│       "@medusajs/ui": "^4.0.0",
│       "@medusajs/icons": "^2.0.0"
│     }
│   }
├── tsconfig.json
└── src/
    ├── index.ts
    ├── interfaces/
    ├── providers/
    ├── blocks/
    ├── renderers/
    ├── pages/
    ├── data/
    ├── override/
    ├── shell/
    └── ai/
```

**Note sur @medusajs/ui et @medusajs/icons** : ce sont des libs UI generiques (Radix + Tailwind).
Elles n'ont AUCUN couplage avec le backend Medusa. On les garde comme peer deps pour l'instant.
A terme, on pourra les forker ou les remplacer par un design system Manta.

---

## Phase 1 — @manta/dashboard-manta (adapter)

**Objectif** : Faire tourner le dashboard sur une instance Manta.

### 1.1 — MantaDataSource

- `fetch()` avec JWT Bearer
- `entityToEndpoint()` dynamique (from registry)
- `getQueryKey()` = entity name

### 1.2 — MantaAuth

- Login/logout via `/auth/login`, `/auth/logout`
- JWT stocke dans localStorage
- getCurrentUser via `/admin/api/me`

### 1.3 — RegistryClient

- `GET /admin/api/registry` au boot
- Parse pages, components, navigation, modules, forms
- Passe au DataSource et au DashboardProvider

### 1.4 — ApiOverrideStore

- `GET /admin/api/config/overrides` au login
- Cache local + pub/sub (meme pattern que localStorage)
- Debounced `PUT /admin/api/config/overrides` sur chaque modification

### Livrables

```
packages/dashboard-manta/
├── package.json
│   {
│     "name": "@manta/dashboard-manta",
│     "version": "0.1.0",
│     "peerDependencies": {
│       "@manta/dashboard-core": "workspace:*",
│       "react": "^18.0.0"
│     }
│   }
└── src/
    ├── index.tsx
    └── adapter/
        ├── data-source.ts
        ├── auth.ts
        ├── override-store.ts
        └── registry.ts
```

---

## Phase 2 — Backend Manta : Registry + Admin Config

### 2.1 — RegistryBuilder (core)

Dans `@manta/core`, le bootstrap collecte les declarations admin des modules/plugins.

```typescript
// packages/core/src/admin/registry-builder.ts
export class RegistryBuilder {
  register(source: string, declaration: AdminDeclaration): void
  build(): RegistryResponse
}
```

### 2.2 — Registry API route

```typescript
// Route H3 dans adapter-nitro
GET /admin/api/registry → RegistryHandler
```

### 2.3 — Module admin-config

```
packages/module-admin-config/
├── package.json
├── src/
│   ├── models/
│   │   └── admin-override.ts   ← DML model
│   ├── service.ts              ← CRUD + resolution par scope
│   └── index.ts                ← Module() export
```

Routes :
```
GET    /admin/api/config/overrides
PUT    /admin/api/config/overrides
DELETE /admin/api/config/overrides/:id
POST   /admin/api/config/overrides/:id/share
GET    /admin/api/config/templates
```

---

## Phase 3 — Serving de la SPA depuis Nitro

### 3.1 — Dev mode

Vite dev server avec proxy vers Nitro.

```typescript
// Dans manta dev
// 1. Start Nitro on :9000
// 2. Start Vite on :5173 with proxy config:
//    /admin/api/* → http://localhost:9000
//    /auth/* → http://localhost:9000
```

### 3.2 — Prod mode

```typescript
// manta build
// 1. Build Nitro bundle
// 2. Build dashboard SPA → .manta/admin/
// 3. Nitro serves static files from .manta/admin/ on /admin/*
```

### 3.3 — Admin handler dans adapter-nitro

```typescript
// packages/adapter-nitro/src/admin-handler.ts
export function createAdminHandler(adminDir: string): EventHandler
```

---

## Phase 4 — Plugin commerce declare son admin

### 4.1 — Extraire les 54 PageSpecs dans le plugin

Les PageSpecs actuellement dans `dashboard-medusa/src/pages/index.ts`
deviennent `plugin-medusa-commerce/src/admin/pages.json`.

### 4.2 — Extraire les DataComponents

Les composants actuellement dans `dashboard-medusa/src/components/index.ts`
deviennent `plugin-medusa-commerce/src/admin/components.json`.

### 4.3 — Extraire la navigation

L'arbre de nav commerce devient `plugin-medusa-commerce/src/admin/navigation.json`.

### 4.4 — Forms

Les forms React restent dans `plugin-medusa-commerce/src/admin/forms/`.
Ils sont servis comme assets statiques et charges par le dashboard via dynamic import.

---

## Ordre d'execution

| Phase | Prerequis | Priorite |
|---|---|---|
| **Phase 0** : Extract dashboard-core | Dashboard Medusa actuel | **HAUTE** — a faire en premier |
| **Phase 1** : dashboard-manta adapter | Phase 0 | **HAUTE** |
| **Phase 2** : Backend registry + admin-config | Core Manta (existant) | **HAUTE** |
| **Phase 3** : Serving SPA depuis Nitro | Phase 1 + adapter-nitro | MOYENNE |
| **Phase 4** : Plugin commerce admin | Phase 0 + Phase 2 | BASSE (peut attendre) |

Phases 0, 1 et 2 peuvent etre faites en parallele une fois la Phase 0 commencee.

---

## Definition of Done

```bash
# 1. Dashboard-core build sans erreur
cd packages/dashboard-core && npm run build

# 2. Dashboard-manta build sans erreur
cd packages/dashboard-manta && npm run build

# 3. Manta demarre et sert le dashboard
cd demo && manta dev
# → http://localhost:9000/admin affiche le shell vide (pas de plugin)

# 4. Avec le plugin commerce, les pages apparaissent
# manta.config.ts: plugins: ["@manta/plugin-medusa-commerce"]
# → Products, Orders, Customers apparaissent dans la nav
# → CRUD fonctionne

# 5. AI peut creer/modifier des pages
# → Les modifications sont sauvees en DB
# → Persistent entre les sessions
# → Scopes user/team/global fonctionnent

# 6. Conformance tests Manta passent toujours
npx vitest run
# 314/314 pass
```
