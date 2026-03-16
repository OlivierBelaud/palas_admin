# Manta Dashboard — Integration avec le framework Manta

## Vue d'ensemble

Ce document decrit comment le dashboard fonctionne au sein du framework Manta :
- Comment Nitro/H3 sert la SPA
- Comment le registry expose les pages/composants des plugins
- Comment le module admin-config persiste les customisations
- Comment un plugin (ex: Medusa commerce) declare son admin UI

---

## 1. Serving — Nitro/H3 sert la SPA

### Dev mode

```
Vite dev server (:5173)     ← Hot reload, HMR
       ↓ proxy /admin/api/* → Nitro (:9000)

Nitro H3 (:9000)
├── /admin/api/*            ← API admin (registry, config, CRUD)
├── /store/api/*            ← API storefront
└── /health/*               ← Health checks
```

Configuration dans `manta.config.ts` :

```typescript
export default defineConfig({
  admin: {
    // En dev : Vite dev server separé, proxy vers l'API
    // En prod : assets statiques servis par Nitro
    path: "/admin",
    build: {
      outDir: ".manta/admin",  // Build output
    },
  },
})
```

### Prod mode

```bash
manta build
# 1. Build le backend (Nitro bundle)
# 2. Build le dashboard (Vite → .manta/admin/)
# 3. Nitro sert les assets statiques
```

Handler H3 pour servir la SPA :

```typescript
// packages/adapter-nitro/src/admin-handler.ts

import { createRouter, defineEventHandler, serveStatic } from "h3"
import { resolve } from "path"

export function createAdminHandler(adminDir: string) {
  return defineEventHandler(async (event) => {
    const path = event.path

    // Essaie de servir un fichier statique
    const filePath = resolve(adminDir, path.replace(/^\/admin\//, ""))
    const stat = await tryReadFile(filePath)
    if (stat) return serveStaticFile(event, filePath)

    // Sinon, sert index.html (SPA fallback)
    return serveStaticFile(event, resolve(adminDir, "index.html"))
  })
}
```

Nitro route :

```typescript
// Dans le bootstrap Nitro
const app = createApp()

// API routes
app.use("/admin/api", adminApiRouter)

// SPA static files (prod)
if (config.appEnv === "prod") {
  app.use("/admin", createAdminHandler(".manta/admin"))
}
```

---

## 2. Registry — Discovery des pages/composants

### Endpoint

```
GET /admin/api/registry
Authorization: Bearer <token>
```

### Response

```typescript
{
  modules: [
    {
      name: "product",
      entity: "product",
      plugin: "@manta/plugin-medusa-commerce",
      endpoints: {
        list: "/admin/api/products",
        detail: "/admin/api/products/:id",
        create: "/admin/api/products",
        update: "/admin/api/products/:id",
        delete: "/admin/api/products/:id"
      }
    },
    {
      name: "analytics",
      entity: "analytics_report",
      plugin: "@manta/plugin-analytics",
      endpoints: {
        list: "/admin/api/analytics/reports",
        detail: "/admin/api/analytics/reports/:id"
      }
    }
  ],

  pages: {
    "products/list": {
      id: "products/list",
      type: "list",
      layout: "single-column",
      route: "/products",
      query: { entity: "product", list: true, pageSize: 20 },
      breadcrumb: { label: "Products" },
      main: ["products-table"]
    },
    // ... toutes les pages de tous les plugins
  },

  components: {
    "products-table": {
      id: "products-table",
      type: "EntityTable",
      props: { ... }
    },
    // ... tous les composants de tous les plugins
  },

  navigation: [
    {
      label: "Products",
      icon: "Tag",
      to: "/products",
      items: [
        { label: "Collections", to: "/collections" },
        { label: "Categories", to: "/categories" }
      ]
    },
    {
      label: "Analytics",
      icon: "ChartBar",
      to: "/analytics"
    }
  ],

  forms: {
    "products/create": {
      type: "react",
      url: "/admin/api/forms/products/create.js"
    },
    "analytics/report/create": {
      type: "json-render",
      spec: { /* FormBlock spec */ }
    }
  }
}
```

### Comment le registry est construit (cote backend)

Au boot de Manta, le framework :

1. Scanne tous les modules (core + plugins + app locale)
2. Pour chaque module qui a un dossier `admin/` :
   - Lit `admin/pages.json` → PageSpecs
   - Lit `admin/components.json` → DataComponents
   - Lit `admin/navigation.json` → NavItems
   - Decouvre les forms dans `admin/forms/`
3. Fusionne tout dans un objet RegistryResponse
4. Expose via `GET /admin/api/registry`

```typescript
// packages/core/src/admin/registry-builder.ts

export class RegistryBuilder {
  private pages: Record<string, PageSpec> = {}
  private components: Record<string, DataComponent> = {}
  private navigation: NavItem[] = []

  /**
   * Enregistre les declarations admin d'un module/plugin.
   * Appele par le bootstrap pour chaque module qui a un dossier admin/.
   */
  register(source: string, declaration: AdminDeclaration) {
    // Pages — le dernier a s'enregistrer gagne (plugins[] order)
    for (const [id, page] of Object.entries(declaration.pages || {})) {
      this.pages[id] = page
    }

    // Components — meme logique
    for (const [id, component] of Object.entries(declaration.components || {})) {
      this.components[id] = component
    }

    // Navigation — merge
    this.navigation.push(...(declaration.navigation || []))
  }

  build(): RegistryResponse {
    return {
      modules: this.modules,
      pages: this.pages,
      components: this.components,
      navigation: this.deduplicateNav(this.navigation),
      forms: this.forms,
    }
  }
}
```

### Priorite de resolution dans le registry

```
App locale (src/admin/)     ← toujours prioritaire
Plugin N (dernier dans plugins[])
Plugin N-1
...
Plugin 1 (premier dans plugins[])
```

Strict mode : conflit de page ID = erreur au boot.
Normal mode : conflit = warning, last-wins.

---

## 3. Module admin-config — Persistance des customisations

### Modele de donnees (DML)

```typescript
// packages/module-admin-config/src/models/admin-override.ts

import { model } from "@manta/core"

const AdminOverride = model.define("AdminOverride", {
  id: model.id({ prefix: "ao" }),

  /** Scope: qui voit cet override */
  scope: model.enum(["user", "team", "global"]),

  /** User qui a cree l'override (null si global) */
  user_id: model.text().nullable(),

  /** Team associee (null si user ou global) */
  team_id: model.text().nullable(),

  /** Type d'override */
  type: model.enum(["component", "page", "navigation", "custom_page"]),

  /** ID de la resource ciblee (component ID, page ID, ou "navigation") */
  target_id: model.text(),

  /** Le JSON de l'override */
  payload: model.json(),

  /** Actif ou non */
  active: model.boolean().default(true),

  /** Metadata (ex: description, created_by AI, etc.) */
  metadata: model.json().nullable(),
})

export default AdminOverride
```

### API routes

```
# Recuperer tous les overrides de l'utilisateur courant (resolus par scope)
GET /admin/api/config/overrides
→ 200 { overrides: Overrides }

# Sauvegarder un override
PUT /admin/api/config/overrides
Body: { type, target_id, payload, scope? }
→ 200 { override: AdminOverride }

# Supprimer un override
DELETE /admin/api/config/overrides/:id
→ 200

# Partager un override avec l'equipe
POST /admin/api/config/overrides/:id/share
Body: { scope: "team", team_id: "team_123" }
→ 200

# Lister les templates partages
GET /admin/api/config/templates
→ 200 { templates: AdminOverride[] }
```

### Resolution des overrides par scope

```typescript
// packages/module-admin-config/src/service.ts

export class AdminConfigService {
  /**
   * Recupere les overrides resolus pour un utilisateur.
   * Priorite: user > team > global
   */
  async getResolvedOverrides(userId: string, teamId?: string): Promise<Overrides> {
    // 1. Fetch tous les overrides applicables
    const overrides = await this.repository.find({
      where: {
        active: true,
        $or: [
          { scope: "global" },
          { scope: "team", team_id: teamId },
          { scope: "user", user_id: userId },
        ],
      },
      order: { scope: "ASC" },  // global < team < user
    })

    // 2. Merge par priorite (user ecrase team ecrase global)
    const result = emptyOverrides()
    for (const override of overrides) {
      this.applyOverride(result, override)
    }

    return result
  }
}
```

---

## 4. Comment un plugin declare son admin UI

### Structure d'un plugin avec admin

```
@manta/plugin-medusa-commerce/
├── package.json
├── src/
│   ├── modules/
│   │   ├── product/
│   │   │   ├── models/
│   │   │   ├── service.ts
│   │   │   └── index.ts
│   │   ├── order/
│   │   └── ...
│   │
│   ├── api/
│   │   └── admin/
│   │       ├── products/
│   │       │   └── route.ts
│   │       └── orders/
│   │           └── route.ts
│   │
│   └── admin/                      ← Declarations admin UI
│       ├── pages.json              ← PageSpecs
│       ├── components.json         ← DataComponents
│       ├── navigation.json         ← NavItems
│       └── forms/                  ← React components pour les forms
│           ├── products/
│           │   ├── create.tsx
│           │   └── edit.tsx
│           └── orders/
│               └── edit.tsx
│
└── index.ts                        ← definePlugin()
```

### definePlugin avec admin

```typescript
// index.ts

import { definePlugin } from "@manta/core"

export default definePlugin({
  name: "@manta/plugin-medusa-commerce",
  version: "0.1.0",

  modules: [
    import("./modules/product"),
    import("./modules/order"),
    // ...
  ],

  // Declaration admin UI
  admin: {
    // Chemin vers le dossier admin/ (relatif au package)
    path: "./src/admin",

    // Alternative: declaration inline
    pages: { /* ... */ },
    components: { /* ... */ },
    navigation: [ /* ... */ ],
  },
})
```

### pages.json d'un plugin

```json
{
  "products/list": {
    "id": "products/list",
    "type": "list",
    "layout": "single-column",
    "route": "/products",
    "query": {
      "entity": "product",
      "list": true,
      "pageSize": 20,
      "fields": "*variants,*collection,*sales_channels"
    },
    "breadcrumb": { "label": "Products" },
    "main": ["products-table"]
  },
  "products/detail": {
    "id": "products/detail",
    "type": "detail",
    "layout": "two-column",
    "route": "/products/:id",
    "query": {
      "entity": "product",
      "id": { "$state": "/route/params/id" },
      "fields": "*variants,*collection,*sales_channels,*images,*tags,*type"
    },
    "breadcrumb": { "label": "Product", "field": "title" },
    "main": [
      "products-general",
      "products-variants",
      "products-media"
    ],
    "sidebar": [
      "products-status",
      "products-organization"
    ]
  }
}
```

### components.json d'un plugin

```json
{
  "products-table": {
    "id": "products-table",
    "type": "EntityTable",
    "props": {
      "title": "Products",
      "columns": [
        { "key": "title", "label": "Title", "sortable": true },
        { "key": "collection.title", "label": "Collection" },
        { "key": "status", "label": "Status", "format": "badge" }
      ],
      "rowLink": "/products/:id",
      "searchable": true
    }
  },
  "products-general": {
    "id": "products-general",
    "type": "InfoCard",
    "props": {
      "title": "General",
      "fields": [
        { "key": "description", "label": "Description", "type": "text" },
        { "key": "subtitle", "label": "Subtitle", "type": "text" },
        { "key": "handle", "label": "Handle", "type": "text" }
      ],
      "actions": [
        { "label": "Edit", "icon": "PencilSquare", "to": "/products/:id/edit" }
      ]
    }
  }
}
```

### navigation.json d'un plugin

```json
[
  {
    "label": "Orders",
    "icon": "ShoppingCart",
    "to": "/orders"
  },
  {
    "label": "Products",
    "icon": "Tag",
    "to": "/products",
    "items": [
      { "label": "Collections", "to": "/collections" },
      { "label": "Categories", "to": "/categories" },
      { "label": "Gift Cards", "to": "/gift-cards" }
    ]
  },
  {
    "label": "Customers",
    "icon": "Users",
    "to": "/customers",
    "items": [
      { "label": "Groups", "to": "/customer-groups" }
    ]
  },
  {
    "label": "Inventory",
    "icon": "Buildings",
    "to": "/inventory",
    "items": [
      { "label": "Reservations", "to": "/reservations" }
    ]
  },
  {
    "label": "Promotions",
    "icon": "Receipt",
    "to": "/promotions",
    "items": [
      { "label": "Campaigns", "to": "/campaigns" }
    ]
  }
]
```

---

## 5. Cycle de vie complet — Du boot au rendu

### 1. Boot Manta (backend)

```
manta dev / manta start
   |
   ├── 1. Load config (manta.config.ts)
   ├── 2. Discover modules + plugins
   ├── 3. Register modules in container
   ├── 4. For each module with admin/:
   │       registry.register(moduleName, adminDeclaration)
   ├── 5. Build registry
   ├── 6. Mount API routes
   │       ├── /admin/api/registry      → RegistryHandler
   │       ├── /admin/api/config/*      → AdminConfigHandler
   │       └── /admin/api/{entity}/*    → Module CRUD handlers
   ├── 7. Mount admin SPA handler (prod: static, dev: proxy)
   └── 8. Start listening on :9000
```

### 2. Boot Dashboard (frontend)

```
User navigates to /admin
   |
   ├── 1. Load MantaDashboard component
   ├── 2. MantaAuth.isAuthenticated()?
   │       ├── No → Show LoginPage
   │       └── Yes → Continue
   ├── 3. RegistryClient.fetch()
   │       → GET /admin/api/registry
   │       → Receive pages, components, navigation, modules
   ├── 4. MantaDataSource.loadFromRegistry(registry)
   │       → Build dynamic entityToEndpoint map
   ├── 5. ApiOverrideStore.initialize()
   │       → GET /admin/api/config/overrides
   │       → Hydrate cache local with user overrides
   ├── 6. Build DashboardConfig
   ├── 7. Mount DashboardProvider
   │       → DataSource, Auth, OverrideStore, AI contexts
   ├── 8. Build routes dynamically from registry.pages
   ├── 9. Render Shell
   │       → Sidebar with registry.navigation + override nav
   │       → Router with dynamic routes
   └── 10. Ready
```

### 3. Navigation vers une page

```
User clicks "Products" in sidebar
   |
   ├── 1. React Router matches /products
   ├── 2. Route renders SpecRenderer with pageSpec = registry.pages["products/list"]
   ├── 3. SpecRenderer resolves spec via resolver
   │       → Check overrides (AI modifications?)
   │       → Return final spec
   ├── 4. SpecRenderer builds fetch URL
   │       → dataSource.entityToEndpoint("product") → "/admin/api/products"
   │       → Add query params (fields, limit, offset)
   ├── 5. useQuery fetches data
   │       → dataSource.fetch("/admin/api/products", params)
   │       → JWT Bearer auth header added by MantaAuth
   ├── 6. Data returned → resolve component refs
   │       → resolver.resolveComponent("products-table")
   │       → Return DataComponent (with any overrides applied)
   ├── 7. getRenderer("EntityTable") → EntityTableRenderer
   ├── 8. Render table with data
   └── 9. Display
```

### 4. AI modifie une page

```
User opens AI panel, types: "Add a price column to the products table"
   |
   ├── 1. Message sent to AI endpoint
   ├── 2. AI analyzes current spec + block schemas
   ├── 3. AI returns tool call: modify_component("products-table", newSpec)
   ├── 4. AiChat applies: overrideStore.setComponentOverride("products-table", newSpec)
   ├── 5. ApiOverrideStore:
   │       ├── Update cache local
   │       ├── Bump version (pub/sub)
   │       └── Schedule debounced save → PUT /admin/api/config/overrides
   ├── 6. SpecRenderer detects version change (useSyncExternalStore)
   ├── 7. Re-resolve component → picks up override
   ├── 8. Re-render table with new column
   └── 9. Backend saves to DB (debounced 1s)
```

---

## 6. Serving des forms React (cas avance)

Les forms complexes (create product, edit order) sont du React, pas du JSON-Render.

### Option A : Forms embarques dans le plugin (recommande)

Le plugin build ses forms en tant que chunks JS separés :

```typescript
// @manta/plugin-medusa-commerce/admin/forms/products/create.tsx
export default function ProductCreateForm({ onClose }: { onClose: () => void }) {
  // React form classique
}
```

Au build du plugin, ces forms deviennent des assets statiques :
```
.manta/plugins/medusa-commerce/admin/forms/products/create.js
```

Le registry les reference :
```json
{
  "forms": {
    "products/create": {
      "type": "react",
      "url": "/_plugins/medusa-commerce/admin/forms/products/create.js"
    }
  }
}
```

Le dashboard les charge via dynamic import :
```typescript
const Form = lazy(() => import(/* @vite-ignore */ formUrl))
```

### Option B : FormBlock JSON-Render (pour les forms simples)

Pour les CRUD basiques, un 11eme block type `FormBlock` :

```json
{
  "type": "FormBlock",
  "props": {
    "title": "Create Report",
    "action": { "method": "POST", "endpoint": "/admin/api/reports" },
    "fields": [
      { "key": "title", "label": "Title", "input": "text", "required": true },
      { "key": "type", "label": "Type", "input": "select", "options": ["daily", "weekly", "monthly"] },
      { "key": "description", "label": "Description", "input": "textarea" }
    ],
    "validation": {
      "title": { "min": 1, "max": 255 },
      "type": { "enum": ["daily", "weekly", "monthly"] }
    }
  }
}
```

Pas besoin de React custom. L'AI peut generer ces forms directement.

---

## 7. Theme et branding

Le dashboard supporte un theming basique via la config :

```typescript
// manta.config.ts
export default defineConfig({
  admin: {
    theme: {
      title: "My App Admin",
      logo: "/assets/logo.svg",
      favicon: "/assets/favicon.ico",
      colors: {
        primary: "#6366f1",
        sidebar: "#1e1b4b",
      },
    },
  },
})
```

Le theme est passe au dashboard via le registry ou la config Manta.

---

## 8. Resume des endpoints admin

| Endpoint | Method | Description |
|---|---|---|
| `/admin/api/registry` | GET | Discovery: pages, components, navigation, modules |
| `/admin/api/config/overrides` | GET | Overrides resolus pour l'user courant |
| `/admin/api/config/overrides` | PUT | Sauvegarder un override |
| `/admin/api/config/overrides/:id` | DELETE | Supprimer un override |
| `/admin/api/config/overrides/:id/share` | POST | Partager avec l'equipe |
| `/admin/api/config/templates` | GET | Templates partages |
| `/admin/api/me` | GET | User courant |
| `/admin/api/{entity}` | GET | List entities (CRUD) |
| `/admin/api/{entity}/:id` | GET | Get entity detail |
| `/admin/api/{entity}` | POST | Create entity |
| `/admin/api/{entity}/:id` | PUT | Update entity |
| `/admin/api/{entity}/:id` | DELETE | Delete entity |
| `/auth/login` | POST | Login (JWT) |
| `/auth/logout` | POST | Logout |
