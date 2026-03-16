# Manta.js — Admin Shell
## Architecture & Technical Specification

**We Are Souk** — Version 1.0 — March 2026

---

## 1. Executive Summary

This document specifies the architecture of the **Manta.js Admin Shell** — a declarative, AI-native admin framework built on **json-render** (by Vercel) and the **Vercel AI SDK**. The Admin Shell gives developers and end-users a fully customizable dashboard that runs on any frontend framework (React, Vue, Next.js) with zero lock-in.

The core insight: **admin pages are not code — they are data**. A table page is a JSON spec describing columns, filters, sorting, and data source. A form page is a JSON spec describing fields, validation, and the workflow to call. By treating UI as structured data, we unlock three capabilities simultaneously: cross-framework portability, runtime customization by end-users, and AI-driven dashboard generation.

---

## 2. Design Principles

### 2.1 UI is Data, Not Code

Every admin page is a JSON spec following the json-render format. Developers write TypeScript helpers that compile to JSON. End-users modify JSON through the AI assistant. The renderer consumes JSON and produces native UI components. No JSX is shipped by plugins or modules — only typed declarations.

### 2.2 Convention over Configuration

A module that declares a data model automatically gets list, detail, and form pages. The developer can override any part at any granularity — from a single column to an entire page — but the defaults work out of the box.

### 2.3 Three-Level Override System

Customization follows a layered architecture with increasing control:

- **Level 1 — Manifest patch**: modify the JSON spec declaratively (add/remove/reorder columns, change filters). No framework code involved. Stored in the database when done by end-users.
- **Level 2 — Component injection**: replace the renderer for a specific slot (e.g., a custom cell renderer for a price column). Requires a React or Vue component.
- **Level 3 — Full ejection**: `manta eject products/list` copies the generated page into the project. The developer owns it entirely. Updates from the module no longer apply.

### 2.4 AI-Native by Design

The declarative JSON format is equally readable by humans, renderers, and LLMs. The AI assistant generates and modifies the same spec format that developers write. The backend exposes a schema introspection API that tells the AI what data exists, what relations are available, and what queries are possible.

---

## 3. Architecture Overview

### 3.1 Layer Diagram

The system is organized in five distinct layers, from bottom to top:

| Layer | Package | Responsibility |
|-------|---------|----------------|
| 5. AI | Vercel AI SDK + AI Elements | LLM communication, streaming, assistant UI components |
| 4. Shell | @manta/admin-shell | Layout, sidebar, auth gate, routing, spec merging |
| 3. Catalog | @manta/admin-catalog | Admin component registry (Table, Form, Detail, Chart, Metric) |
| 2. Rendering | @json-render/react (or /vue) | JSON spec → native UI components |
| 1. Spec | @json-render/core | JSON spec format, catalog definition, Zod validation, streaming |

Additionally, two backend components support the admin:

- `@manta/admin-store` — a Manta module that persists page overrides and custom pages in the database.
- **Introspection API** — a route that exposes the full query graph schema (entities, fields, types, relations) for AI consumption.

### 3.2 Data Flow

At runtime, the Shell assembles the final UI through a merge pipeline:

1. **Module manifests** (from installed npm packages) provide default page specs.
2. **Developer overrides** (from `manta.config.ts` or `extendAdmin()`) apply patches at build time.
3. **User overrides** (from `@manta/admin-store` database) apply patches at runtime.
4. **AI-generated pages** (from `@manta/admin-store`) are added as custom pages.
5. The merged spec is passed to the json-render Renderer, which produces native UI.

---

## 4. json-render Integration

### 4.1 Why json-render

json-render is an open-source framework by Vercel Labs that provides exactly what Manta needs:

- A standardized JSON spec format for describing UI trees.
- A catalog system with Zod validation that constrains AI output to safe, predictable components.
- Cross-platform renderers: React, Vue, Svelte, React Native from the same spec.
- Built-in streaming support for progressive AI-generated UI rendering.
- Data binding with state paths, two-way binding, and conditional visibility.

Rather than inventing a custom spec format, Manta adopts json-render as its UI interchange format and builds domain-specific tooling on top.

### 4.2 The Manta Admin Catalog

The catalog is defined using `defineCatalog()` from `@json-render/core` and extended with Manta-specific components. Each component has a Zod-validated props schema:

```typescript
// @manta/admin-catalog (simplified)
export const catalog = defineCatalog(schema, {
  components: {
    DataTable: {
      props: z.object({
        entity: z.string(),
        columns: z.array(columnSchema),
        filters: z.array(filterSchema).optional(),
        searchable: z.array(z.string()).optional(),
        sortable: z.array(z.string()).optional(),
        pagination: z.boolean().default(true),
      }),
      hasChildren: false,
    },
    DetailPage: { /* ... */ },
    FormPage: { /* ... */ },
    MetricCard: { /* ... */ },
    Chart: { /* ... */ },
  },
  actions: {
    navigate: { params: z.object({ to: z.string() }) },
    executeWorkflow: { params: z.object({ name: z.string(), input: z.any() }) },
    deleteRecords: { params: z.object({ entity: z.string(), ids: z.array(z.string()) }) },
  },
})
```

### 4.3 TypeScript Sugar: defineAdminManifest

While the underlying format is json-render JSON, developers use `defineAdminManifest()` — a typed helper that provides IDE autocompletion, compile-time validation against the actual data model schema, and compiles to a json-render spec.

```typescript
// What the developer writes (TypeScript, fully typed)
defineAdminManifest<ProductModule>({
  pages: {
    'products/list': {
      type: 'list',
      entity: 'product',
      columns: ['title', 'status', 'price'],  // TS validates these exist
      searchable: ['title'],                    // TS validates searchability
      filters: [{ key: 'status', type: 'select' }],
    }
  }
})
```

This compiles to:

```json
{
  "root": "page-products-list",
  "elements": {
    "page-products-list": {
      "type": "DataTable",
      "props": {
        "entity": "product",
        "columns": [
          { "key": "title", "label": "products.fields.title", "sortable": true },
          { "key": "status", "label": "products.fields.status", "type": "badge" },
          { "key": "price", "label": "products.fields.price", "type": "currency" }
        ],
        "searchable": ["title"],
        "pagination": true
      }
    }
  }
}
```

The TypeScript generic `<ProductModule>` ensures that only valid fields from the Product data model can be used as columns, filters, or search targets. If a developer tries to mark a non-existent field as searchable, TypeScript catches it at compile time.

---

## 5. Admin Shell

### 5.1 Responsibilities

The Shell is the host application that provides:

- **Layout**: sidebar, topbar, breadcrumbs, content area.
- **Navigation**: dynamically built from module manifests. Each module declares its menu entries.
- **Auth gate**: consumes an `AuthPort` interface (`getCurrentUser()`, `isAuthenticated()`, `login()`, `logout()`). Implementation is provided by a module or adapter.
- **Spec merger**: at runtime, loads module specs, applies developer overrides, applies user overrides from database, and passes merged specs to the Renderer.
- **Routing**: in Standalone mode, uses TanStack Router or similar. In Next.js mode, a catch-all route `app/admin/[...slug]/page.tsx` delegates to the Shell.

### 5.2 Standalone vs Next.js vs Nuxt

The Shell architecture is identical across targets. The only difference is the routing and rendering host:

| Aspect | Standalone | Next.js | Nuxt |
|--------|-----------|---------|------|
| Router | TanStack Router (embedded) | Next.js App Router (catch-all) | Nuxt file-based (catch-all) |
| Renderer | @json-render/react | @json-render/react | @json-render/vue |
| Auth | @manta/auth module (JWT) | NextAuth / Clerk / custom | Nuxt Auth / custom |
| Discovery | Runtime (module scan) | Runtime (same mechanism) | Runtime (same mechanism) |
| SSR | No (SPA) | Yes (native) | Yes (native) |

The discovery mechanism is identical: modules export manifests, the Shell collects them at startup. No file copying, no CLI required for default operation.

---

## 6. Override System

### 6.1 Level 1: Manifest Patch (Declarative)

The developer (or the AI assistant) modifies the spec without writing any framework code. Patches use `extendAdmin()` which produces JSON merge operations:

```typescript
extendAdmin({
  'products/list': {
    columns: {
      append: [{ key: 'vendor.name', label: 'Vendor', sortable: true }],
      hide: ['sales_channel'],
      reorder: ['title', 'vendor.name', 'status', 'price'],
    },
    filters: {
      append: [{ key: 'vendor', type: 'relation', query: 'listVendors' }],
    },
  }
})
```

When an end-user makes changes through the AI assistant ("remove the Sales Channel column"), the same patch structure is generated and stored in the database via `@manta/admin-store`.

### 6.2 Level 2: Component Injection

For custom rendering of a specific slot, the developer provides a React or Vue component:

```typescript
extendAdmin({
  'products/list': {
    columns: {
      override: {
        price: {
          component: () => import('./components/PriceWithMargin.tsx'),
        }
      }
    }
  }
})
```

The rest of the page remains managed by the Shell. The injected component receives the cell data as props and renders within the standard table layout.

### 6.3 Level 3: Full Ejection

Running `manta eject products/list` generates the full React (or Vue) source code of the page into the project. The developer owns it entirely. The Shell detects the local file and uses it instead of the module's spec. Module updates no longer affect this page.

---

## 7. Data Layer

### 7.1 The @manta/admin-store Module

This is a standard Manta module with its own data models, persisted in the database:

| Entity | Purpose |
|--------|---------|
| admin_page_override | Stores JSON patches for existing pages (Level 1 overrides from end-users) |
| admin_custom_page | Stores complete json-render specs for AI-generated or user-created pages |
| admin_navigation_override | Stores custom menu entries, reordering, hiding of default entries |
| admin_user_preference | Per-user settings (column widths, default filters, pinned pages) |

Because this is a Manta module, it benefits from all framework features: migrations, query graph participation, workflow-based mutations, event system, and permissions.

### 7.2 Spec Resolution Pipeline

When the Shell renders a page, it resolves the final spec through this pipeline:

1. Load the module's default spec (from npm package, in memory).
2. Apply developer overrides from `manta.config.ts` (build-time, static).
3. Query `admin_page_override` for matching `page_key` (runtime, from database).
4. Deep-merge all layers. Later layers win on conflicts.
5. Pass the final spec to the json-render Renderer.

This pipeline is cached and invalidated when overrides change. The database layer is optional — if `@manta/admin-store` is not installed, only layers 1 and 2 apply.

### 7.3 Introspection API

The backend exposes `GET /admin/introspect/schema` which returns the full query graph schema. This endpoint is consumed by the AI assistant to understand what data exists and what queries are possible.

```typescript
// Response shape
{
  entities: {
    product: {
      module: 'product',
      fields: {
        id: { type: 'string', primary: true },
        title: { type: 'string', searchable: true, sortable: true },
        status: { type: 'enum', values: ['draft', 'published'], filterable: true },
        price: { type: 'number', sortable: true },
      },
      relations: {
        variants: { entity: 'product_variant', type: 'hasMany' },
        categories: { entity: 'product_category', type: 'manyToMany' },
        brand: { entity: 'brand', type: 'belongsTo' },
      },
      queries: ['listProducts', 'getProduct'],
      workflows: ['createProduct', 'updateProduct', 'deleteProduct'],
    },
    // ... all installed modules
  }
}
```

This schema is generated automatically from the modules' DML declarations at startup. No manual annotation required — if a module defines a data model, it appears in the introspection.

---

## 8. AI Integration

### 8.1 Architecture

The AI integration uses three Vercel open-source libraries:

- **Vercel AI SDK**: provider-agnostic TypeScript toolkit for LLM communication. Supports OpenAI, Anthropic, Google, and others through a unified API. The user provides their own API key.
- **json-render**: constrains AI output to the Manta admin catalog. The AI can only generate specs using components defined in the catalog. Invalid output is caught by Zod validation.
- **AI Elements**: pre-built React components for the assistant UI (chat thread, input, streaming display). Built on shadcn/ui.

### 8.2 AI Assistant Flow

The AI assistant is a component embedded in the Shell:

1. User opens the assistant panel and types a request (e.g., "show me unpaid orders by vendor this month").
2. The Shell sends the request to the server with context: the introspection schema (`/admin/introspect/schema`) + the admin catalog prompt (`catalog.prompt()` from json-render).
3. The server forwards to the LLM via the Vercel AI SDK, using the user's API key.
4. The LLM generates a json-render spec constrained to the catalog.
5. json-render's `useUIStream` hook streams the response and renders it progressively using the same Renderer as normal pages.
6. If the user wants to keep the generated view, it's persisted in `@manta/admin-store` as an `admin_custom_page`.

### 8.3 AI Capabilities (Phase 1)

In the initial implementation, the AI assistant can:

- Generate custom dashboard views with tables, charts, and metrics.
- Modify existing pages by generating manifest patches ("remove this column", "add a filter for vendor").
- Query data cross-module using the introspection schema to build `query.graph()` calls.
- Provide natural language answers about the store's data ("who are my top 5 customers this month?").

The assistant **cannot** modify backend code, create modules, or alter workflows. That capability is reserved for Phase 2.

### 8.4 Cost Model

The user provides their own LLM API key. Manta adds zero cost to AI usage. This is a fundamental differentiator from Bloom (Medusa's AI tool), which requires a paid subscription to Medusa Cloud. With Manta, the AI capability is free and self-hosted.

---

## 9. Plugin Compatibility

### 9.1 Manta Native Plugins

A Manta-native plugin exports:

- **Backend**: modules, workflows, links (TypeScript, framework-agnostic) — already supported.
- **Admin**: a manifest via `defineAdminManifest()` that compiles to json-render spec — **no framework code shipped**.

This means a Manta plugin works in React, Vue, or any future target without modification.

### 9.2 Medusa Plugin Compatibility

Medusa plugins ship React components for admin. The `@manta/medusa` compatibility layer handles the backend translation (Medusa modules → Manta modules). For admin pages, two approaches are available:

- **Auto-manifest generation**: for standard CRUD pages, the compatibility layer inspects the plugin's data model and generates a default manifest. Covers the majority of plugins.
- **Custom mapping**: for complex plugin UIs, a manual mapping file translates the Medusa admin structure to a Manta manifest. Community-maintained.

Phase 1 focuses on Manta-native plugins. Medusa compatibility is Phase 2.

---

## 10. Future Extensions

### 10.1 CMS / Slice Machine

The same json-render architecture naturally extends to a CMS slice system. Content editors define page sections ("slices") as json-render specs. Each slice maps to a catalog component (Hero, ProductGrid, Testimonials). The page is composed from an ordered list of slices, each with its own spec. This is architecturally identical to the admin page system — the only difference is the catalog of available components.

### 10.2 AI Module Creation (Phase 2)

The AI assistant generates module code (data models, workflows, manifests) and submits it as a pull request via the GitHub API. The developer reviews and merges. This requires VCS integration and a code sandbox — separate infrastructure from the admin itself. Claude Code with SoukJS skills covers this use case today for developers.

### 10.3 Multi-Tenant Dashboards

In marketplace scenarios, each vendor can have a customized admin. The `admin_page_override` and `admin_custom_page` entities support a `tenant_id` field. The Shell filters overrides by tenant at runtime. Different vendors see different dashboards, all from the same codebase.

---

## 11. Implementation Roadmap

### Sprint (March–April 2026)

- **Week 1–2**: Define the Manta admin catalog (DataTable, FormPage, DetailPage, MetricCard, Chart). Implement `defineAdminManifest()` TypeScript helper with generic type inference from DML.
- **Week 3–4**: Build the Shell (layout, sidebar, auth port, spec merger). Standalone mode with TanStack Router. One module (Product) as proof of concept.
- **Week 5–6**: Implement `@manta/admin-store` module. Override system (Level 1 patches from database). Basic introspection API.
- **Week 7–8**: AI assistant integration (Vercel AI SDK + json-render streaming). Demo: user asks for a custom dashboard, AI generates it, it's saved to database.

### Post-Sprint

- Next.js catch-all route integration.
- Vue renderer + Nuxt support.
- Medusa plugin compatibility layer.
- CMS slice system.
- AI module creation (Phase 2).

---

## 12. Technology Stack

| Concern | Technology | Notes |
|---------|-----------|-------|
| UI Spec Format | json-render (Vercel Labs) | Open source, cross-framework, AI-optimized |
| React Renderer | @json-render/react | Primary target for sprint |
| Component Library | Radix UI + Tailwind CSS | Via json-render's shadcn preset |
| AI Communication | Vercel AI SDK | Provider-agnostic, streaming, tool use |
| AI UI Components | AI Elements (Vercel) | Chat thread, input, streaming display |
| TypeScript Helpers | Custom (defineAdminManifest) | Sugar over json-render, DML-aware types |
| Routing (Standalone) | TanStack Router | Lightweight, type-safe |
| State Management | json-render DataProvider | Built-in state binding from json-render |
| Database Layer | @manta/admin-store module | Standard Manta module with DML |
| Validation | Zod | Catalog constraints + API validation |
