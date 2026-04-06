# SPA, Dashboard & SDK

## SPA — Auto-detected from filesystem

SPAs are auto-detected from `src/spa/{name}/`. No boilerplate — just pages.

```
src/spa/admin/
├── config.ts                   # defineSpa() — navigation, title, branding
├── pages/
│   ├── page.tsx                # → /admin/ (React page)
│   ├── products/
│   │   └── page.ts             # → /admin/products (definePage spec)
│   ├── products/[id]/
│   │   └── page.ts             # → /admin/products/:id (definePage spec)
│   │   └── edit/
│   │       └── page.ts         # → /admin/products/:id/edit (defineForm spec)
│   ├── products/create/
│   │   └── page.ts             # → /admin/products/create (defineForm spec)
│   └── settings/
│       └── page.tsx            # → /admin/settings (React page)
├── blocks/                     # Custom blocks (auto-discovered)
│   └── inventory-matrix.tsx
└── components/                 # Local components (imported by blocks/pages)
    └── product-card.tsx
```

**Auto-discovered:**
- `config.ts` → SPA configuration (navigation, branding, settings)
- `pages/` → file-based routing
- `blocks/` → custom blocks

**Two page formats:**
- **`.ts`** — exports `definePage()` or `defineForm()` spec (declarative, no React)
- **`.tsx`** — exports a React component (full control, for complex cases)

**Defaults**: `@manta/dashboard` shell + `@manta/ui` preset. Override in config if needed:

```typescript
// manta.config.ts — optional, only for overrides
export default defineConfig({
  spa: {
    admin: { preset: '@manta/ui-preset-dark' },
    vendor: { dashboard: null },  // no shell, custom SPA
  },
})
```

---

## SPA Configuration — defineSpa()

Define navigation, branding, and settings in `src/spa/{name}/config.ts`. See [Dashboard](./17-dashboard.md) for the full reference.

```typescript
// src/spa/admin/config.ts
import { defineSpa } from '@manta/dashboard-core'

export default defineSpa({
  title: 'Commerce Admin',
  logo: '/logo.svg',
  favicon: '/favicon.ico',

  navigation: [
    { icon: 'Tag', label: 'Products', to: '/products' },
    { icon: 'Users', label: 'Customers', to: '/customers', items: [
      { label: 'Groups', to: '/customer-groups' },
    ]},
  ],

  settings: [
    { icon: 'Store', label: 'Store Details', to: '/settings/store' },
    { icon: 'Key', label: 'API Keys', to: '/settings/api-keys' },
  ],
})
```

---

## Declarative Pages — definePage() & defineForm()

The preferred approach. Pages are pure data specs — no React, no JSX. See [Dashboard](./17-dashboard.md) for the full reference.

### Listing page

```typescript
// src/spa/admin/pages/customers/page.ts
import { definePage } from '@manta/dashboard-core'

export default definePage({
  header: { title: 'Customers', actions: ['create'] },
  main: [
    {
      type: 'DataTable',
      query: {
        graph: {
          entity: 'customer',
          fields: ['email', 'first_name', 'last_name', 'created_at'],
          pagination: { limit: 20 },
        },
      },
      columns: [
        { key: 'email', label: 'Email' },
        { key: 'first_name', label: 'First Name' },
        { key: 'last_name', label: 'Last Name' },
        { key: 'created_at', label: 'Joined', format: 'date' },
      ],
      searchable: true,
      navigateTo: '/customers/:id',
    },
  ],
})
```

### Detail page

```typescript
// src/spa/admin/pages/customers/[id]/page.ts
import { definePage } from '@manta/dashboard-core'

export default definePage({
  header: { titleField: 'email', actions: ['edit', 'delete'] },
  main: [
    {
      type: 'InfoCard',
      title: 'General',
      query: {
        graph: {
          entity: 'customer',
          fields: ['first_name', 'last_name', 'email', 'phone'],
        },
      },
    },
  ],
  sidebar: [
    {
      type: 'InfoCard',
      title: 'Dates',
      query: {
        graph: {
          entity: 'customer',
          fields: ['created_at', 'updated_at'],
        },
      },
      fields: [
        { key: 'created_at', label: 'Created', display: 'date' },
        { key: 'updated_at', label: 'Updated', display: 'date' },
      ],
    },
  ],
})
```

### Create form

```typescript
// src/spa/admin/pages/customers/create/page.ts
import { defineForm } from '@manta/dashboard-core'

export default defineForm({
  title: 'Create Customer',
  command: 'create-customer',
  fields: [
    { key: 'email', label: 'Email', type: 'text', required: true },
    { key: 'first_name', label: 'First Name', type: 'text' },
    { key: 'last_name', label: 'Last Name', type: 'text' },
    { key: 'phone', label: 'Phone', type: 'text' },
  ],
})
```

### Edit form

```typescript
// src/spa/admin/pages/customers/[id]/edit/page.ts
import { defineForm } from '@manta/dashboard-core'

export default defineForm({
  title: 'Edit Customer',
  command: 'update-customer',
  query: {
    graph: {
      entity: 'customer',
      fields: ['first_name', 'last_name', 'email', 'phone'],
    },
  },
  fields: [
    { key: 'first_name', label: 'First Name', type: 'text' },
    { key: 'last_name', label: 'Last Name', type: 'text' },
    { key: 'email', label: 'Email', type: 'text', required: true },
    { key: 'phone', label: 'Phone', type: 'text' },
  ],
})
```

---

## React Pages — Full Control

For complex pages that need full React control (custom interactions, animations, etc.), use `.tsx` files:

```tsx
// src/spa/admin/pages/dashboard/page.tsx
import { useGraphQuery, useCommand } from '@manta/sdk'
import { Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge } from '@manta/ui'
import { useNavigate } from 'react-router-dom'

export default function DashboardPage() {
  const { data: orders } = useGraphQuery({ entity: 'order', pagination: { limit: 5 } })
  // ... full React control
}
```

---

## Custom Blocks

Blocks are standard React components in `src/spa/{name}/blocks/`. Auto-discovered, available in `definePage()` specs.

```tsx
// src/spa/admin/blocks/inventory-matrix.tsx
import { useGraphQuery } from '@manta/sdk'

interface InventoryMatrixProps {
  query: Parameters<typeof useGraphQuery>[0]
  warehouses?: string[]
}

export default function InventoryMatrix({ query, warehouses = ['default'] }: InventoryMatrixProps) {
  const { data } = useGraphQuery(query)
  // ... render matrix
}
```

Usage in a page spec:

```typescript
main: [
  { type: 'InventoryMatrix', query: { graph: { entity: 'product', relations: ['variant'] } }, warehouses: ['paris'] },
]
```

**Override framework blocks**: Create a block with the same kebab-case filename as a framework block (e.g., `blocks/info-card.tsx` overrides the built-in `InfoCard`).

---

## Component Reference

### @manta/dashboard-core — blocks (used in definePage specs)

| Block | Purpose |
|-------|---------|
| `DataTable` | List with columns, search, sort, filter, pagination |
| `InfoCard` | Key-value card with fields |
| `RelationTable` | Related entities table |
| `MediaCard` | Image/file gallery |
| `StatsCard` | Metric cards |
| `PageHeader` | Title, status badge, actions (used via `header` shortcut) |

### @manta/dashboard-core — patterns (used in React pages)

| Component | Purpose |
|-----------|---------|
| `FocusModal` | Full-width modal with header/footer for forms |
| `EntitySelect` | Searchable selection table in a modal |
| `MultiStepForm` | Multi-step wizard with stepper |
| `EditableTable` | Inline editable table (Excel-like) |
| `BulkActionBar` | Floating action bar for multi-select |
| `ConfirmDialog` | Confirmation dialog for destructive actions |

### @manta/ui (shadcn/ui — 26 components)

| Category | Components |
|----------|-----------|
| **Form** | Input, Label, Select, Textarea, Checkbox, Switch, RadioGroup |
| **Layout** | Card, Separator, Tabs, ScrollArea |
| **Feedback** | Alert, Badge, Skeleton, Progress, Toaster/toast |
| **Overlay** | Dialog, Sheet, AlertDialog, Popover, Tooltip, DropdownMenu |
| **Data** | Table, Pagination |
| **Navigation** | Button, Command (Cmd+K) |
| **Display** | Avatar |

### @manta/sdk (hooks — 4 hooks + client)

| Hook | Purpose |
|------|---------|
| `useCommand('name')` | Execute a command (mutation) — autocomplete |
| `useQuery('name', params)` | Execute a named query — autocomplete |
| `useGraphQuery({ entity })` | Graph query (flexible reads) — autocomplete |
| `useAuth()` | Login, logout, me, isAuthenticated |

---

## AI Agent — Setup & Configuration

The dashboard includes a built-in AI conversational agent that can create pages, modify components, and query data through the query graph.

### Setup

1. Set environment variables:

```bash
# .env
MANTA_AI_PROVIDER=anthropic          # or 'openai'
ANTHROPIC_API_KEY=sk-ant-...         # your API key
# MANTA_AI_MODEL=claude-sonnet-4-20250514   # optional model override
```

2. The AI panel appears automatically in the dashboard shell (bottom-right sparkle icon). It's enabled when `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY` for OpenAI) is set.

### What the AI can do

| Capability | How |
|-----------|-----|
| **Create pages** | AI generates `definePage()` / `defineForm()` specs |
| **Modify blocks** | AI updates block props (columns, filters, etc.) |
| **Query data** | AI uses the query graph to browse entities |
| **Navigate** | AI adds/removes navigation items in the sidebar |

### Providers

| Provider | Env var | Default model |
|----------|---------|--------------|
| Anthropic | `ANTHROPIC_API_KEY` | `claude-sonnet-4-20250514` |
| OpenAI | `OPENAI_API_KEY` | `gpt-4o` |

Set `MANTA_AI_PROVIDER` to switch providers. Default: `anthropic`.
