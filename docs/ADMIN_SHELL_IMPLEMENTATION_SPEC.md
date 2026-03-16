# Manta Admin Shell — Implementation Spec

**Version 1.0 — March 2026**
**Source**: `manta-admin-shell-spec.md` (vision) → this document (implementation)

---

## 0. Context & Reality Check

### What exists today (built & tested)

| Layer | Package | Status |
|-------|---------|--------|
| DML (11 types, 5 relations) | `@manta/core` | ✅ Complete |
| Port interfaces (20 ports) | `@manta/core` | ✅ Complete |
| Container/DI (Awilix + ALS) | `@manta/core` | ✅ Complete |
| Module system (defineModule, loaders) | `@manta/core` | ✅ Complete |
| QueryService (graph + index) | `@manta/core` | ✅ Complete |
| createService() (7 CRUD methods) | `@manta/core` | ✅ Complete |
| HTTP adapter (Nitro + 12-step pipeline) | `@manta/adapter-nitro` | ✅ Complete |
| DB adapter (Drizzle + PG) | `@manta/adapter-drizzle-pg` | ✅ Complete |
| Logger adapter (Pino) | `@manta/adapter-logger-pino` | ✅ Complete |
| CLI (dev, build, db, exec) | `@manta/cli` | ✅ Complete |
| Demo app (Product + Inventory CRUD) | `demo/` | ✅ Complete |
| 314 conformance tests | `@manta/test-utils` | ✅ Passing |

### What the vision spec describes

The `manta-admin-shell-spec.md` describes a 5-layer architecture with json-render, AI SDK, and a 3-level override system. It's a solid vision but several points need grounding against the real codebase.

### Key gaps between vision and reality

| # | Gap | Impact |
|---|-----|--------|
| G1 | **DML has no TypeScript generics** — `defineAdminManifest<ProductModule>()` can't type-check columns against DML at compile time. DML uses runtime checks (`DmlEntity.isProperty()`), not TS generic inference. | Rethink type safety approach |
| G2 | **No admin API surface defined** — The spec says "introspection API" but doesn't specify the full REST contract between frontend Shell and backend. | Must define CRUD + introspection endpoints |
| G3 | **json-render catalog ↔ Manta data binding** — How does a `DataTable` component fetch data? The spec shows static JSON but not the runtime data flow. | Must define DataProvider integration |
| G4 | **Auth gate unclear** — The spec mentions `AuthPort` with `getCurrentUser()` but IAuthPort only has `verifyJwt/verifyApiKey/createJwt`. No `getCurrentUser()`. | Must map to real auth interfaces |
| G5 | **Module manifest discovery** — The spec says "modules export manifests" but `ModuleExports` has no `adminManifest` field. | Must extend module interface |
| G6 | **Config `admin` field is untyped** — `Record<string, unknown>`. No structured config for Shell behavior. | Must type the admin config |
| G7 | **eject command missing** — CLI has dev/build/db/exec but no `manta eject`. | Must add to CLI |

---

## 1. Architecture (revised)

### 1.1 Package Map

```
packages/
├── admin-sdk/                     ← NEW — Backend SDK for admin
│   └── src/
│       ├── index.ts               ← Re-exports
│       ├── manifest.ts            ← defineAdminManifest()
│       ├── introspection.ts       ← buildIntrospectionSchema()
│       ├── types.ts               ← All admin types
│       └── extend.ts              ← extendAdmin()
│
├── admin-store/                   ← NEW — Manta module (persists overrides)
│   └── src/
│       ├── index.ts               ← Module() export
│       ├── models/
│       │   ├── page-override.ts   ← DML: admin_page_override
│       │   ├── custom-page.ts     ← DML: admin_custom_page
│       │   ├── nav-override.ts    ← DML: admin_navigation_override
│       │   └── user-pref.ts       ← DML: admin_user_preference
│       ├── service.ts             ← AdminStoreService
│       └── api/                   ← Admin API routes
│           ├── overrides/route.ts
│           ├── custom-pages/route.ts
│           ├── introspect/route.ts
│           └── manifests/route.ts
│
├── admin-catalog/                 ← NEW — json-render catalog definition
│   └── src/
│       ├── index.ts               ← Re-exports catalog + components
│       ├── catalog.ts             ← defineCatalog() with all Manta components
│       ├── components/            ← Component schemas (Zod)
│       │   ├── data-table.ts
│       │   ├── detail-page.ts
│       │   ├── form-page.ts
│       │   ├── metric-card.ts
│       │   ├── chart.ts
│       │   ├── layout.ts
│       │   └── common.ts
│       └── actions.ts             ← Action schemas (navigate, workflow, etc.)
│
├── admin-shell/                   ← NEW — React Shell application
│   └── src/
│       ├── index.ts               ← <AdminShell /> export
│       ├── shell.tsx              ← Main Shell component
│       ├── router.ts              ← TanStack Router setup
│       ├── auth/
│       │   ├── auth-gate.tsx      ← Auth wrapper
│       │   └── auth-context.ts    ← React context for auth
│       ├── layout/
│       │   ├── sidebar.tsx
│       │   ├── topbar.tsx
│       │   └── content.tsx
│       ├── merger/
│       │   ├── spec-merger.ts     ← 4-layer merge pipeline
│       │   └── cache.ts           ← Merge result caching
│       ├── data/
│       │   ├── data-provider.ts   ← json-render DataProvider → Manta API
│       │   ├── query-client.ts    ← TanStack Query setup
│       │   └── api-client.ts      ← Typed fetch wrapper
│       ├── ai/
│       │   ├── assistant.tsx      ← AI panel component
│       │   ├── system-prompt.ts   ← Introspection → LLM context
│       │   └── actions.ts         ← AI tool definitions
│       └── renderers/             ← json-render component implementations
│           ├── data-table.tsx
│           ├── detail-page.tsx
│           ├── form-page.tsx
│           ├── metric-card.tsx
│           └── chart.tsx
```

### 1.2 Dependency Graph

```
@manta/admin-shell (React app)
├── @manta/admin-catalog (catalog schemas)
│   └── @json-render/core (spec format, Zod)
├── @json-render/react (renderer)
├── @tanstack/react-router
├── @tanstack/react-query
├── ai (Vercel AI SDK)
└── ai-elements (Vercel AI Elements)

@manta/admin-sdk (backend, framework-agnostic)
├── @manta/core (ports, DML, module)
└── zod

@manta/admin-store (Manta module, backend)
├── @manta/core
└── @manta/admin-sdk
```

### 1.3 Separation principle

**Backend packages** (`admin-sdk`, `admin-store`) have zero React/Vue dependency.
**Frontend packages** (`admin-catalog`, `admin-shell`) have zero Manta core dependency.
**The only bridge is HTTP** — the Shell calls REST endpoints exposed by admin-store.

This is critical: the admin Shell is a **standalone SPA** that talks to Manta via `fetch()`. It does NOT import `@manta/core` or run on the server. This enables the same Shell to work with Next.js SSR, Nuxt, or standalone — the backend is always the same REST API.

---

## 2. The Connector: `@manta/admin-sdk`

This is the "admin framework connector" — the backend package that bridges Manta modules to the admin frontend.

### 2.1 `defineAdminManifest()` — Revised Type Safety

**Problem**: The vision spec uses `defineAdminManifest<ProductModule>()` with TypeScript generics to validate column names. But the DML uses runtime-checked interfaces (`DmlPropertyDefinition`), not TS generic inference. `DmlEntity` doesn't carry field names as type parameters.

**Solution**: Runtime validation + IDE support via a different mechanism.

```typescript
// packages/admin-sdk/src/manifest.ts

import type { DmlEntity } from '@manta/core'

/**
 * Option A — Entity-aware at runtime, not compile time.
 * The function validates field names at build time via the CLI,
 * not via TypeScript generics.
 */
export function defineAdminManifest(
  entity: DmlEntity,
  config: AdminManifestConfig
): AdminManifest {
  // Runtime: validate that all referenced fields exist in entity.schema
  for (const page of Object.values(config.pages)) {
    if (page.columns) {
      for (const col of page.columns) {
        const key = typeof col === 'string' ? col : col.key
        if (!resolveField(entity, key)) {
          throw new Error(
            `Field "${key}" does not exist on entity "${entity.name}". ` +
            `Available fields: ${Object.keys(entity.schema).join(', ')}`
          )
        }
      }
    }
  }

  // Compile to json-render spec
  return compileManifest(entity, config)
}

/**
 * Option B — For strict TS inference (future).
 * Requires DML refactor to carry field names as generic params:
 *   const Product = model.define('Product', { ... })
 *   // Product is DmlEntity<{ title: DmlText, price: DmlBigNumber, ... }>
 *   defineAdminManifest(Product, { columns: ['title'] })
 *   // TS infers valid columns from the generic
 *
 * This is a Phase 2 goal — requires DML type system refactor.
 */
```

**Recommendation**: Ship with Option A (runtime validation) for Phase 1. The CLI's `manta build` step validates manifests. Add a `manta admin:validate` command that checks all manifests against DML entities at dev time (instant feedback, no type gymnastics).

### 2.2 AdminManifestConfig Type

```typescript
// packages/admin-sdk/src/types.ts

export interface AdminManifestConfig {
  /** Module name (auto-set if used with defineModule) */
  module?: string

  /** Navigation entries for the sidebar */
  navigation?: AdminNavEntry[]

  /** Page definitions keyed by route path */
  pages: Record<string, AdminPageConfig>
}

export interface AdminNavEntry {
  label: string              // i18n key or string
  icon?: string              // Icon name (from Lucide or custom set)
  path: string               // Route path (e.g., '/products')
  position?: number          // Sort order (default 100)
  children?: AdminNavEntry[] // Sub-menu items
  requiredPermissions?: string[] // RBAC
}

// Union type for different page kinds
export type AdminPageConfig =
  | AdminListPageConfig
  | AdminDetailPageConfig
  | AdminFormPageConfig
  | AdminCustomPageConfig

export interface AdminListPageConfig {
  type: 'list'
  entity: string
  title?: string

  /** Column definitions — string shorthand or full config */
  columns: Array<string | AdminColumnConfig>

  /** Searchable fields */
  searchable?: string[]

  /** Filter definitions */
  filters?: AdminFilterConfig[]

  /** Default sort */
  defaultSort?: { field: string; direction: 'asc' | 'desc' }

  /** Enable/disable features */
  pagination?: boolean | { defaultPageSize?: number }
  bulkActions?: AdminBulkAction[]
  rowActions?: AdminRowAction[]

  /** Create button config */
  createAction?: { label?: string; formPage?: string } | false
}

export interface AdminColumnConfig {
  key: string                 // Field path (supports dot notation: 'vendor.name')
  label?: string              // i18n key or display string
  type?: ColumnType           // Rendering hint
  sortable?: boolean          // Default: true for primitive types
  width?: number | string     // CSS width
  format?: string             // Format string (e.g., 'currency:EUR')

  /**
   * Component override (Level 2).
   * Returns a dynamic import — NOT a React component directly.
   * This keeps the manifest serializable.
   */
  component?: () => Promise<{ default: unknown }>
}

export type ColumnType =
  | 'text' | 'number' | 'currency' | 'date' | 'datetime'
  | 'badge' | 'boolean' | 'image' | 'link' | 'json'
  | 'relation'  // Auto-renders linked entity name

export interface AdminFilterConfig {
  key: string
  type: 'text' | 'select' | 'multiselect' | 'date-range' | 'number-range' | 'boolean' | 'relation'
  label?: string
  /** For select/multiselect: static options or query to fetch them */
  options?: Array<{ label: string; value: string }> | { query: string }
}

export interface AdminBulkAction {
  key: string
  label: string
  workflow?: string           // Workflow to execute
  confirm?: boolean | string  // Confirmation dialog
  variant?: 'default' | 'destructive'
}

export interface AdminRowAction {
  key: string
  label: string
  icon?: string
  workflow?: string
  navigateTo?: string         // e.g., '/products/{id}'
  confirm?: boolean | string
  variant?: 'default' | 'destructive'
}

export interface AdminDetailPageConfig {
  type: 'detail'
  entity: string
  title?: string

  /** Sections to display */
  sections: AdminDetailSection[]

  /** Actions available on the detail page */
  actions?: AdminRowAction[]

  /** Related entities to show as tabs or sections */
  relations?: AdminRelationConfig[]
}

export interface AdminDetailSection {
  title?: string
  columns?: 1 | 2 | 3        // Grid columns for the section
  fields: Array<string | AdminFieldConfig>
}

export interface AdminFieldConfig {
  key: string
  label?: string
  type?: ColumnType
  span?: number               // Grid column span
  format?: string
  component?: () => Promise<{ default: unknown }>
}

export interface AdminRelationConfig {
  entity: string
  title?: string
  type: 'tab' | 'section' | 'inline'
  columns?: Array<string | AdminColumnConfig>
  limit?: number
}

export interface AdminFormPageConfig {
  type: 'form'
  entity: string
  title?: string
  mode: 'create' | 'edit' | 'both'

  /** Fields in the form */
  fields: Array<string | AdminFormFieldConfig>

  /** Layout sections */
  sections?: AdminFormSection[]

  /** Workflow to call on submit (default: create{Entity} or update{Entity}) */
  submitWorkflow?: string

  /** Redirect after submit */
  redirectTo?: string
}

export interface AdminFormFieldConfig {
  key: string
  label?: string
  type?: FormFieldType
  placeholder?: string
  required?: boolean          // Default: inferred from DML (nullable = not required)
  validation?: unknown        // Zod schema (serialized)
  options?: Array<{ label: string; value: string }> | { query: string }
  defaultValue?: unknown
  helpText?: string
  span?: number               // Grid column span
  component?: () => Promise<{ default: unknown }>
}

export type FormFieldType =
  | 'text' | 'textarea' | 'number' | 'currency'
  | 'select' | 'multiselect' | 'checkbox' | 'toggle'
  | 'date' | 'datetime' | 'file' | 'image'
  | 'json' | 'richtext' | 'relation'

export interface AdminFormSection {
  title?: string
  description?: string
  columns?: 1 | 2
  fields: string[]            // Field keys to include in this section
}

export interface AdminCustomPageConfig {
  type: 'custom'
  title?: string
  /** Raw json-render spec — for AI-generated or fully custom pages */
  spec: JsonRenderSpec
}
```

### 2.3 Manifest Compilation (DML → json-render)

```typescript
// packages/admin-sdk/src/manifest.ts

function compileManifest(entity: DmlEntity, config: AdminManifestConfig): AdminManifest {
  const pages: Record<string, JsonRenderSpec> = {}

  for (const [path, pageConfig] of Object.entries(config.pages)) {
    switch (pageConfig.type) {
      case 'list':
        pages[path] = compileListPage(entity, pageConfig)
        break
      case 'detail':
        pages[path] = compileDetailPage(entity, pageConfig)
        break
      case 'form':
        pages[path] = compileFormPage(entity, pageConfig)
        break
      case 'custom':
        pages[path] = pageConfig.spec
        break
    }
  }

  return {
    module: config.module ?? entity.name.toLowerCase(),
    navigation: config.navigation ?? [],
    pages,
  }
}

function compileListPage(entity: DmlEntity, config: AdminListPageConfig): JsonRenderSpec {
  const columns = config.columns.map(col => {
    if (typeof col === 'string') {
      const prop = entity.schema[col]
      return {
        key: col,
        label: `${entity.name.toLowerCase()}.fields.${col}`,
        type: inferColumnType(prop),
        sortable: isPrimitive(prop),
      }
    }
    return col
  })

  return {
    root: `page-${entity.name.toLowerCase()}-list`,
    elements: {
      [`page-${entity.name.toLowerCase()}-list`]: {
        type: 'DataTable',
        props: {
          entity: entity.name.toLowerCase(),
          columns,
          searchable: config.searchable ?? [],
          filters: config.filters ?? [],
          pagination: config.pagination ?? true,
          bulkActions: config.bulkActions ?? [],
          rowActions: config.rowActions ?? [],
          createAction: config.createAction ?? { formPage: `${entity.name.toLowerCase()}/create` },
          defaultSort: config.defaultSort,
        },
      },
    },
  }
}
```

### 2.4 Convention Defaults (Zero-Config)

A module that defines DML entities gets admin pages **automatically** if no manifest is provided:

```typescript
// packages/admin-sdk/src/manifest.ts

export function generateDefaultManifest(entity: DmlEntity): AdminManifest {
  const name = entity.name.toLowerCase()
  const fields = Object.entries(entity.schema)
    .filter(([_, v]) => DmlEntity.isProperty(v))

  const columns = fields
    .filter(([key]) => !['created_at', 'updated_at', 'deleted_at'].includes(key))
    .slice(0, 6) // Max 6 columns in default view
    .map(([key]) => key)

  const filterableFields = fields
    .filter(([_, prop]) => prop.type === 'enum' || prop.type === 'boolean')
    .map(([key, prop]) => ({
      key,
      type: prop.type === 'enum' ? 'select' as const : 'boolean' as const,
      options: prop.type === 'enum' && prop.values
        ? (prop.values as string[]).map(v => ({ label: v, value: v }))
        : undefined,
    }))

  const searchableFields = fields
    .filter(([_, prop]) => prop.searchable || prop.type === 'text')
    .slice(0, 3)
    .map(([key]) => key)

  return defineAdminManifest(entity, {
    module: name,
    navigation: [{
      label: `${name}.nav.label`,
      icon: 'Box', // Default Lucide icon
      path: `/${name}s`,
    }],
    pages: {
      [`${name}s/list`]: {
        type: 'list',
        entity: name,
        columns,
        searchable: searchableFields,
        filters: filterableFields,
      },
      [`${name}s/[id]`]: {
        type: 'detail',
        entity: name,
        sections: [{
          fields: fields.map(([key]) => key),
          columns: 2,
        }],
      },
      [`${name}s/create`]: {
        type: 'form',
        entity: name,
        mode: 'create',
        fields: fields
          .filter(([key]) => key !== 'id' && !['created_at', 'updated_at', 'deleted_at'].includes(key))
          .map(([key]) => key),
      },
      [`${name}s/[id]/edit`]: {
        type: 'form',
        entity: name,
        mode: 'edit',
        fields: fields
          .filter(([key]) => key !== 'id' && !['created_at', 'updated_at', 'deleted_at'].includes(key))
          .map(([key]) => key),
      },
    },
  })
}
```

### 2.5 `extendAdmin()` — Patch DSL

```typescript
// packages/admin-sdk/src/extend.ts

export interface AdminPatch {
  [pagePath: string]: {
    columns?: {
      append?: Array<string | AdminColumnConfig>
      prepend?: Array<string | AdminColumnConfig>
      hide?: string[]
      reorder?: string[]
      override?: Record<string, Partial<AdminColumnConfig>>
    }
    filters?: {
      append?: AdminFilterConfig[]
      remove?: string[]
    }
    fields?: {
      append?: Array<string | AdminFormFieldConfig>
      hide?: string[]
      override?: Record<string, Partial<AdminFormFieldConfig>>
    }
    sections?: {
      append?: AdminDetailSection[]
      remove?: string[]
    }
    bulkActions?: {
      append?: AdminBulkAction[]
      remove?: string[]
    }
    /** Replace entire page with raw spec */
    replace?: JsonRenderSpec
  }
}

export function extendAdmin(patches: AdminPatch): AdminPatch {
  // Validation only — returns the patch for the merger to apply at runtime
  return patches
}
```

### 2.6 `buildIntrospectionSchema()` — DML → Schema for AI

```typescript
// packages/admin-sdk/src/introspection.ts

import type { DmlEntity } from '@manta/core'

export interface IntrospectionSchema {
  entities: Record<string, EntitySchema>
}

export interface EntitySchema {
  module: string
  fields: Record<string, FieldSchema>
  relations: Record<string, RelationSchema>
  queries: string[]       // Auto: ['list{Entity}s', 'get{Entity}']
  workflows: string[]     // Auto: ['create{Entity}', 'update{Entity}', 'delete{Entity}']
}

export interface FieldSchema {
  type: string            // 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'json' | 'array'
  primary?: boolean
  nullable?: boolean
  searchable?: boolean
  sortable?: boolean      // true for primitive non-json types
  filterable?: boolean    // true for enum, boolean, date, number
  values?: string[]       // For enums
  computed?: boolean
}

export interface RelationSchema {
  entity: string
  type: 'hasOne' | 'hasMany' | 'belongsTo' | 'manyToMany'
  through?: string        // Link table for manyToMany
}

/**
 * Builds the introspection schema from all registered modules.
 * Called once at boot, cached, invalidated on module change.
 */
export function buildIntrospectionSchema(
  modules: Array<{ name: string; models?: Record<string, DmlEntity> }>,
  links: Array<{ leftEntity: string; rightEntity: string; tableName: string }>
): IntrospectionSchema {
  const entities: Record<string, EntitySchema> = {}

  for (const mod of modules) {
    if (!mod.models) continue

    for (const [modelKey, entity] of Object.entries(mod.models)) {
      const fields: Record<string, FieldSchema> = {}
      const relations: Record<string, RelationSchema> = {}

      for (const [key, def] of Object.entries(entity.schema)) {
        if (DmlEntity.isProperty(def)) {
          fields[key] = {
            type: mapDmlTypeToIntrospection(def.type),
            primary: def.primaryKey,
            nullable: def.nullable,
            searchable: def.searchable,
            sortable: isPrimitiveSortable(def.type),
            filterable: isFilterable(def.type),
            values: def.type === 'enum' ? (def.values as string[]) : undefined,
            computed: def.computed,
          }
        } else if (DmlEntity.isRelation(def)) {
          relations[key] = {
            entity: def.target,
            type: def.type as RelationSchema['type'],
          }
        }
      }

      const entityName = entity.name.toLowerCase()

      // Add link-based relations
      for (const link of links) {
        if (link.leftEntity === entityName || link.rightEntity === entityName) {
          const targetEntity = link.leftEntity === entityName
            ? link.rightEntity : link.leftEntity
          relations[targetEntity] = {
            entity: targetEntity,
            type: 'manyToMany',
            through: link.tableName,
          }
        }
      }

      entities[entityName] = {
        module: mod.name,
        fields,
        relations,
        queries: [`list${entity.name}s`, `get${entity.name}`],
        workflows: [`create${entity.name}`, `update${entity.name}`, `delete${entity.name}`],
      }
    }
  }

  return { entities }
}

function mapDmlTypeToIntrospection(dmlType: string): string {
  const map: Record<string, string> = {
    text: 'string',
    number: 'number',
    float: 'number',
    bigNumber: 'number',
    serial: 'number',
    boolean: 'boolean',
    dateTime: 'date',
    json: 'json',
    enum: 'enum',
    array: 'array',
    id: 'string',
  }
  return map[dmlType] ?? 'string'
}
```

### 2.7 Module Integration — Extending `ModuleExports`

```typescript
// Extends packages/core/src/module/index.ts

export interface ModuleExports {
  name: string
  service: new (...args: unknown[]) => unknown
  loaders?: Array<(container: IContainer) => Promise<void>>
  models?: Record<string, unknown>

  // NEW — Admin manifest (optional)
  adminManifest?: AdminManifest

  // ... existing fields
}
```

When `adminManifest` is not provided but `models` is, the framework calls `generateDefaultManifest()` for each model. This gives zero-config admin pages.

---

## 3. Backend API Surface: `@manta/admin-store`

### 3.1 DML Models

```typescript
// packages/admin-store/src/models/page-override.ts
const AdminPageOverride = model.define('AdminPageOverride', {
  id: model.id({ prefix: 'apo' }),
  page_key: model.text().indexed(),          // e.g., 'products/list'
  module: model.text().indexed(),             // e.g., 'product'
  patch: model.json(),                        // AdminPatch JSON
  created_by: model.text().setNullable(),     // User ID who created
  tenant_id: model.text().setNullable().indexed(), // Multi-tenant
})

// packages/admin-store/src/models/custom-page.ts
const AdminCustomPage = model.define('AdminCustomPage', {
  id: model.id({ prefix: 'acp' }),
  title: model.text(),
  path: model.text().setUnique(),             // Route path
  spec: model.json(),                          // Full json-render spec
  source: model.enum(['ai', 'manual']),
  created_by: model.text().setNullable(),
  tenant_id: model.text().setNullable().indexed(),
})

// packages/admin-store/src/models/nav-override.ts
const AdminNavigationOverride = model.define('AdminNavigationOverride', {
  id: model.id({ prefix: 'ano' }),
  action: model.enum(['add', 'remove', 'reorder', 'hide']),
  target: model.text(),                        // Nav entry path
  config: model.json().setNullable(),          // New entry config or reorder data
  position: model.number().setNullable(),
  tenant_id: model.text().setNullable().indexed(),
})

// packages/admin-store/src/models/user-pref.ts
const AdminUserPreference = model.define('AdminUserPreference', {
  id: model.id({ prefix: 'aup' }),
  user_id: model.text().indexed(),
  page_key: model.text().indexed(),
  preferences: model.json(),                   // Column widths, default filters, etc.
})
```

### 3.2 REST API Endpoints

All under `/admin/_admin/` prefix to avoid collision with module routes.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/_admin/manifests` | Returns all merged module manifests (JSON) |
| `GET` | `/admin/_admin/manifests/:module` | Returns manifest for one module |
| `GET` | `/admin/_admin/introspect/schema` | Returns introspection schema for AI |
| `GET` | `/admin/_admin/overrides` | List all page overrides |
| `GET` | `/admin/_admin/overrides/:pageKey` | Get override for a specific page |
| `PUT` | `/admin/_admin/overrides/:pageKey` | Create/update override for a page |
| `DELETE` | `/admin/_admin/overrides/:pageKey` | Remove override |
| `GET` | `/admin/_admin/custom-pages` | List all custom pages |
| `POST` | `/admin/_admin/custom-pages` | Create a custom page |
| `PUT` | `/admin/_admin/custom-pages/:id` | Update a custom page |
| `DELETE` | `/admin/_admin/custom-pages/:id` | Delete a custom page |
| `GET` | `/admin/_admin/navigation` | Get merged navigation tree |
| `PUT` | `/admin/_admin/navigation/overrides` | Save navigation overrides |
| `GET` | `/admin/_admin/preferences/:pageKey` | Get user preferences for a page |
| `PUT` | `/admin/_admin/preferences/:pageKey` | Save user preferences |

**Data endpoints** (proxy to QueryService — the admin Shell uses these for all data fetching):

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/:entity` | List entities (delegates to QueryService.graph) |
| `GET` | `/admin/:entity/:id` | Get entity detail |
| `POST` | `/admin/:entity` | Create entity (calls create workflow) |
| `PUT` | `/admin/:entity/:id` | Update entity |
| `DELETE` | `/admin/:entity/:id` | Delete entity |
| `POST` | `/admin/:entity/bulk` | Bulk action (delete, status change, etc.) |

### 3.3 Manifest Serving

```typescript
// packages/admin-store/src/api/manifests/route.ts

export async function GET(req: MantaRequest) {
  const adminSdk = req.scope.resolve<AdminSdkService>('adminSdkService')
  const overrideService = req.scope.resolve<AdminStoreService>('adminStoreService')

  // Layer 1: Module defaults
  const moduleManifests = adminSdk.getAllManifests()

  // Layer 2: Developer overrides (from manta.config.ts)
  const devOverrides = adminSdk.getDeveloperOverrides()

  // Layer 3: User overrides (from database)
  const userOverrides = await overrideService.listOverrides({
    tenant_id: req.scope.resolve('AUTH_CONTEXT')?.tenant_id,
  })

  // Merge all layers
  const merged = mergeManifests(moduleManifests, devOverrides, userOverrides)

  return Response.json({ manifests: merged })
}
```

---

## 4. json-render Catalog: `@manta/admin-catalog`

### 4.1 Component Registry

```typescript
// packages/admin-catalog/src/catalog.ts

import { defineCatalog, z } from '@json-render/core'

export const mantaAdminCatalog = defineCatalog({
  components: {
    // ─── Page-Level Components ───

    DataTable: {
      description: 'Displays a paginated, sortable, filterable table of entities',
      props: z.object({
        entity: z.string().describe('Entity name to query'),
        columns: z.array(columnSchema),
        searchable: z.array(z.string()).optional(),
        filters: z.array(filterSchema).optional(),
        pagination: z.union([z.boolean(), paginationConfigSchema]).default(true),
        defaultSort: z.object({
          field: z.string(),
          direction: z.enum(['asc', 'desc']),
        }).optional(),
        bulkActions: z.array(bulkActionSchema).optional(),
        rowActions: z.array(rowActionSchema).optional(),
        createAction: z.union([
          z.object({ label: z.string().optional(), formPage: z.string().optional() }),
          z.literal(false),
        ]).optional(),
      }),
      hasChildren: false,
    },

    DetailPage: {
      description: 'Displays entity details in organized sections',
      props: z.object({
        entity: z.string(),
        entityId: z.string().describe('Bound to route param'),
        sections: z.array(detailSectionSchema),
        actions: z.array(rowActionSchema).optional(),
        relations: z.array(relationConfigSchema).optional(),
      }),
      hasChildren: false,
    },

    FormPage: {
      description: 'Entity creation or editing form',
      props: z.object({
        entity: z.string(),
        entityId: z.string().optional().describe('If editing, bound to route param'),
        mode: z.enum(['create', 'edit']),
        fields: z.array(formFieldSchema),
        sections: z.array(formSectionSchema).optional(),
        submitWorkflow: z.string().optional(),
        redirectTo: z.string().optional(),
      }),
      hasChildren: false,
    },

    MetricCard: {
      description: 'Displays a single metric with optional trend',
      props: z.object({
        label: z.string(),
        query: z.string().describe('Query name to fetch the metric value'),
        filters: z.record(z.unknown()).optional(),
        format: z.enum(['number', 'currency', 'percent']).default('number'),
        currency: z.string().optional(),
        trend: z.object({
          compareQuery: z.string(),
          direction: z.enum(['up-good', 'up-bad']).default('up-good'),
        }).optional(),
      }),
      hasChildren: false,
    },

    Chart: {
      description: 'Renders a data visualization chart',
      props: z.object({
        type: z.enum(['line', 'bar', 'pie', 'area', 'donut']),
        query: z.string().describe('Query name to fetch chart data'),
        filters: z.record(z.unknown()).optional(),
        xAxis: z.string(),
        yAxis: z.string(),
        groupBy: z.string().optional(),
        height: z.number().default(300),
      }),
      hasChildren: false,
    },

    // ─── Layout Components ───

    PageLayout: {
      description: 'Page wrapper with title, breadcrumbs, and action buttons',
      props: z.object({
        title: z.string(),
        subtitle: z.string().optional(),
        breadcrumbs: z.array(z.object({ label: z.string(), path: z.string().optional() })).optional(),
        actions: z.array(rowActionSchema).optional(),
      }),
      hasChildren: true,
    },

    Grid: {
      description: 'CSS grid layout',
      props: z.object({
        columns: z.number().default(2),
        gap: z.number().default(4),
      }),
      hasChildren: true,
    },

    Card: {
      description: 'Content card with optional title',
      props: z.object({
        title: z.string().optional(),
        description: z.string().optional(),
      }),
      hasChildren: true,
    },

    Tabs: {
      description: 'Tabbed content area',
      props: z.object({
        tabs: z.array(z.object({
          key: z.string(),
          label: z.string(),
        })),
        defaultTab: z.string().optional(),
      }),
      hasChildren: true,
    },
  },

  actions: {
    navigate: {
      description: 'Navigate to a route',
      params: z.object({ to: z.string() }),
    },
    executeWorkflow: {
      description: 'Execute a Manta workflow',
      params: z.object({
        name: z.string(),
        input: z.record(z.unknown()),
      }),
    },
    deleteRecords: {
      description: 'Delete entity records',
      params: z.object({
        entity: z.string(),
        ids: z.array(z.string()),
      }),
    },
    openModal: {
      description: 'Open a modal with content',
      params: z.object({
        title: z.string(),
        content: z.string().describe('Element ID to render in modal'),
      }),
    },
    setFilter: {
      description: 'Apply a filter to the current table',
      params: z.object({
        key: z.string(),
        value: z.unknown(),
      }),
    },
  },
})
```

### 4.2 Data Binding Pattern

json-render supports data binding through `$data` references. The Manta Shell's DataProvider bridges this to the backend API:

```typescript
// How a DataTable spec binds to data at runtime:

// The json-render spec references data paths:
{
  "type": "DataTable",
  "props": {
    "entity": "product",
    "data": "$data.products",       // Bound to DataProvider state
    "total": "$data.products_count",
    "loading": "$data.loading"
  }
}

// The Shell's DataProvider maps these to API calls:
// $data.products → GET /admin/product?limit=20&offset=0
// $data.products_count → (returned in same response)
// $data.loading → React state from TanStack Query
```

---

## 5. Frontend Shell: `@manta/admin-shell`

### 5.1 Auth Gate

Maps to the real auth interfaces:

```typescript
// packages/admin-shell/src/auth/auth-context.ts

/**
 * The Shell's auth interface — consumed by the auth gate.
 * Implementation is provided per-target.
 */
export interface AdminAuthAdapter {
  /** Returns current user or null if not authenticated */
  getCurrentUser(): Promise<AdminUser | null>

  /** Login with credentials — returns session token */
  login(email: string, password: string): Promise<{ token: string }>

  /** Logout — clears session */
  logout(): Promise<void>

  /** Returns true if user has a valid session */
  isAuthenticated(): Promise<boolean>
}

export interface AdminUser {
  id: string
  email: string
  name?: string
  role?: string
  permissions?: string[]
}

/**
 * Default implementation: calls Manta backend auth endpoints.
 *
 * Maps to backend flow:
 *   login() → POST /auth/session → IAuthModuleService.authenticate() + createSession()
 *   getCurrentUser() → GET /admin/me → verifyJwt() + resolve user
 *   logout() → DELETE /auth/session → IAuthModuleService.destroySession()
 *   isAuthenticated() → check JWT in localStorage, verify expiry
 */
export class MantaAuthAdapter implements AdminAuthAdapter {
  constructor(private baseUrl: string) {}

  async login(email: string, password: string) {
    const res = await fetch(`${this.baseUrl}/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) throw new Error('Authentication failed')
    const { token } = await res.json()
    localStorage.setItem('manta_admin_token', token)
    return { token }
  }

  async getCurrentUser() {
    const token = localStorage.getItem('manta_admin_token')
    if (!token) return null
    const res = await fetch(`${this.baseUrl}/admin/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    return res.json()
  }

  async logout() {
    const token = localStorage.getItem('manta_admin_token')
    if (token) {
      await fetch(`${this.baseUrl}/auth/session`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
    }
    localStorage.removeItem('manta_admin_token')
  }

  async isAuthenticated() {
    const token = localStorage.getItem('manta_admin_token')
    if (!token) return false
    // Check expiry locally (JWT decode without verify — server verifies on API calls)
    try {
      const payload = JSON.parse(atob(token.split('.')[1]))
      return payload.exp * 1000 > Date.now()
    } catch {
      return false
    }
  }
}
```

### 5.2 Spec Merger Pipeline

```typescript
// packages/admin-shell/src/merger/spec-merger.ts

export interface MergeInput {
  moduleManifests: Record<string, AdminManifest>    // Layer 1: from modules
  developerOverrides: AdminPatch                     // Layer 2: from manta.config.ts
  userOverrides: AdminPageOverride[]                 // Layer 3: from database
  customPages: AdminCustomPage[]                     // Layer 4: AI/user created
}

export function mergeSpecs(input: MergeInput): MergedAdminState {
  const pages: Record<string, JsonRenderSpec> = {}
  const navigation: AdminNavEntry[] = []

  // Layer 1: Module defaults
  for (const manifest of Object.values(input.moduleManifests)) {
    for (const [path, spec] of Object.entries(manifest.pages)) {
      pages[path] = spec
    }
    navigation.push(...manifest.navigation)
  }

  // Layer 2: Developer overrides (build-time, from manta.config.ts extendAdmin())
  for (const [path, patch] of Object.entries(input.developerOverrides)) {
    if (pages[path]) {
      pages[path] = applyPatch(pages[path], patch)
    }
  }

  // Layer 3: User overrides (runtime, from database)
  for (const override of input.userOverrides) {
    if (pages[override.page_key]) {
      pages[override.page_key] = applyPatch(pages[override.page_key], override.patch)
    }
  }

  // Layer 4: Custom pages
  for (const custom of input.customPages) {
    pages[custom.path] = custom.spec
    navigation.push({
      label: custom.title,
      path: `/custom/${custom.path}`,
      icon: 'Sparkles',  // AI indicator
      position: 999,
    })
  }

  return { pages, navigation: sortNavigation(navigation) }
}
```

### 5.3 DataProvider (json-render ↔ Manta API Bridge)

This is the critical runtime connector — how json-render components fetch and mutate data:

```typescript
// packages/admin-shell/src/data/data-provider.ts

import { createDataProvider } from '@json-render/react'
import { QueryClient } from '@tanstack/react-query'

export function createMantaDataProvider(baseUrl: string, token: string) {
  const queryClient = new QueryClient()
  const headers = { Authorization: `Bearer ${token}` }

  return createDataProvider({
    /**
     * Resolves $data paths in json-render specs.
     *
     * Convention:
     *   $data.{entity}          → GET /admin/{entity}
     *   $data.{entity}.{id}     → GET /admin/{entity}/{id}
     *   $data.{entity}_count    → (from list response metadata)
     */
    async resolve(path: string, params?: Record<string, unknown>) {
      const parts = path.split('.')
      const entity = parts[0]

      if (parts.length === 2 && parts[1] !== 'count') {
        // Single entity: GET /admin/{entity}/{id}
        const res = await fetch(`${baseUrl}/admin/${entity}/${parts[1]}`, { headers })
        return res.json()
      }

      // List: GET /admin/{entity}?limit=...&offset=...&filters=...
      const query = new URLSearchParams()
      if (params?.limit) query.set('limit', String(params.limit))
      if (params?.offset) query.set('offset', String(params.offset))
      if (params?.sort) query.set('sort', JSON.stringify(params.sort))
      if (params?.filters) query.set('filters', JSON.stringify(params.filters))
      if (params?.search) query.set('q', String(params.search))

      const res = await fetch(`${baseUrl}/admin/${entity}?${query}`, { headers })
      return res.json()
    },

    /**
     * Executes actions from json-render specs.
     */
    async execute(action: string, params: Record<string, unknown>) {
      switch (action) {
        case 'navigate':
          // Handled by router, not HTTP
          return

        case 'executeWorkflow':
          return fetch(`${baseUrl}/admin/workflows/${params.name}`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(params.input),
          }).then(r => r.json())

        case 'deleteRecords':
          return fetch(`${baseUrl}/admin/${params.entity}/bulk`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete', ids: params.ids }),
          }).then(r => r.json())

        default:
          throw new Error(`Unknown action: ${action}`)
      }
    },

    queryClient,
  })
}
```

### 5.4 Shell Entry Point

```typescript
// packages/admin-shell/src/shell.tsx

import { Renderer } from '@json-render/react'
import { mantaAdminCatalog } from '@manta/admin-catalog'

interface AdminShellProps {
  /** Backend URL (default: window.location.origin) */
  apiUrl?: string

  /** Auth adapter (default: MantaAuthAdapter) */
  authAdapter?: AdminAuthAdapter

  /** AI configuration */
  ai?: {
    provider: 'openai' | 'anthropic' | 'google'
    apiKey: string
    model?: string
  }

  /** Additional catalog components (Level 2 overrides) */
  components?: Record<string, React.ComponentType<unknown>>

  /** Theme overrides */
  theme?: Partial<AdminTheme>
}

export function AdminShell(props: AdminShellProps) {
  // 1. Auth gate
  // 2. Load manifests from backend
  // 3. Merge specs
  // 4. Setup DataProvider
  // 5. Setup Router (TanStack)
  // 6. Render json-render Renderer with merged spec
  // 7. AI assistant panel (if configured)
}
```

---

## 6. AI Assistant Integration

### 6.1 System Prompt Construction

```typescript
// packages/admin-shell/src/ai/system-prompt.ts

export function buildSystemPrompt(
  introspectionSchema: IntrospectionSchema,
  catalogPrompt: string, // from mantaAdminCatalog.prompt()
): string {
  return `
You are an AI assistant for a Manta admin dashboard.

## Available Components
${catalogPrompt}

## Data Schema
${JSON.stringify(introspectionSchema, null, 2)}

## Rules
- Generate ONLY json-render specs using the components listed above.
- Use entity names from the data schema when referencing data.
- For data queries, reference entities by their name (e.g., "product", "order").
- Available queries for each entity: list, get. Format: list{Entity}s, get{Entity}.
- Available workflows: create{Entity}, update{Entity}, delete{Entity}.
- For charts and metrics, use the query field to specify what data to fetch.
- For filters, only reference fields that are marked as filterable.
- For sorting, only reference fields that are marked as sortable.
- For search, only reference fields that are marked as searchable.

## Response Format
Return a valid json-render spec. The spec will be rendered using the Manta admin catalog.
`
}
```

### 6.2 AI Flow (Vercel AI SDK)

```typescript
// packages/admin-shell/src/ai/assistant.tsx

import { useChat } from 'ai/react'
import { useUIStream } from '@json-render/react'

export function AdminAssistant({ introspection, catalog, onSavePage }: Props) {
  const { messages, input, handleInputChange, handleSubmit } = useChat({
    api: '/admin/_admin/ai/chat', // Backend proxies to LLM
    body: {
      // Context sent with each message
      introspection,
      catalogPrompt: catalog.prompt(),
    },
  })

  // json-render streams the AI output and renders it progressively
  const { ui, isStreaming } = useUIStream({
    catalog,
    messages,
  })

  return (
    <AssistantPanel>
      <ChatThread messages={messages} />
      {ui && <PreviewPanel spec={ui} />}
      {ui && !isStreaming && (
        <button onClick={() => onSavePage(ui)}>Save as custom page</button>
      )}
      <ChatInput value={input} onChange={handleInputChange} onSubmit={handleSubmit} />
    </AssistantPanel>
  )
}
```

### 6.3 Backend AI Proxy

```typescript
// packages/admin-store/src/api/ai/chat/route.ts

import { streamText } from 'ai'

export async function POST(req: MantaRequest) {
  const { messages, introspection, catalogPrompt } = req.validatedBody

  // The provider + API key come from server config (NOT from client)
  const aiConfig = req.scope.resolve<MantaConfig>('config').admin?.ai
  if (!aiConfig) {
    return Response.json({ error: 'AI not configured' }, { status: 400 })
  }

  const result = streamText({
    model: aiConfig.provider(aiConfig.model),
    system: buildSystemPrompt(introspection, catalogPrompt),
    messages,
  })

  return result.toDataStreamResponse()
}
```

---

## 7. Config Extension

```typescript
// Extended config type for admin section

export interface AdminConfig {
  /** Enable/disable admin dashboard (default: true) */
  enabled?: boolean

  /** Admin URL prefix (default: '/admin') */
  path?: string

  /** Backend URL for the admin Shell to call (default: auto-detect) */
  backendUrl?: string

  /** Developer overrides — applied at build time (Layer 2) */
  overrides?: AdminPatch

  /** AI assistant configuration */
  ai?: {
    enabled?: boolean
    provider?: 'openai' | 'anthropic' | 'google'
    apiKey?: string              // Can also come from env: MANTA_AI_API_KEY
    model?: string
  }

  /** Theme */
  theme?: {
    primaryColor?: string
    logo?: string
    favicon?: string
    title?: string
  }

  /** Auth adapter override (default: MantaAuthAdapter) */
  authAdapter?: 'manta' | 'nextauth' | 'clerk'
}

// Used in defineConfig:
defineConfig({
  admin: {
    enabled: true,
    overrides: extendAdmin({
      'products/list': {
        columns: { hide: ['sales_channel'] },
      },
    }),
    ai: {
      enabled: true,
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250514',
    },
  },
})
```

---

## 8. CLI Extensions

### 8.1 `manta eject <page>` (Level 3)

```bash
manta eject products/list
# → Generates demo/src/admin/products/list.tsx
# → Full React source code for the page
# → Shell detects local file and uses it instead of json-render spec
```

Implementation:
1. Resolve the merged json-render spec for the given page
2. Use json-render's `generateSource()` API (reverse source-code generation) to produce React code
3. Write to `src/admin/<page>.tsx`
4. Register in local admin manifest so Shell knows to skip spec rendering for this page

### 8.2 `manta admin:validate`

```bash
manta admin:validate
# → Validates all admin manifests against DML entities
# → Checks column names, filter fields, search fields exist
# → Reports type mismatches (e.g., sorting on json field)
```

---

## 9. Implementation Phases

### Phase 1 — Backend Foundation (Week 1-2)

| Task | Package | Deliverable |
|------|---------|-------------|
| P1.1 | `@manta/admin-sdk` | `defineAdminManifest()`, `generateDefaultManifest()`, `buildIntrospectionSchema()`, `extendAdmin()` |
| P1.2 | `@manta/admin-store` | DML models, service, migrations |
| P1.3 | `@manta/admin-store` | REST API (manifests, overrides, introspection, preferences) |
| P1.4 | `@manta/core` | Extend `ModuleExports` with `adminManifest` field |
| P1.5 | `@manta/cli` | `manta admin:validate` command |
| P1.6 | `demo/` | Add admin manifests to Product + Inventory modules |

**Verification**: `curl /admin/_admin/introspect/schema` returns valid schema. `curl /admin/_admin/manifests` returns compiled specs.

### Phase 2 — Catalog & Shell (Week 3-4)

| Task | Package | Deliverable |
|------|---------|-------------|
| P2.1 | `@manta/admin-catalog` | Full catalog definition with Zod schemas |
| P2.2 | `@manta/admin-shell` | Shell layout (sidebar, topbar, content area) |
| P2.3 | `@manta/admin-shell` | Auth gate with MantaAuthAdapter |
| P2.4 | `@manta/admin-shell` | DataProvider (json-render ↔ Manta API) |
| P2.5 | `@manta/admin-shell` | Spec merger (4-layer pipeline) |
| P2.6 | `@manta/admin-shell` | TanStack Router setup |
| P2.7 | `@manta/admin-shell` | DataTable renderer (with pagination, sort, filter, search) |
| P2.8 | `@manta/admin-shell` | DetailPage + FormPage renderers |

**Verification**: Navigate to `localhost:9000/admin`, see product list page with real data from PG.

### Phase 3 — Override System + Eject (Week 5-6)

| Task | Package | Deliverable |
|------|---------|-------------|
| P3.1 | `@manta/admin-shell` | Level 1: Apply user overrides from database |
| P3.2 | `@manta/admin-shell` | Level 2: Component injection (dynamic import) |
| P3.3 | `@manta/cli` | `manta eject <page>` command |
| P3.4 | `@manta/admin-shell` | Level 3: Detect ejected pages, render local component |
| P3.5 | `@manta/admin-shell` | MetricCard + Chart renderers |

**Verification**: `extendAdmin()` in config hides a column. Database override adds a filter. Ejected page renders from local file.

### Phase 4 — AI Integration (Week 7-8)

| Task | Package | Deliverable |
|------|---------|-------------|
| P4.1 | `@manta/admin-store` | AI chat proxy endpoint |
| P4.2 | `@manta/admin-shell` | AI assistant panel (AI Elements) |
| P4.3 | `@manta/admin-shell` | Streaming spec rendering (useUIStream) |
| P4.4 | `@manta/admin-shell` | Save AI-generated page to database |
| P4.5 | `@manta/admin-shell` | AI patch generation ("remove this column") |

**Verification**: Ask AI "show me products by status as a pie chart" → renders chart with real data → save as custom page → appears in nav.

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **json-render is young** (released Jan 2026) — API may change | Medium | Pin version. Wrap in adapter layer (admin-catalog). |
| **DML type inference** — No compile-time column validation | Low | Runtime validation at boot + `manta admin:validate` CLI. Phase 2: refactor DML generics. |
| **json-render streaming** — May not handle complex Manta specs | Medium | Test early with real catalog. Fallback: render after full generation. |
| **Admin SPA vs SSR** — Standalone SPA means no SEO (irrelevant for admin) but no server components | Low | Non-issue for admin. Next.js integration is Phase 2. |
| **AI hallucination** — LLM may generate invalid entity/field names | Medium | Zod validation in catalog catches invalid components. Introspection schema constrains entity names. Double validation. |
| **Performance** — Manifest merging on every page load | Low | Cache merged result. Invalidate on override change (WebSocket or polling). |

---

## 11. Dependencies (npm packages)

### Backend
```
@manta/admin-sdk:
  - zod (already in core)
  - @manta/core (peer)

@manta/admin-store:
  - @manta/core (peer)
  - @manta/admin-sdk
```

### Frontend
```
@manta/admin-catalog:
  - @json-render/core ^0.x
  - zod ^3.x

@manta/admin-shell:
  - @json-render/react ^0.x
  - @manta/admin-catalog
  - @tanstack/react-router ^1.x
  - @tanstack/react-query ^5.x
  - ai ^4.x (Vercel AI SDK)
  - ai-elements ^0.x (Vercel)
  - lucide-react (icons)
  - tailwindcss ^4.x
  - @radix-ui/* (via json-render shadcn preset)
  - recharts ^2.x (for Chart component)
```

---

## 12. File Naming Convention

All admin-related files follow the existing Manta convention:
- Models: `model.define('AdminPageOverride', ...)` in `models/page-override.ts`
- Services: `AdminStoreService extends createService(...)` in `service.ts`
- Routes: `GET/POST/PUT/DELETE` exports in `api/.../route.ts`
- Module entry: `Module(AdminStoreService, { name: 'admin-store' })` in `index.ts`
- CLI commands: added to `@manta/cli` under `commands/admin/`

---

## 13. Gap Resolution — Concrete Solutions

This section resolves every gap identified in Section 0, with implementation details grounded in the real codebase and the real json-render API.

---

### G1 — DML has no TypeScript generics → How to validate manifest fields

#### The Problem

The vision spec writes `defineAdminManifest<ProductModule>()` implying TS generics infer field names at compile time. But `model.define()` returns a plain `DmlEntity` class — no generic type parameter carries the schema shape:

```typescript
// What exists:
export class DmlEntity {
  readonly schema: Record<string, DmlPropertyDefinition | DmlRelationDefinition>
}

// What the vision spec assumes:
// DmlEntity<{ title: DmlText, price: DmlBigNumber, ... }> — does NOT exist
```

#### The Solution: 3-layer validation (runtime + CLI + optional TS)

**Layer 1 — Runtime validation at boot (mandatory, Phase 1)**

`defineAdminManifest()` takes the `DmlEntity` instance and validates field references by walking `entity.schema`:

```typescript
// packages/admin-sdk/src/manifest.ts

export function defineAdminManifest(
  entity: DmlEntity,
  config: AdminManifestConfig
): AdminManifest {
  const errors: string[] = []
  const entityFields = Object.keys(entity.schema)
    .filter(k => DmlEntity.isProperty(entity.schema[k]))
  const entityRelations = Object.keys(entity.schema)
    .filter(k => DmlEntity.isRelation(entity.schema[k]))

  // Validate every field reference in the manifest
  for (const [pagePath, page] of Object.entries(config.pages)) {
    const referencedFields = extractFieldReferences(page)
    for (const ref of referencedFields) {
      const base = ref.split('.')[0] // Support dot notation: 'vendor.name'
      if (!entityFields.includes(base) && !entityRelations.includes(base)) {
        errors.push(
          `[${pagePath}] Field "${ref}" not found on "${entity.name}". ` +
          `Available: ${entityFields.join(', ')}`
        )
      }
    }

    // Type-specific checks
    if (page.type === 'list') {
      for (const col of page.columns ?? []) {
        const key = typeof col === 'string' ? col : col.key
        const base = key.split('.')[0]
        const prop = entity.schema[base]
        if (DmlEntity.isProperty(prop)) {
          // Warn if sorting on json/array (unsortable types)
          if ((typeof col !== 'string' && col.sortable !== false) || typeof col === 'string') {
            if (prop.type === 'json' || prop.type === 'array') {
              errors.push(
                `[${pagePath}] Column "${key}" is type "${prop.type}" — cannot be sortable`
              )
            }
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Admin manifest validation failed for "${entity.name}":\n` +
      errors.map(e => `  - ${e}`).join('\n')
    )
  }

  return compileManifest(entity, config)
}
```

This catches typos and type mismatches **at module load time** (during `manta dev` startup). Fast feedback, zero TS gymnastics.

**Layer 2 — CLI validation command (Phase 1)**

```bash
manta admin:validate
# Loads all modules, calls defineAdminManifest() for each
# Reports all errors at once (does not throw on first error)
# Exit code 1 if any errors → usable in CI
```

Implementation in `@manta/cli`:

```typescript
// packages/cli/src/commands/admin/validate.ts

export async function adminValidate() {
  const { modules } = await loadModules()
  const allErrors: Array<{ module: string; errors: string[] }> = []

  for (const mod of modules) {
    if (!mod.models) continue
    for (const [key, entity] of Object.entries(mod.models)) {
      try {
        const manifest = mod.adminManifest
          ?? generateDefaultManifest(entity as DmlEntity)
        // Validation happens inside defineAdminManifest/generateDefaultManifest
      } catch (err) {
        allErrors.push({ module: mod.name, errors: [err.message] })
      }
    }
  }

  if (allErrors.length > 0) {
    for (const { module, errors } of allErrors) {
      console.error(`\n❌ Module "${module}":`)
      for (const e of errors) console.error(`   ${e}`)
    }
    process.exit(1)
  }

  console.log('✅ All admin manifests valid')
}
```

**Layer 3 — Optional TS generics via helper type (Phase 2, non-blocking)**

Without touching the DML core, we can add an *opt-in* type helper that extracts field names from a schema literal:

```typescript
// packages/admin-sdk/src/types.ts

/**
 * Extracts field names from a DML schema literal.
 * Usage:
 *   const Product = model.define('Product', { title: model.text(), price: model.bigNumber() })
 *   type ProductFields = DmlFieldNames<typeof Product.schema>
 *   // Result: 'title' | 'price'
 *
 * This works because model.text() returns DmlProperty (which implements DmlPropertyDefinition)
 * and TypeScript can narrow on the __dml discriminator.
 */
type DmlFieldNames<S> = {
  [K in keyof S]: S[K] extends { __dml: true } ? K : never
}[keyof S]

type DmlRelationNames<S> = {
  [K in keyof S]: S[K] extends { __dmlRelation: true } ? K : never
}[keyof S]

/**
 * Typed manifest helper — validates column/field names at compile time.
 * Requires passing `typeof Product.schema` as type argument.
 */
export function defineTypedAdminManifest<
  S extends Record<string, { __dml: true } | { __dmlRelation: true }>
>(
  entity: DmlEntity & { schema: S },
  config: TypedAdminManifestConfig<DmlFieldNames<S> & string, DmlRelationNames<S> & string>
): AdminManifest {
  return defineAdminManifest(entity, config as AdminManifestConfig)
}

interface TypedAdminManifestConfig<F extends string, R extends string> {
  pages: Record<string, TypedListPage<F> | TypedDetailPage<F, R> | TypedFormPage<F>>
  navigation?: AdminNavEntry[]
}

interface TypedListPage<F extends string> {
  type: 'list'
  entity: string
  columns: Array<F | (AdminColumnConfig & { key: F })>
  searchable?: F[]
  filters?: Array<AdminFilterConfig & { key: F }>
  // ...
}
```

**Why this works without DML refactor**: TypeScript can infer the literal keys of `entity.schema` if the object literal is passed through `as const` or through the `model.define()` call chain. Since `model.text()` returns `DmlProperty` (which has `__dml: true`), the discriminated union narrowing gives us field names.

**Caveat**: This only works when TypeScript can see the literal schema shape. If the schema is built dynamically (rare), it degrades to `string`. That's acceptable — Layer 1 (runtime) is always the safety net.

**Decision**: Ship Phase 1 with Layers 1+2 only. Layer 3 is opt-in sugar added in Phase 2.

---

### G2 — No admin API surface defined → Full REST contract

#### The Problem

The vision spec mentions "introspection API" as a single endpoint. But the Shell needs ~20 endpoints to function.

#### The Solution: Two API namespaces

**Namespace 1: `/admin/_admin/*` — Shell infrastructure** (served by `@manta/admin-store`)

These endpoints are consumed by the Shell itself — not by user code.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ MANIFESTS                                                               │
├─────────┬───────────────────────────────┬───────────────────────────────┤
│ GET     │ /admin/_admin/manifests       │ All merged manifests          │
│ GET     │ /admin/_admin/manifests/:mod  │ Single module manifest        │
├─────────┼───────────────────────────────┼───────────────────────────────┤
│ INTROSPECTION                                                           │
├─────────┬───────────────────────────────┬───────────────────────────────┤
│ GET     │ /admin/_admin/introspect      │ Full schema (entities,        │
│         │                               │ fields, relations, queries)   │
├─────────┼───────────────────────────────┼───────────────────────────────┤
│ OVERRIDES (Level 1 — user patches)                                      │
├─────────┬───────────────────────────────┬───────────────────────────────┤
│ GET     │ /admin/_admin/overrides       │ List all overrides            │
│ GET     │ /admin/_admin/overrides/:key  │ Get override for page_key     │
│ PUT     │ /admin/_admin/overrides/:key  │ Create/update override        │
│ DELETE  │ /admin/_admin/overrides/:key  │ Remove override               │
├─────────┼───────────────────────────────┼───────────────────────────────┤
│ CUSTOM PAGES (Level 1 — AI-generated or user-created)                   │
├─────────┬───────────────────────────────┬───────────────────────────────┤
│ GET     │ /admin/_admin/pages           │ List custom pages             │
│ POST    │ /admin/_admin/pages           │ Create custom page            │
│ PUT     │ /admin/_admin/pages/:id       │ Update custom page            │
│ DELETE  │ /admin/_admin/pages/:id       │ Delete custom page            │
├─────────┼───────────────────────────────┼───────────────────────────────┤
│ NAVIGATION                                                              │
├─────────┬───────────────────────────────┬───────────────────────────────┤
│ GET     │ /admin/_admin/navigation      │ Merged nav tree               │
│ PUT     │ /admin/_admin/navigation      │ Save nav overrides            │
├─────────┼───────────────────────────────┼───────────────────────────────┤
│ USER PREFERENCES                                                        │
├─────────┬───────────────────────────────┬───────────────────────────────┤
│ GET     │ /admin/_admin/prefs/:page     │ User preferences for page     │
│ PUT     │ /admin/_admin/prefs/:page     │ Save user preferences         │
├─────────┼───────────────────────────────┼───────────────────────────────┤
│ AUTH                                                                    │
├─────────┬───────────────────────────────┬───────────────────────────────┤
│ GET     │ /admin/_admin/me              │ Current user profile          │
├─────────┼───────────────────────────────┼───────────────────────────────┤
│ AI (optional)                                                           │
├─────────┬───────────────────────────────┬───────────────────────────────┤
│ POST    │ /admin/_admin/ai/chat         │ Streaming AI chat proxy       │
│ POST    │ /admin/_admin/ai/generate     │ Standalone spec generation    │
└─────────┴───────────────────────────────┴───────────────────────────────┘
```

**Namespace 2: `/admin/:entity/*` — Data CRUD** (served by existing Manta route handlers)

These are the normal module API routes. The Shell's DataProvider calls them via standard REST:

```
GET    /admin/products              → listProducts (QueryService.graph)
GET    /admin/products/:id          → getProduct
POST   /admin/products              → createProducts (workflow)
PUT    /admin/products/:id          → updateProducts (workflow)
DELETE /admin/products/:id          → deleteProducts (workflow)
POST   /admin/products/bulk         → bulk action (delete, status change)
```

These already exist in the demo app. No new work needed here — modules define their own routes as they do today.

**Key design choice**: The Shell calls data endpoints the same way any HTTP client would. No special "admin data proxy" — the Shell is just a fancy HTTP client with json-render rendering. This means any existing Manta API route automatically works in the admin.

#### Implementation details

```typescript
// packages/admin-store/src/api/_admin/introspect/route.ts

export async function GET(req: MantaRequest) {
  const modules = req.scope.resolve<ModuleRegistry>('moduleRegistry')
  const links = req.scope.resolve<LinkRegistry>('linkRegistry')

  // buildIntrospectionSchema walks all modules' DML entities
  const schema = buildIntrospectionSchema(
    modules.getAll(),
    links.getAll()
  )

  // Cache for 60s — schema changes require restart
  return Response.json(schema, {
    headers: { 'Cache-Control': 'public, max-age=60' }
  })
}
```

```typescript
// packages/admin-store/src/api/_admin/me/route.ts

export async function GET(req: MantaRequest) {
  // AUTH_CONTEXT is set by pipeline step 6 (auth middleware)
  const authContext = req.scope.resolve<AuthContext>('AUTH_CONTEXT')
  if (!authContext) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Resolve the user entity from the user module
  const userService = req.scope.resolve('userModuleService')
  const user = await userService.retrieve(authContext.actor_id)

  return Response.json({
    id: user.id,
    email: user.email,
    name: [user.first_name, user.last_name].filter(Boolean).join(' '),
    role: authContext.app_metadata?.role,
    permissions: authContext.app_metadata?.permissions ?? [],
  })
}
```

---

### G3 — json-render data binding ↔ Manta API → StateProvider + ActionProvider

#### The Problem

The vision spec shows static JSON specs but doesn't explain how a `DataTable` component fetches live data from PG. json-render's data binding uses `$state` paths (JSON Pointer, RFC 6901) and `StateProvider` — NOT a custom `$data` system.

#### The Solution: StateProvider + ActionProvider + shell-managed state

json-render's real API (confirmed from [json-render.dev/docs/data-binding](https://json-render.dev/docs/data-binding)):

- **`$state`**: reads from a state model via JSON Pointer (`"/products/items"`)
- **`$bindState`**: two-way binding for forms
- **`StateProvider`**: provides and manages the state tree
- **`ActionProvider`**: handles actions (`setState`, custom handlers)
- **`on`**: event bindings on elements (`on: { press: { action: "...", params: {} } }`)

The Shell wraps the Renderer with providers that bridge json-render state to Manta API calls:

```typescript
// packages/admin-shell/src/data/manta-providers.tsx

import { StateProvider, ActionProvider, Renderer, createStateStore } from '@json-render/react'
import { registry } from './registry'

export function MantaPageRenderer({ spec, pageKey }: { spec: JsonRenderSpec; pageKey: string }) {
  const apiClient = useMantaApiClient()
  const router = useRouter()
  const store = createStateStore({})

  // Initial data load: populate state from API based on spec's entity references
  const entities = extractEntityReferences(spec)
  useEffect(() => {
    for (const entity of entities) {
      apiClient.list(entity).then(result => {
        store.set(`/${entity}/items`, result.data)
        store.set(`/${entity}/count`, result.count)
        store.set(`/${entity}/loading`, false)
      })
      store.set(`/${entity}/loading`, true)
    }
  }, [pageKey])

  // Action handlers bridge json-render events to Manta API
  const handlers = useMemo(() => ({
    // Navigate to a route
    navigate: ({ to }: { to: string }) => {
      router.navigate({ to })
    },

    // Fetch / refresh entity data
    fetchEntity: async ({ entity, filters, sort, limit, offset }: FetchParams) => {
      store.set(`/${entity}/loading`, true)
      const result = await apiClient.list(entity, { filters, sort, limit, offset })
      store.set(`/${entity}/items`, result.data)
      store.set(`/${entity}/count`, result.count)
      store.set(`/${entity}/loading`, false)
    },

    // Create entity via workflow
    createEntity: async ({ entity, data }: { entity: string; data: unknown }) => {
      const result = await apiClient.create(entity, data)
      // Refresh the list
      handlers.fetchEntity({ entity, limit: 20, offset: 0 })
      return result
    },

    // Update entity
    updateEntity: async ({ entity, id, data }: { entity: string; id: string; data: unknown }) => {
      const result = await apiClient.update(entity, id, data)
      store.set(`/${entity}/detail`, result)
      handlers.fetchEntity({ entity, limit: 20, offset: 0 })
      return result
    },

    // Delete entities (single or bulk)
    deleteEntities: async ({ entity, ids }: { entity: string; ids: string[] }) => {
      await apiClient.bulkAction(entity, 'delete', ids)
      handlers.fetchEntity({ entity, limit: 20, offset: 0 })
    },

    // Execute arbitrary workflow
    executeWorkflow: async ({ name, input }: { name: string; input: unknown }) => {
      return apiClient.executeWorkflow(name, input)
    },
  }), [apiClient, router, store])

  return (
    <StateProvider store={store}>
      <ActionProvider handlers={handlers}>
        <Renderer spec={spec} registry={registry} />
      </ActionProvider>
    </StateProvider>
  )
}
```

#### How compiled specs use $state

When `defineAdminManifest()` compiles a list page, it produces json-render specs that reference `$state`:

```json
{
  "root": "page-products-list",
  "elements": {
    "page-products-list": {
      "type": "DataTable",
      "props": {
        "entity": "product",
        "items": { "$state": "/product/items" },
        "totalCount": { "$state": "/product/count" },
        "isLoading": { "$state": "/product/loading" },
        "columns": [
          { "key": "title", "label": "Title", "sortable": true },
          { "key": "status", "label": "Status", "type": "badge" },
          { "key": "price", "label": "Price", "type": "currency" }
        ]
      },
      "on": {
        "paginate": {
          "action": "fetchEntity",
          "params": {
            "entity": "product",
            "limit": { "$state": "/product/pagination/limit" },
            "offset": { "$state": "/product/pagination/offset" }
          }
        },
        "sort": {
          "action": "fetchEntity",
          "params": {
            "entity": "product",
            "sort": { "$state": "/product/currentSort" }
          }
        },
        "rowClick": {
          "action": "navigate",
          "params": { "to": { "$template": "/products/${$item.id}" } }
        }
      }
    }
  },
  "state": {
    "product": {
      "items": [],
      "count": 0,
      "loading": true,
      "pagination": { "limit": 20, "offset": 0 },
      "currentSort": { "field": "created_at", "direction": "desc" }
    }
  }
}
```

This is 100% standard json-render — no custom runtime, no patching. The `MantaPageRenderer` wrapper handles the API calls via `ActionProvider`, and the spec reads/writes state via `$state`/`$bindState`.

---

### G4 — Auth gate has no `getCurrentUser()` → Backend route + frontend adapter

#### The Problem

`IAuthPort` has `verifyJwt()`, `verifyApiKey()`, `createJwt()` — pure crypto, no user lookup.
`IAuthModuleService` has `authenticate()`, `createSession()`, `destroySession()`, `verifySession()` — session management, but no "get current user" method.

The Shell needs: login, logout, get current user profile, check if authenticated.

#### The Solution: 1 new backend route + existing interfaces

The auth flow follows the same pattern as Medusa's admin auth (confirmed from [Medusa API docs](https://docs.medusajs.com/api/admin)):

**Login flow** (2-step, same as Medusa):
```
1. POST /auth/user/emailpass   → IAuthModuleService.authenticate({ email, password })
                                → Returns { token: JWT }

2. POST /auth/session          → IAuthPort.verifyJwt(token)
                                → IAuthModuleService.createSession(authContext)
                                → Sets session cookie (or returns JWT for SPA)
```

**Get current user** — new route needed:
```
GET /admin/_admin/me           → Pipeline step 6 sets AUTH_CONTEXT in scope
                                → Resolve user module service
                                → Return user profile
```

**The `AdminAuthAdapter` (frontend)** uses these 3 endpoints:

```typescript
// packages/admin-shell/src/auth/manta-auth-adapter.ts

export class MantaAuthAdapter implements AdminAuthAdapter {
  private baseUrl: string
  private token: string | null = null

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
    this.token = localStorage.getItem('manta_admin_token')
  }

  async login(email: string, password: string): Promise<{ token: string }> {
    // Step 1: Authenticate and get JWT
    const authRes = await fetch(`${this.baseUrl}/auth/user/emailpass`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!authRes.ok) {
      const err = await authRes.json()
      throw new Error(err.message ?? 'Authentication failed')
    }
    const { token } = await authRes.json()

    // Step 2: Create session
    const sessionRes = await fetch(`${this.baseUrl}/auth/session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!sessionRes.ok) throw new Error('Session creation failed')

    this.token = token
    localStorage.setItem('manta_admin_token', token)
    return { token }
  }

  async getCurrentUser(): Promise<AdminUser | null> {
    if (!this.token) return null
    try {
      const res = await fetch(`${this.baseUrl}/admin/_admin/me`, {
        headers: { Authorization: `Bearer ${this.token}` },
      })
      if (!res.ok) {
        if (res.status === 401) { this.clearToken(); return null }
        return null
      }
      return res.json()
    } catch {
      return null
    }
  }

  async logout(): Promise<void> {
    if (this.token) {
      await fetch(`${this.baseUrl}/auth/session`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.token}` },
      }).catch(() => {}) // Best-effort
    }
    this.clearToken()
  }

  async isAuthenticated(): Promise<boolean> {
    if (!this.token) return false
    // Quick local check (no network round-trip)
    try {
      const payload = JSON.parse(atob(this.token.split('.')[1]))
      return payload.exp * 1000 > Date.now()
    } catch {
      this.clearToken()
      return false
    }
  }

  private clearToken() {
    this.token = null
    localStorage.removeItem('manta_admin_token')
  }
}
```

**Backend route implementation**:

```typescript
// packages/admin-store/src/api/_admin/me/route.ts

export async function GET(req: MantaRequest) {
  const authContext = req.scope.resolve<AuthContext | null>('AUTH_CONTEXT')
  if (!authContext || authContext.actor_type !== 'user') {
    return Response.json({ type: 'UNAUTHORIZED', message: 'Not authenticated' }, { status: 401 })
  }

  // The user module is a standard Manta module
  // Its service was registered in the container at boot
  try {
    const userService = req.scope.resolve('userModuleService')
    const user = await userService.retrieve(authContext.actor_id)
    return Response.json({
      id: user.id,
      email: user.email,
      name: [user.first_name, user.last_name].filter(Boolean).join(' ') || null,
      role: authContext.app_metadata?.role ?? null,
      permissions: authContext.app_metadata?.permissions ?? [],
    })
  } catch {
    return Response.json({ type: 'NOT_FOUND', message: 'User not found' }, { status: 404 })
  }
}
```

**No changes to `IAuthPort` or `IAuthModuleService`** — the existing interfaces are sufficient. The gap was only in the routing layer (missing `/me` endpoint), not in the port contracts.

---

### G5 — Module manifest discovery → `adminManifest` field in `ModuleExports`

#### The Problem

`ModuleExports` has no field for admin UI metadata. Modules can't tell the Shell what pages they provide.

#### The Solution: 1 optional field + convention-based auto-generation

**Step 1**: Add `adminManifest` to `ModuleExports`:

```typescript
// packages/core/src/module/index.ts — modified

export interface ModuleExports {
  name: string
  service: new (...args: unknown[]) => unknown
  loaders?: Array<(container: IContainer) => Promise<void>>
  models?: Record<string, unknown>
  version?: string
  hooks?: ModuleLifecycleHooks
  linkableKeys?: Record<string, string>

  // NEW — Admin UI manifest (optional)
  adminManifest?: AdminManifest
}
```

**Step 2**: Modules that want custom admin pages provide a manifest:

```typescript
// demo/src/modules/product/index.ts

import { Module } from '@manta/core'
import { defineAdminManifest } from '@manta/admin-sdk'
import ProductService from './service'
import Product from './models/product'

const adminManifest = defineAdminManifest(Product, {
  navigation: [{ label: 'Products', icon: 'Package', path: '/products', position: 10 }],
  pages: {
    'products/list': {
      type: 'list',
      entity: 'product',
      columns: ['title', 'status', 'price'],
      searchable: ['title'],
      filters: [{ key: 'status', type: 'select' }],
    },
    'products/[id]': {
      type: 'detail',
      entity: 'product',
      sections: [{ fields: ['title', 'description', 'price', 'status'], columns: 2 }],
    },
    'products/create': {
      type: 'form',
      entity: 'product',
      mode: 'create',
      fields: ['title', 'description', 'price', 'status'],
    },
  },
})

export default Module(ProductService, {
  name: 'product',
  models: { Product },
  adminManifest,
})
```

**Step 3**: If `adminManifest` is NOT provided but `models` IS, auto-generate defaults:

```typescript
// packages/admin-sdk/src/discovery.ts

export function discoverManifests(
  modules: ModuleExports[]
): Record<string, AdminManifest> {
  const manifests: Record<string, AdminManifest> = {}

  for (const mod of modules) {
    if (mod.adminManifest) {
      // Explicit manifest — use as-is
      manifests[mod.name] = mod.adminManifest
    } else if (mod.models) {
      // Auto-generate from DML models
      for (const [_, entity] of Object.entries(mod.models)) {
        const generated = generateDefaultManifest(entity as DmlEntity)
        // Merge into module manifest (a module can have multiple entities)
        if (manifests[mod.name]) {
          manifests[mod.name] = mergeManifests(manifests[mod.name], generated)
        } else {
          manifests[mod.name] = generated
        }
      }
    }
    // No models + no manifest = no admin pages (infrastructure modules like auth, cache)
  }

  return manifests
}
```

**Bootstrap integration** — the CLI/server calls `discoverManifests()` at boot step 9 (after modules loaded, before HTTP ready):

```typescript
// packages/cli/src/server-bootstrap.ts — modified

// After loading all modules:
const manifests = discoverManifests(loadedModules)
container.register('adminManifests', manifests, 'SINGLETON')

// Also build introspection schema:
const introspection = buildIntrospectionSchema(loadedModules, registeredLinks)
container.register('adminIntrospection', introspection, 'SINGLETON')
```

**Why `adminManifest` is on `ModuleExports` and not a separate file**: Following the Medusa pattern where `defineWidgetConfig` is co-located with the component, but adapted to Manta's "backend declares, frontend renders" model. A module knows its own data model best — it should declare its admin pages alongside its DML, not in a separate admin package.

---

### G6 — Config `admin` field is untyped → Typed `AdminConfig` interface

#### The Problem

`MantaConfig.admin` is `Record<string, unknown>`. No autocomplete, no validation.

#### The Solution: Replace with typed interface + update `defineConfig`

```typescript
// packages/core/src/config/types.ts — modified

export interface MantaConfig {
  projectConfig: ProjectConfig
  modules: Record<string, ModuleConfigEntry | boolean | string>
  plugins: Array<string | { resolve: string; options?: Record<string, unknown> }>
  featureFlags: Record<string, boolean>
  strict: boolean
  query?: QueryConfig
  http?: HttpConfig
  auth?: AuthConfig
  boot?: BootConfig

  // CHANGED — from Record<string, unknown> to typed interface
  admin?: AdminConfig
}

export interface AdminConfig {
  /** Enable/disable admin dashboard (default: true in dev, false in prod) */
  enabled?: boolean

  /** Admin URL path prefix (default: '/admin') */
  path?: string

  /** Backend URL the Shell SPA calls (default: same origin) */
  backendUrl?: string

  /** Developer overrides — Layer 2 patches applied at build time */
  overrides?: AdminPatch

  /** AI assistant configuration */
  ai?: {
    /** Enable AI assistant panel (default: false) */
    enabled?: boolean
    /**
     * LLM provider. Resolved via Vercel AI SDK provider registry.
     * Values: 'openai', 'anthropic', 'google', 'mistral', or custom.
     */
    provider?: string
    /** Model ID (e.g., 'claude-sonnet-4-5-20250514', 'gpt-4o') */
    model?: string
    /**
     * API key. Can also be set via env: MANTA_AI_API_KEY.
     * The env var takes precedence if both are set.
     */
    apiKey?: string
  }

  /** Theme customization */
  theme?: {
    /** Primary brand color (CSS color value) */
    primaryColor?: string
    /** Logo URL displayed in sidebar */
    logo?: string
    /** Favicon URL */
    favicon?: string
    /** Dashboard title (default: 'Manta Admin') */
    title?: string
  }

  /** Auth adapter selection */
  auth?: {
    /**
     * Which auth adapter the Shell uses.
     * 'manta' = built-in JWT+session (default)
     * 'nextauth' = NextAuth.js (for Next.js deployments)
     * 'clerk' = Clerk (managed auth)
     * 'custom' = provide your own AdminAuthAdapter
     */
    adapter?: 'manta' | 'nextauth' | 'clerk' | 'custom'
  }
}
```

**Migration**: Since `admin` was `Record<string, unknown>`, any existing usage is compatible (structural subtyping). No breaking change.

**Usage**:

```typescript
// manta.config.ts
import { defineConfig } from '@manta/core'
import { extendAdmin } from '@manta/admin-sdk'

export default defineConfig({
  admin: {
    enabled: true,
    overrides: extendAdmin({
      'products/list': {
        columns: { hide: ['metadata'], append: ['vendor.name'] },
      },
    }),
    ai: {
      enabled: true,
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250514',
      // apiKey from env MANTA_AI_API_KEY
    },
    theme: {
      title: 'My Store Admin',
      primaryColor: '#6366f1',
      logo: '/assets/logo.svg',
    },
  },
})
```

---

### G7 — `manta eject` command missing → CLI implementation

#### The Problem

Level 3 override (full ejection) requires a `manta eject <page>` command. The CLI doesn't have it.

#### The Solution: New CLI command that generates React source from json-render spec

json-render has a `generateSource()` API for reverse source-code generation (confirmed from [json-render release notes](https://releasebot.io/updates/vercel-labs/json-render)). The command:

1. Resolves the merged json-render spec for the target page
2. Generates React source code from the spec
3. Writes to `src/admin/<page>.tsx`
4. Creates a local admin override marker so the Shell skips spec rendering

```typescript
// packages/cli/src/commands/admin/eject.ts

import { generateSource } from '@json-render/core'

export async function ejectPage(pagePath: string) {
  // 1. Load all manifests and resolve the merged spec
  const { modules } = await loadModules()
  const manifests = discoverManifests(modules)
  const config = await loadConfig()
  const merged = mergeManifests(manifests, config.admin?.overrides ?? {})

  const spec = merged[pagePath]
  if (!spec) {
    console.error(`Page "${pagePath}" not found. Available pages:`)
    for (const key of Object.keys(merged)) {
      console.error(`  - ${key}`)
    }
    process.exit(1)
  }

  // 2. Generate React source code from the spec
  const source = generateSource(spec, {
    framework: 'react',
    // Map json-render components to import paths
    imports: {
      DataTable: '@manta/admin-shell/components',
      DetailPage: '@manta/admin-shell/components',
      FormPage: '@manta/admin-shell/components',
      MetricCard: '@manta/admin-shell/components',
      Chart: '@manta/admin-shell/components',
    },
  })

  // 3. Write to local admin directory
  const outputDir = path.resolve('src/admin')
  const outputFile = path.join(outputDir, `${pagePath.replace(/\//g, '-')}.tsx`)
  await fs.mkdir(path.dirname(outputFile), { recursive: true })
  await fs.writeFile(outputFile, source, 'utf-8')

  // 4. Create/update eject manifest
  const ejectManifestPath = path.join(outputDir, '.ejected.json')
  let ejected: Record<string, string> = {}
  try {
    ejected = JSON.parse(await fs.readFile(ejectManifestPath, 'utf-8'))
  } catch {}
  ejected[pagePath] = outputFile
  await fs.writeFile(ejectManifestPath, JSON.stringify(ejected, null, 2), 'utf-8')

  console.log(`✅ Ejected "${pagePath}" to ${outputFile}`)
  console.log(`   This page is now fully owned by your project.`)
  console.log(`   Module updates will no longer affect it.`)
}
```

**Shell detection** — how the Shell knows a page was ejected:

```typescript
// packages/admin-shell/src/shell.tsx — page resolution

async function resolvePageComponent(pagePath: string): Promise<React.ComponentType | JsonRenderSpec> {
  // Check for ejected pages first
  try {
    // Dynamic import from the project's src/admin/ directory
    // The build tool (Vite/Rollup) resolves this at build time
    const ejectedModule = await import(`/src/admin/${pagePath.replace(/\//g, '-')}.tsx`)
    if (ejectedModule.default) {
      return ejectedModule.default // React component — render directly
    }
  } catch {
    // Not ejected — fall through to json-render spec rendering
  }

  // Use json-render spec from merged manifests
  return mergedSpecs[pagePath]
}
```

**CLI registration**:

```bash
# Added to manta CLI
manta eject <page>           # Eject a page to local ownership
manta eject --list           # List all ejectable pages
manta eject --revert <page>  # Remove ejected file, restore spec rendering
```

---

### Summary: All Gaps Resolved

| Gap | Problem | Solution | Phase |
|-----|---------|----------|-------|
| **G1** | DML no TS generics | Runtime validation at boot + `manta admin:validate` CLI + optional typed helper | Phase 1 (layers 1-2), Phase 2 (layer 3) |
| **G2** | No API surface | 2 namespaces: `/_admin/*` (18 shell endpoints) + existing `/admin/:entity/*` (data CRUD) | Phase 1 |
| **G3** | Data binding unclear | json-render `StateProvider` + `ActionProvider` with Manta API handlers; specs use `$state` paths | Phase 2 |
| **G4** | Auth gate no `getCurrentUser()` | New `GET /admin/_admin/me` route + `MantaAuthAdapter` (2-step login flow, same as Medusa) | Phase 1 |
| **G5** | Module manifest discovery | `adminManifest` field on `ModuleExports` + auto-generation from DML when absent | Phase 1 |
| **G6** | Config `admin` untyped | Typed `AdminConfig` interface replacing `Record<string, unknown>` | Phase 1 |
| **G7** | `manta eject` missing | CLI command using json-render `generateSource()` + `.ejected.json` manifest + Shell detection | Phase 3 |

All solutions use **existing APIs** (json-render's real `StateProvider`/`ActionProvider`/`generateSource()`, Manta's existing `DmlEntity`/`IAuthModuleService`/`MantaRequest`). No speculative features assumed.
