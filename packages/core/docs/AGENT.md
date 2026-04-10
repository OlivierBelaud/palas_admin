# Manta — AI Agent Instructions

You are working in a **standalone Manta project**. Manta is a filesystem-first framework with an integrated database. You write models, services, commands, queries, and the framework generates HTTP API, auth, admin dashboard, AI tools, and OpenAPI documentation automatically.

## Architecture

**Filesystem-first**: The structure of your folders IS your configuration. No routing files, no module registration. The framework scans and wires everything at boot.

**CQRS**: Commands = mutations (write), Queries = reads. Commands are compensable workflows. Queries use the Query Graph for cross-module joins.

**1 entity = 1 service**: Each entity has its own service. A service mutates ONE entity only. Cross-entity mutations go in commands.

**Constraint as Convention**: The framework prevents mistakes structurally. Services only receive their repository. Compensation is automatic via snapshots.

## The primitives

All `define*` functions are **globals** — zero imports needed:

| Function | Purpose | Location |
|----------|---------|----------|
| `defineModel()` | Entity schema (DML) | `src/modules/{mod}/entities/{entity}/model.ts` |
| `defineService()` | Custom mutations per entity | `src/modules/{mod}/entities/{entity}/service.ts` |
| `defineCommand()` | Compensable workflow (= API endpoint) | `src/commands/{context}/{name}.ts` |
| `defineWorkflow()` | Intra-module workflow (business logic) | `src/modules/{mod}/workflows/{name}.ts` |
| `defineQuery()` | Read endpoint (CQRS read side) | `src/queries/{context}/{name}.ts` |
| `defineQueryGraph()` | Expose query graph to frontend | `src/queries/{context}/graph.ts` |
| `extendQueryGraph()` | Resolver for external entities (PostHog, Stripe…) | `src/modules/{mod}/queries/graph.ts` |
| `defineSubscriber()` | Event reaction | `src/subscribers/{name}.ts` |
| `defineJob()` | Scheduled cron (dispatches commands) | `src/jobs/{name}.ts` |
| `defineLink()` | Relation (intra-module or cross-module) | `src/links/` or `src/modules/{mod}/links/` |
| `defineAgent()` | Typed AI step (LLM call) | `src/agents/{name}.ts` |
| `defineUserModel()` | Augmented defineModel with auth | `src/modules/{mod}/entities/{entity}/model.ts` |
| `defineMiddleware()` | Override per-context auth middleware | `src/middleware/{context}.ts` |
| `defineConfig()` | App configuration | `manta.config.ts` |
| `definePreset()` | Adapter preset (dev/prod) | Config or package |

Helpers: `field.*` (property types), `many()` (cardinality), `listParams()` / `retrieveParams()` (query input helpers), `fromZodSchema()` (convert a Zod schema into DML fields, typically for external models).

> **Note:** Relations between entities are defined exclusively with `defineLink()`. There is no `field.relation()`, `belongsTo()`, `hasMany()`, or `hasOne()` API.

## Project structure

```
src/
├── modules/                    # Business logic (filesystem = module)
│   ├── catalog/
│   │   ├── entities/
│   │   │   ├── product/
│   │   │   │   ├── model.ts    # defineModel('Product', { ... })
│   │   │   │   └── service.ts  # defineService('product', ({ db }) => ({ ... }))
│   │   │   └── category/
│   │   │       └── model.ts
│   │   ├── links/
│   │   │   └── product-category.ts  # defineLink (intra-module)
│   │   └── workflows/
│   │       └── categorize-product.ts  # defineWorkflow (scoped, no auth)
│   ├── inventory/
│   │   └── entities/
│   │       └── inventory-item/
│   │           └── model.ts
│   └── admin/
│       └── entities/
│           └── admin/
│               └── model.ts    # defineUserModel('admin', { role: field.enum([...]) })
│
├── commands/                   # Mutations (context = folder name)
│   ├── admin/
│   │   ├── create-product.ts   # → POST /api/admin/command/create-product
│   │   └── bulk-import.ts
│   └── store/
│       └── place-order.ts      # → POST /api/store/command/place-order
│
├── queries/                    # Reads (context = folder name)
│   ├── admin/
│   │   ├── list-products.ts    # → GET /api/admin/list-products
│   │   └── graph.ts            # defineQueryGraph('*') → POST /api/admin/graph
│   └── store/
│       ├── get-catalog.ts      # → GET /api/store/get-catalog
│       └── graph.ts            # defineQueryGraph({ product: true, order: (auth) => ... })
│
├── subscribers/                # Event reactions
│   └── product-created.ts
├── jobs/                       # Cron tasks (dispatch commands)
│   └── cleanup-drafts.ts
├── links/                      # Cross-module relations
│   └── product-inventory.ts
├── agents/                     # AI agents
│   └── categorize-product.ts
├── middleware/                 # Per-context auth overrides (optional)
│   └── admin.ts
├── spa/                        # Single Page Applications (auto-detected)
│   ├── admin/
│   │   └── pages/
│   │       ├── page.tsx        # → /admin/
│   │       └── products/
│   │           └── page.tsx    # → /admin/products
│   └── vendor/
│       └── pages/
│           └── page.tsx
└── manta.config.ts
```

## How things work

### defineModel — Data entities

```typescript
// src/modules/catalog/entities/product/model.ts
export default defineModel('Product', {
  title: field.text(),
  description: field.text().nullable(),
  price: field.bigNumber(),
  status: field.enum(['draft', 'active', 'archived']).default('draft'),
  sku: field.text().unique(),
})
```

Auto-generates: database table, TypeScript types, CRUD service methods.

### defineService — Custom mutations

```typescript
// src/modules/catalog/entities/product/service.ts
export default defineService('product', ({ db }) => ({
  activate: async (id: string) => {
    await db.update({ id, status: 'active' })
  },
}))
```

- First arg: entity name (string, autocompletes from codegen)
- Factory receives `{ db, log }` — db is a typed repository, log is ILoggerPort
- Auto-generated CRUD: `createProducts()`, `listProducts()`, `retrieveProduct()`, `updateProducts()`, `deleteProducts()`, `softDeleteProducts()`, `restoreProducts()`
- Compensation is automatic via repository snapshots

### defineCommand — Compensable workflows

```typescript
// src/commands/admin/create-product.ts
export default defineCommand({
  name: 'create-product',
  description: 'Create a product with initial inventory',
  input: z.object({
    title: z.string(),
    sku: z.string(),
    price: z.number(),
  }),
  workflow: async (input, { step, log, auth, headers }) => {
    const product = await step.service.catalog.create({
      title: input.title,
      sku: input.sku,
      price: input.price,
    })
    await step.emit('product.created', { id: product.id, sku: input.sku })
    return product
  },
})
```

- Folder = context: `commands/admin/` → `POST /api/admin/command/create-product`
- `step.service.MODULE.METHOD()` — auto-compensated
- `step.command.NAME()` — sub-command
- `step.workflow.MODULE.NAME()` — call a module workflow
- `step.agent.NAME()` — AI call (checkpointed)
- `step.action('name', { invoke, compensate })` — external action
- `step.emit('event', data)` — fire event
- `step.link(a, b)` — link entities
- `auth` — authenticated user (`{ id, type, email }`) or null
- `headers` — raw request headers (for custom context like `x-property-id`)

### defineWorkflow — Intra-module business logic

```typescript
// src/modules/catalog/workflows/categorize-product.ts
export default defineWorkflow({
  name: 'categorize-product',
  input: z.object({
    productId: z.string(),
    categoryId: z.string(),
  }),
  workflow: async (input, { step, log }) => {
    const product = await step.service.catalog.retrieveProduct(input.productId)
    await step.service.catalog.update(input.productId, { category_id: input.categoryId })
    log.info(`Product ${product.id} categorized`)
    return { productId: product.id }
  },
})
```

- Scoped to the module: can only call `step.service.MODULE.*` for its own module's entities
- Receives `{ step, log }` — NO `auth`, NO `headers` (pure business logic)
- Has compensation (same step proxy as commands)
- Called from commands via `step.workflow.MODULE.NAME(input)`
- NOT an HTTP endpoint — only callable as a sub-workflow from commands

### defineQuery — Read endpoints

```typescript
// src/queries/admin/list-products.ts
export default defineQuery({
  name: 'list-products',
  description: 'List products with filtering',
  input: z.object({
    status: z.string().optional(),
    ...listParams(),  // adds limit, offset, sort, order, search
  }),
  handler: async (input, { query, log, auth, headers }) => {
    return query.graph({
      entity: 'product',
      filters: input.status ? { status: input.status } : undefined,
      pagination: { take: input.limit, skip: input.offset },
    })
  },
})
```

- Handler receives `{ query, log, auth, headers }` — NO `app` (forced to use query graph)
- `query.graph()` for cross-module joins
- `listParams()` helper adds standard pagination/sort/search fields
- `retrieveParams()` helper adds `{ id, fields }` for single entity lookups
- Relation field syntax: use `fields: ['*', 'relation.*']` to eagerly load related entities (e.g., `fields: ['*', 'addresses.*']`). For M:N links with extraColumns, pivot columns are merged into each target entity.
- `relPagination`: paginate relation results independently, e.g., `relPagination: { orders: { take: 5, skip: 0 } }`

### defineQueryGraph — Expose query graph to frontend

```typescript
// src/queries/admin/graph.ts — full access (admin/AI)
export default defineQueryGraph('*')

// src/queries/store/graph.ts — scoped access with row-level filtering
export default defineQueryGraph({
  product: true,                                   // all products
  category: true,                                  // all categories
  order: (auth) => ({ customer_id: auth.id }),     // only MY orders
  customer: (auth) => ({ id: auth.id }),           // only MY profile
})
```

- `'*'` = wildcard, all entities, all rows (admin/AI use case)
- `true` = all rows for this entity
- `(auth) => filters` = row-level filter applied automatically
- Not listed = not accessible (403)
- Creates `POST /api/{context}/graph` endpoint
- Frontend uses `useGraphQuery()` from `@manta/sdk`

### External entities — .external() + extendQueryGraph()

Use `.external()` on a model when the data lives in a third-party system (PostHog, Stripe, Shopify…). Manta keeps the entity visible to the query graph, AI tools, and `defineLink()`, but does NOT create a table, migration, or CRUD service.

```typescript
// src/modules/posthog/entities/posthog-event/model.ts
export default defineModel('PostHogEvent', {
  id: field.text().primaryKey(),
  event: field.text(),
  distinct_id: field.text(),
  timestamp: field.dateTime(),
  properties: field.json(),
}).external()

// Shortcut: build the field map from a Zod schema (e.g. generated from an SDK)
// export default defineModel('PostHogEvent', fromZodSchema(postHogEventSchema)).external()
```

Every module that owns external entities MUST register a resolver via `extendQueryGraph()` in `src/modules/{mod}/queries/graph.ts`:

```typescript
// src/modules/posthog/queries/graph.ts
export default extendQueryGraph({
  owns: ['PostHogEvent', 'PostHogPerson'],
  async resolve(query, { app, logger }) {
    // Translate the Manta GraphQueryConfig into a call to the external backend
    return await fetchFromPostHog(query)
  },
  supportedFilters: {
    PostHogEvent: ['distinct_id', 'event', 'timestamp'],
  },
})
```

- `owns` — entity names this module resolves (must match `defineModel` names).
- `resolve` — receives the Manta query graph config, returns normalized rows shaped like the model's schema.
- `supportedFilters` (optional) — whitelist accepted filters; unsupported filters throw a clear error.
- The engine hydrates relations transparently: joining a local `product` to a `PostHogEvent` via `defineLink()` will trigger one DB query + one resolver call.

### defineSubscriber — Event reactions

```typescript
// src/subscribers/product-created.ts
export default defineSubscriber('product.created', async (event, { command, log }) => {
  await command.initializeInventory({ productId: event.data.id })
})
```

- Handler receives `(event, { command, log })` — can ONLY dispatch commands
- Event names autocomplete from codegen (MantaEventMap)
- `makeIdempotent(cache, handler)` for at-least-once deduplication

### defineJob — Scheduled tasks

```typescript
// src/jobs/cleanup-drafts.ts
export default defineJob('cleanup-drafts', '0 3 * * *', async ({ command, log }) => {
  await command.cleanupDraftProducts({ olderThanDays: 30 })
})
```

- Same `{ command, log }` scope as subscribers — forces command dispatch
- Cron syntax for schedule
- Also accepts object form: `defineJob({ name, schedule, handler })`

### defineLink — Relations (unified API)

```typescript
// src/links/product-inventory.ts (cross-module — always creates pivot table)
export default defineLink('product', many('inventory_item'))

// src/modules/catalog/links/product-category.ts (intra-module — 1:N creates FK directly)
export default defineLink('product', many('category'))
```

- ONE API for all relations: cross-module and intra-module
- Cross-module (`src/links/`): always creates pivot tables
- Intra-module (`src/modules/{mod}/links/`): 1:1 and 1:N create FK directly, M:N creates pivot
- `many()` wraps for 1:N or M:N cardinality
- Cascade is automatic
- Extra columns on pivot: `defineLink('customer', many('address'), { type: field.text(), is_default: field.boolean().default(false) })` — extra columns are added to the pivot table schema, included in auto-generated link commands, and merged into target entities when using relation field syntax in queries

### defineUserModel — Augmented defineModel with auth

Use instead of `defineModel()` when an entity represents a user that can log in.
Place it in `model.ts` like any other entity — it IS a model, with auth on top.

```typescript
// src/modules/admin/entities/admin/model.ts
export default defineUserModel('admin', {
  role: field.enum(['super_admin', 'editor', 'viewer']),
})

// src/modules/customer/entities/customer/model.ts
export default defineUserModel('customer', {
  company_name: field.text().nullable(),
  phone: field.text().nullable(),
  has_account: field.boolean().default(false),
})
```

**The entity works like any defineModel** — has a service, links, workflows, appears in the query graph. **In addition, the framework auto-generates:**

Tables: `admin_user`, `admin_invite`

Auth routes (on `/api/admin/`):
- `POST /login` (public) — returns JWT with `{ id, type: 'admin' }`
- `DELETE /logout` (public) — blacklists token
- `POST /refresh` (public) — refresh token
- `POST /forgot-password` (public) — reset flow
- `POST /reset-password` (public) — confirm reset
- `POST /accept-invite` (public) — accept invitation

Protected routes (JWT required, `type === 'admin'`):
- `GET /me` — current user
- `GET /users` — list users
- `POST /create-user`, `POST /update-user`, `POST /delete-user`
- `POST /create-invite`, `POST /refresh-invite`

Middleware: all `/api/admin/*` routes verify JWT + `type === 'admin'`

Override: create `src/commands/admin/login.ts` to replace auto-generated login.
Override: create `src/middleware/admin.ts` to replace auto-generated middleware.

Dev seed: `admin@manta.local` / `admin` created automatically in dev mode.

### defineAgent — AI steps

```typescript
// src/agents/categorize-product.ts
export default defineAgent({
  name: 'categorize-product',
  description: 'Categorize a product into a department',
  input: z.object({ title: z.string() }),
  output: z.object({ category: z.enum(['electronics', 'clothing', 'food', 'other']) }),
  instructions: (input) => `Categorize this product: "${input.title}"`,
})
```

Used in commands via `step.agent.categorizeProduct(input)`. Checkpointed — if the workflow crashes after the agent step, result is recovered.

### SPA — Single Page Applications

SPAs are auto-detected from `src/spa/{name}/`. No boilerplate needed.

```
src/spa/admin/
└── pages/
    ├── page.tsx              # → /admin/
    └── products/
        └── page.tsx          # → /admin/products
```

Defaults: `@manta/dashboard` (shell) + `@manta/ui` (preset). Override in config:

```typescript
// manta.config.ts
export default defineConfig({
  spa: {
    admin: { preset: '@manta/ui-preset-dark' },     // change theme
    vendor: { dashboard: null },                     // no shell, custom SPA
  },
})
```

### SDK — Frontend hooks

```typescript
import { useCommand, useQuery, useGraphQuery, useAuth } from '@manta/sdk'

// Commands (autocomplete from MantaGeneratedCommands)
const createProduct = useCommand('create-product')
await createProduct.mutateAsync({ title: 'Widget', sku: 'W-001' })

// Named queries (autocomplete from MantaGeneratedQueries)
const { data } = useQuery('list-products', { status: 'active', limit: 10 })

// Graph queries (only if defineQueryGraph exists for context)
const { data } = useGraphQuery({ entity: 'product', relations: ['inventory_item'] })

// Auth
const { login, logout, me, isAuthenticated } = useAuth()
```

### Auth context

Commands and queries receive `auth` and `headers`:

```typescript
// auth.id — user ID (from admin_user.id, customer_user.id, etc.)
// auth.type — context type ('admin', 'customer')
// auth.email — user email
// headers['x-property-id'] — custom headers
```

`auth` is null on public routes. JWT is signed and verified — cannot be tampered with.

## Critical rules

1. **No API routes** — Define commands + queries. The framework generates endpoints from filesystem structure.
2. **1 entity = 1 service** — Each entity gets `model.ts` + optional `service.ts`. Services receive ONLY their entity's repository.
3. **defineWorkflow for intra-module logic** — Workflows in `src/modules/X/workflows/` orchestrate multiple entities within the same module. They receive `{ step, log }` (no auth).
4. **defineCommand for cross-module + HTTP** — Commands in `src/commands/` orchestrate any module and receive `{ step, log, auth, headers }`.
5. **Commands call workflows** — Use `step.workflow.MODULE.NAME(input)` to invoke module workflows from commands.
6. **Subscribers dispatch commands** — They receive `(event, { command, log })`, not direct service access.
7. **Jobs dispatch commands** — They receive `{ command, log }`, same scope as subscribers.
8. **No cross-module imports** — Modules cannot import from other modules. Use links.
9. **No field.relation()** — Relations are defined ONLY via `defineLink()`. No `belongsTo`, `hasMany`, `hasOne`.
10. **Events are at-least-once** — Use `makeIdempotent()` if duplicate processing is a problem.
11. **Entity names are PascalCase** — `Product`, `BlogPost`, `InventoryItem`.
12. **defineUserModel instead of defineModel** — When an entity represents a user that can log in, use `defineUserModel()` instead of `defineModel()`. It works like a model but adds auth routes, middleware, and invites.
13. **Query graph for reads** — In defineQuery, use `query.graph()`. No direct service access.
14. **External entities need a resolver** — Any `defineModel(...).external()` MUST be paired with `extendQueryGraph({ owns: [...], resolve })` in the same module, otherwise queries on that entity fail.

## Auto-generated from your code

| Your code | Framework generates |
|-----------|-------------------|
| `defineModel('Product', {...})` | DB table, TypeScript types, CRUD methods |
| `defineModel('Ext', {...}).external()` | Entity registry entry only — NO table, NO migration, NO CRUD service |
| `extendQueryGraph({ owns, resolve })` | Routes queries on owned external entities to the module's resolver |
| `defineService('product', ...)` | Custom service methods with auto-compensation |
| `defineCommand({ name: 'create-product', ... })` | `POST /api/{ctx}/command/create-product` |
| `defineQuery({ name: 'list-products', ... })` | `GET /api/{ctx}/list-products` |
| `defineQueryGraph('*')` | `POST /api/{ctx}/graph` |
| `defineUserModel('admin', {...})` | Table, auth routes, middleware, invite system, dev seed |
| `defineSubscriber('event', handler)` | Event subscription with typed data |
| `defineWorkflow({ name, input, workflow })` | Intra-module compensable workflow (no HTTP endpoint) |
| `defineLink('product', many('item'))` | FK (intra-module) or pivot table (cross-module) |
| `src/spa/admin/pages/*.tsx` | SPA with routing, dashboard shell, Vite build |

## Documentation

Complete framework documentation is in `node_modules/@manta/core/docs/`:

| Doc | Content |
|-----|---------|
| [00-overview](node_modules/@manta/core/docs/00-overview.md) | Philosophy, mental model |
| [01-getting-started](node_modules/@manta/core/docs/01-getting-started.md) | Create a project from scratch |
| [02-models](node_modules/@manta/core/docs/02-models.md) | defineModel() — properties, modifiers |
| [03-services](node_modules/@manta/core/docs/03-services.md) | defineService() — CRUD, compensation, typed repo |
| [04-users](node_modules/@manta/core/docs/04-users.md) | defineUserModel() — auth, CRUD, invites, middleware |
| [05-commands](node_modules/@manta/core/docs/05-commands.md) | defineCommand() — workflows, steps, compensation |
| [06-queries](node_modules/@manta/core/docs/06-queries.md) | defineQuery() + defineQueryGraph() |
| [07-events](node_modules/@manta/core/docs/07-events.md) | defineSubscriber() + defineJob() + defineWorkflow() |
| [08-links](node_modules/@manta/core/docs/08-links.md) | defineLink() — unified relation API (FK or pivot) |
| [09-agents](node_modules/@manta/core/docs/09-agents.md) | defineAgent() — AI steps, checkpointing |
| [10-spa](node_modules/@manta/core/docs/10-spa.md) | SPA system, dashboard, SDK |
| [11-config](node_modules/@manta/core/docs/11-config.md) | defineConfig(), CLI, presets |
| [12-constraints](node_modules/@manta/core/docs/12-constraints.md) | Validations, error messages |
| [13-testing](node_modules/@manta/core/docs/13-testing.md) | Testing guide |
| [14-adapters](node_modules/@manta/core/docs/14-adapters.md) | Custom adapters |
| [15-hosts](node_modules/@manta/core/docs/15-hosts.md) | Custom hosts |
| [16-reference](node_modules/@manta/core/docs/16-reference.md) | API reference |

**Read the relevant doc BEFORE writing code.** When in doubt, check [04-commands.md](node_modules/@manta/core/docs/04-commands.md) for workflow patterns.
