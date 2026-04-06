# Dashboard — defineSpa(), definePage() & defineForm()

## Philosophy

The backend is fast because it's constrained: `defineModel()` + `defineService()` leave no room for error. The dashboard follows the same principle: **declarative specs, not React pages.**

Three primitives:

- `defineSpa()` — SPA configuration (navigation, branding, settings)
- `definePage()` — display page (listing, detail, dashboard, anything)
- `defineForm()` — form overlay (create, edit)

Pages are composed of **blocks** — reusable components provided by the framework or created by the developer. Blocks are standard React components. The framework provides ~10 built-in blocks. Developers can add their own.

**The AI never writes React.** It writes `defineSpa()`, `definePage()` and `defineForm()` specs using a finite vocabulary of blocks. The result is consistent, error-free, and maintainable.

---

## SPA — Auto-detected from filesystem

SPAs are auto-detected from `src/spa/{name}/`. Everything is auto-discovered:

```
src/spa/admin/
├── config.ts                         # defineSpa() — navigation, title, branding
├── pages/
│   ├── page.tsx                      # → /admin/ (React page, for custom home)
│   ├── products/
│   │   └── page.ts                   # → /admin/products (listing)
│   ├── products/[id]/
│   │   └── page.ts                   # → /admin/products/:id (detail)
│   │   └── edit/
│   │       └── page.ts               # → /admin/products/:id/edit (form overlay)
│   ├── products/create/
│   │   └── page.ts                   # → /admin/products/create (form overlay)
│   └── dashboard/
│       └── page.ts                   # → /admin/dashboard
├── blocks/                           # Custom blocks (auto-discovered)
│   ├── inventory-matrix.tsx
│   └── pricing-editor.tsx
└── components/                       # Local React components (not blocks)
    └── product-card.tsx
```

**Auto-discovered:**
- `config.ts` → SPA configuration (navigation, branding)
- `pages/` → file-based routing (`.ts` for specs, `.tsx` for React pages)
- `blocks/` → custom blocks (kebab-case filename → PascalCase type)

**Route = filesystem path.** No route declaration in `definePage()`.

**`.ts` not `.tsx`** — pages export `definePage()` or `defineForm()` specs (pure data), not JSX. Only files in `blocks/` and `components/` are `.tsx`.

---

## defineSpa()

Defines the SPA's configuration: navigation, branding, settings. Auto-discovered from `src/spa/{name}/config.ts`.

```typescript
// src/spa/admin/config.ts
import { defineSpa } from '@manta/dashboard-core'

export default defineSpa({
  title: 'Commerce Admin',
  logo: '/logo.svg',
  favicon: '/favicon.ico',
  primaryColor: '#6366f1',

  navigation: [
    { icon: 'LayoutGrid', label: 'Dashboard', to: '/dashboard' },
    { icon: 'Tag', label: 'Products', to: '/products', items: [
      { label: 'Categories', to: '/categories' },
      { label: 'Collections', to: '/collections' },
    ]},
    { icon: 'ShoppingCart', label: 'Orders', to: '/orders' },
    { icon: 'Users', label: 'Customers', to: '/customers', items: [
      { label: 'Groups', to: '/customer-groups' },
    ]},
  ],

  settings: [
    { icon: 'Store', label: 'Store Details', to: '/settings/store' },
    { icon: 'Users', label: 'Team', to: '/settings/team' },
    { icon: 'Key', label: 'API Keys', to: '/settings/api-keys' },
  ],

  defaultRedirect: '/dashboard',
})
```

### Navigation

| Property | Type | Description |
|----------|------|-------------|
| `icon` | `string` | Lucide icon name (`'Users'`, `'Tag'`, `'ShoppingCart'`, etc.) |
| `label` | `string` | Display label in the sidebar |
| `to` | `string` | Route path |
| `items` | `Array<{ label, to }>` | Nested sub-items (one level) |

### Branding

| Property | Type | Description |
|----------|------|-------------|
| `title` | `string` | App name in sidebar header |
| `logo` | `string` | Path to logo image |
| `favicon` | `string` | Path to favicon |
| `primaryColor` | `string` | Brand color (CSS value) |

### Settings

`settings` defines a separate navigation section at the bottom of the sidebar (gear icon). Same interface as `navigation` items.

---

## definePage()

A page is a composition of blocks with optional layout.

### Listing page

```typescript
// src/spa/admin/pages/products/page.ts
export default definePage({
  header: { title: 'Products', actions: ['create'] },
  main: [
    {
      type: 'DataTable',
      query: {
        graph: {
          entity: 'product',
          fields: ['title', 'status', 'price', 'created_at'],
          pagination: { limit: 20 },
          sort: { field: 'created_at', order: 'desc' },
        },
      },
      columns: [
        { key: 'title', label: 'Product' },
        { key: 'price', label: 'Price', format: 'currency' },
        { key: 'status', label: 'Status', format: 'badge' },
        { key: 'created_at', label: 'Created', format: 'date' },
      ],
      searchable: ['title'],
      navigateTo: '/admin/products/:id',
    },
  ],
})
```

### Detail page

```typescript
// src/spa/admin/pages/products/[id]/page.ts
export default definePage({
  header: { titleField: 'title', statusField: 'status', actions: ['edit', 'delete'] },
  main: [
    {
      type: 'InfoCard',
      title: 'General',
      query: {
        graph: {
          entity: 'product',
          fields: ['title', 'description', 'handle', 'price'],
        },
      },
    },
    {
      type: 'RelationTable',
      title: 'Variants',
      query: {
        graph: {
          entity: 'product',
          relations: ['variant'],
          fields: ['variant.sku', 'variant.price', 'variant.stock'],
        },
      },
      columns: [
        { key: 'sku', label: 'SKU' },
        { key: 'price', label: 'Price', format: 'currency' },
        { key: 'stock', label: 'Stock', format: 'number' },
      ],
    },
    {
      type: 'MediaCard',
      query: {
        graph: {
          entity: 'product',
          relations: ['image'],
        },
      },
    },
  ],
  sidebar: [
    {
      type: 'InfoCard',
      title: 'Status',
      query: {
        graph: {
          entity: 'product',
          fields: ['status'],
        },
      },
    },
    {
      type: 'InfoCard',
      title: 'Dates',
      query: {
        graph: {
          entity: 'product',
          fields: ['created_at', 'updated_at'],
        },
      },
    },
  ],
})
```

### Dashboard page (multiple entities, no shared entity)

```typescript
// src/spa/admin/pages/dashboard/page.ts
export default definePage({
  header: { title: 'Dashboard' },
  main: [
    {
      type: 'StatsCard',
      query: { name: 'dashboard-stats', input: { period: 'month' } },
      metrics: [
        { key: 'orders_count', label: 'Orders', format: 'number' },
        { key: 'revenue', label: 'Revenue', format: 'currency' },
        { key: 'new_customers', label: 'New Customers', format: 'number' },
      ],
    },
    {
      type: 'DataTable',
      title: 'Recent Orders',
      query: {
        graph: {
          entity: 'order',
          fields: ['number', 'total', 'status', 'created_at'],
          pagination: { limit: 5 },
          sort: { field: 'created_at', order: 'desc' },
        },
      },
      columns: [
        { key: 'number', label: 'Order' },
        { key: 'total', label: 'Total', format: 'currency' },
        { key: 'status', label: 'Status', format: 'badge' },
      ],
    },
  ],
})
```

### Layout rules

- **`sidebar` present** → two-column layout (main + sidebar)
- **`sidebar` absent** → single-column layout
- **No layout declaration needed** — inferred from structure

---

## defineForm()

Forms render as overlays (FocusModal by default) on top of the parent route.

### Simple create form

```typescript
// src/spa/admin/pages/products/create/page.ts
export default defineForm({
  title: 'Create Product',
  command: 'create-product',
  fields: [
    { key: 'title', label: 'Title', type: 'text', required: true },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'handle', label: 'Handle', type: 'text' },
    { key: 'price', label: 'Price', type: 'currency' },
    { key: 'status', label: 'Status', type: 'select', options: ['draft', 'active', 'archived'] },
  ],
})
```

### Edit form

```typescript
// src/spa/admin/pages/products/[id]/edit/page.ts
export default defineForm({
  title: 'Edit Product',
  command: 'update-product',
  query: {
    graph: {
      entity: 'product',
      fields: ['title', 'description', 'handle', 'price', 'status'],
    },
  },
  fields: [
    { key: 'title', label: 'Title', type: 'text', required: true },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'handle', label: 'Handle', type: 'text' },
    { key: 'price', label: 'Price', type: 'currency' },
    { key: 'status', label: 'Status', type: 'select', options: ['draft', 'active', 'archived'] },
  ],
})
```

The framework detects edit mode from the route (`:id` param) and pre-fills the form with data from the `query`.

### Multi-step form

```typescript
// src/spa/admin/pages/products/create/page.ts
export default defineForm({
  title: 'Create Product',
  command: 'create-product',
  steps: [
    {
      name: 'General',
      fields: [
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'description', label: 'Description', type: 'textarea' },
        { key: 'price', label: 'Price', type: 'currency' },
      ],
    },
    {
      name: 'Media',
      blocks: [
        { type: 'MediaUpload', relation: 'images', multiple: true },
      ],
    },
    {
      name: 'Inventory',
      blocks: [
        { type: 'InventoryMatrix', warehouses: ['paris', 'lyon'] },
      ],
    },
  ],
})
```

Each step contains either `fields` (auto-rendered form fields) or `blocks` (custom block components).

### Form field types

| Type | Renders as | Deduced from model |
|------|-----------|-------------------|
| `text` | Input | `field.text()` |
| `textarea` | Textarea | `field.text()` with long content |
| `number` | Number input | `field.number()` |
| `currency` | Currency input | `field.number()` with currency context |
| `select` | Select dropdown | `field.enum([...])` |
| `boolean` | Toggle switch | `field.boolean()` |
| `date` | Date picker | `field.dateTime()` |
| `entity-select` | EntitySelect modal | From `defineLink()` |
| `media` | File upload | Relation to file entity |

---

## Query in blocks

Every block that needs data declares a `query` prop. Two modes, matching the backend exactly:

### Graph query — `useGraphQuery()` under the hood

```typescript
query: {
  graph: {
    entity: 'product',
    fields: ['title', 'status', 'price'],
    filters: { status: 'active' },
    relations: ['variant', 'image'],
    pagination: { limit: 20, offset: 0 },
    sort: { field: 'created_at', order: 'desc' },
  },
}
```

This is the exact same contract as `query.graph()` in the backend and `useGraphQuery()` in `@manta/sdk`. The block calls `useGraphQuery()` internally with this config.

**Requires** `defineQueryGraph()` in the SPA's context. If the context has `defineQueryGraph('*')`, all entities are available. If scoped, only listed entities work. If no `defineQueryGraph` exists, graph queries are not available — use named queries instead.

### Named query — `useQuery()` under the hood

```typescript
query: {
  name: 'dashboard-stats',
  input: { period: 'month' },
}
```

Calls the `defineQuery()` endpoint. The input matches the Zod schema defined in the backend.

---

## Query consolidation (automatic)

The framework reads all `query` props from all blocks on a page. When multiple blocks query the same entity, the framework consolidates them into a single prefetch:

```
Page: products/[id]

Block 1 (InfoCard):      graph: { entity: 'product', fields: ['title', 'description'] }
Block 2 (RelationTable): graph: { entity: 'product', relations: ['variant'] }
Block 3 (MediaCard):     graph: { entity: 'product', relations: ['image'] }
Block 4 (InfoCard):      graph: { entity: 'product', fields: ['status', 'created_at'] }

Framework consolidates → 1 prefetch:
  entity: 'product'
  fields: ['title', 'description', 'status', 'created_at']
  relations: ['variant', 'image']

Each block calls useGraphQuery() → TanStack Query cache hit → no extra request.
```

**This is transparent.** Blocks don't know about the consolidation. They call `useGraphQuery()` with their own query. The framework pre-populated the cache. If a block queries a different entity, it gets its own request — no consolidation attempted.

**Consolidation is a performance optimization, not a requirement.** If a block does its own fetch internally (autonomous block), it works — just with an extra request.

---

## Blocks

Blocks are the building blocks of pages. Three categories:

### 1. Framework blocks (built-in)

Provided by `@manta/dashboard-core`. Generic, configurable via props. They receive `query` as a prop and call `useGraphQuery()` or `useQuery()` internally.

| Block | Purpose |
|-------|---------|
| `DataTable` | List with columns, search, sort, filter, pagination, row actions |
| `InfoCard` | Key-value display (title + fields) |
| `RelationTable` | Related entities table |
| `RelationList` | Related entities as a list (display variant) |
| `MediaCard` | Image/file gallery |
| `StatsCard` | Metric cards |
| `ActivityCard` | Event timeline |
| `JsonCard` | Raw JSON display |
| `TreeList` | Hierarchical list |
| `PageHeader` | Title, status badge, action buttons (used via `header` shortcut) |

### 2. Autonomous blocks (custom, self-contained)

A developer creates a standard React component. It handles its own data fetching, state, and rendering. No framework contract to follow.

```tsx
// src/spa/admin/blocks/product-quick-stats.tsx
import { useGraphQuery } from '@manta/sdk'
import { useParams } from 'react-router-dom'

export default function ProductQuickStats() {
  const { id } = useParams()
  const { data } = useGraphQuery({
    entity: 'product',
    filters: { id },
    relations: ['variant', 'order'],
  })

  const product = data?.[0]
  if (!product) return null

  return (
    <div>
      <span>{product.variant?.length ?? 0} variants</span>
      <span>{product.order?.length ?? 0} orders</span>
    </div>
  )
}
```

Usage in `definePage()`:

```typescript
main: [
  { type: 'ProductQuickStats' },  // no query prop — it fetches its own data
]
```

**Trade-off:** Does not benefit from query consolidation. Makes its own request.

### 3. Custom generic blocks (reusable, optimized)

A developer creates a reusable block that accepts `query` as a prop — same pattern as framework blocks. Benefits from query consolidation.

```tsx
// src/spa/admin/blocks/inventory-matrix.tsx
import { useGraphQuery } from '@manta/sdk'

interface InventoryMatrixProps {
  query: Parameters<typeof useGraphQuery>[0]
  warehouses?: string[]
  editable?: boolean
}

export default function InventoryMatrix({ query, warehouses = ['default'], editable = true }: InventoryMatrixProps) {
  const { data } = useGraphQuery(query)
  // ... render matrix from data
}
```

Usage in `definePage()`:

```typescript
main: [
  {
    type: 'InventoryMatrix',
    query: { graph: { entity: 'product', relations: ['variant'] } },
    warehouses: ['paris', 'lyon'],
  },
]
```

**Benefits from consolidation** because the framework sees the `query` prop in the spec and includes it in the prefetch.

### Block resolution

| Priority | Source |
|----------|--------|
| 1 | `src/spa/{name}/blocks/` (app blocks — overrides framework blocks if same name) |
| 2 | `@manta/dashboard-core` built-in blocks |

A block in `blocks/info-card.tsx` overrides the framework's `InfoCard`. All pages using `{ type: 'InfoCard' }` will use the app's version.

### Block discovery

Blocks in `src/spa/{name}/blocks/` are auto-discovered by filename:

```
blocks/
  inventory-matrix.tsx    → type: 'InventoryMatrix'
  pricing-editor.tsx      → type: 'PricingEditor'
  info-card.tsx           → type: 'InfoCard' (overrides framework)
```

Filename is kebab-case, block type is PascalCase. The `export default` must be a React component.

---

## Header shortcut

`header` is a shortcut — not a block in `main`. It renders a `PageHeader` at the top of the page.

```typescript
// Simple listing
header: { title: 'Products', actions: ['create'] }

// Detail page with dynamic title
header: { titleField: 'title', statusField: 'status', actions: ['edit', 'delete'] }
```

`actions` are predefined behaviors:

| Action | Behavior |
|--------|----------|
| `'create'` | Navigate to `./create` |
| `'edit'` | Navigate to `./edit` |
| `'delete'` | Confirm dialog → execute `delete-{entity}` command |

For custom actions:

```typescript
header: {
  title: 'Products',
  actions: [
    'create',
    { label: 'Export', command: 'export-products' },
    { label: 'Import', to: '/admin/products/import' },
  ],
}
```

---

## Typing

The framework generates types from backend definitions. In `definePage()` and `defineForm()`:

- **Graph queries** — entity names, field names, and relation names are autocompleted based on the `defineQueryGraph()` access rules of the SPA's context
- **Named queries** — query names and input schemas are autocompleted based on `defineQuery()` definitions in the SPA's context
- **Commands** — command names in `defineForm()` and header actions are autocompleted based on `defineCommand()` definitions
- **Block types** — autocompleted from framework blocks + discovered custom blocks

If the context has `defineQueryGraph('*')`, all entities and fields are available. If scoped (`defineQueryGraph({ product: true })`), only allowed entities appear. If no `defineQueryGraph`, graph queries are not available — only named queries.

```typescript
// ✅ TypeScript OK — 'product' is allowed in admin context
query: { graph: { entity: 'product', fields: ['title', 'status'] } }

// ❌ TypeScript error — 'banana' is not a field of 'product'
query: { graph: { entity: 'product', fields: ['banana'] } }

// ❌ TypeScript error — 'secret-data' query does not exist in admin context
query: { name: 'secret-data' }

// ❌ TypeScript error — graph queries not available (no defineQueryGraph in this context)
query: { graph: { entity: 'product' } }
```

---

## Summary

| Primitive | Purpose | File | Contains React? |
|-----------|---------|------|----------------|
| `defineSpa()` | SPA config (navigation, branding) | `config.ts` | No |
| `definePage()` | Display page (listing, detail, dashboard) | `pages/**/page.ts` | No |
| `defineForm()` | Form overlay (create, edit) | `pages/**/page.ts` | No |
| Custom block | Reusable UI component | `blocks/*.tsx` | Yes |

| Concept | Rule |
|---------|------|
| SPA config | `src/spa/{name}/config.ts` — auto-discovered |
| Route | Filesystem path (no declaration) |
| Layout | Inferred: `sidebar` present → two-column, absent → single-column |
| Form display | FocusModal by default |
| Data fetching | Each block owns its query (prop or internal) |
| Query consolidation | Automatic — framework prefetches, blocks get cache hits |
| Block override | Same filename in `blocks/` → overrides framework block |
| Block discovery | `blocks/` folder, auto-discovered, kebab-case filename → PascalCase type |
