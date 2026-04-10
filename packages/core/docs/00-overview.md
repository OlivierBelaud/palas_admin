# Manta Framework — Overview

## What is Manta

Manta is a **tool-first runtime for AI agents** with an integrated database. You write commands (mutations) and models (data), and Manta automatically generates:

- HTTP API endpoints
- AI tool schemas (for Claude, GPT, etc.)
- Admin dashboard actions
- CLI commands (`manta exec`)
- OpenAPI documentation

**One artifact, five interfaces. Zero configuration.**

## Why no API routes?

Traditional frameworks make you define routes manually (`GET /products`, `POST /orders`). In Manta, **commands ARE the API**. A `defineCommand()` is a compensable workflow that gets exposed everywhere simultaneously.

The HTTP route is just one port among many. The same command can be called by:
- An HTTP client (via `POST /api/admin/command/create-product`)
- An AI agent (via the tool schema at `GET /api/admin/tools`)
- The admin dashboard (via the command UI)
- A CLI script (`manta exec create-product`)
- Another command (via `step.command.createProduct()`)

This is why the framework controls the routing, not you. If you defined routes manually, the AI couldn't discover them, the dashboard couldn't call them, and the CLI wouldn't know about them.

## The mental model

```
defineModel()         — Data shape (what exists)
defineService()       — Mutations (what can change, with rollback)
defineCommand()       — Entry point (orchestrates services into workflows)
defineCommandGraph()  — Expose module commands on a context's catch-all route
defineQuery()         — Typed read handler
defineQueryGraph()    — Cross-module read graph (filesystem-derived access rules)
defineSubscriber()    — Reaction (side-effect triggered by events)
defineJob()           — Schedule (periodic tasks)
defineLink()          — Relation (connect entities across modules)
defineAgent()         — AI step (typed LLM call)
defineWorkflow()      — Named compensable workflow (advanced)
defineUserModel()     — Auth-ready user model for a context
defineMiddleware()    — HTTP middleware (per-context override)
defineMiddlewares()   — HTTP pipeline configuration
defineConfig()        — Configuration (database, presets, features)
definePreset()        — Reusable config preset
```

**Plus helpers**: `field`, `many`, `z` (Zod), `MantaError`, `service`. All globals — zero imports needed. Contexts are filesystem-derived in V2 (`src/contexts/*.ts`) — no `defineContext()` function.

## The module rule

**A module is composed of 3 concerns:**

```
src/modules/catalog/
├── entities/               # 1 folder per entity (model + service together)
│   ├── product/
│   │   ├── model.ts        # defineModel('Product', {...})
│   │   └── service.ts      # defineService((model) => model.product, (db) => ({...}))
│   └── category/
│       ├── model.ts
│       └── service.ts
├── links/                  # Intra-module relations
│   └── product-category.ts
├── commands/               # Module commands — orchestrate this module's entities
│   └── categorize-product.ts
└── index.ts                # Barrel — re-exports only, no logic
```

- **entities/** — One folder per entity. Each contains `model.ts` (data shape) and `service.ts` (mutations). They are an inseparable pair.
- **commands/** — (optional) Workflows that orchestrate this module's entities. Scoped: can only use this module's steps.
- **index.ts** — Pure barrel file. Re-exports entities. No logic.

### Module granularity

The framework doesn't enforce bounded contexts — that's your architecture decision. A module can have 1 entity or 5. What matters:

- Entities in the same module share the same service and repository
- Entities across different modules are connected via `defineLink()`
- Module commands can only call their own module's steps

A good rule of thumb: if two entities always change together, they belong in the same module.

### What's NOT a module

If you don't have an entity, you don't have a module:
- File storage → `app.infra.file` (IFilePort)
- Caching → `app.infra.cache` (ICachePort)
- Logging → `app.infra.logger` (ILoggerPort)
- External APIs → `step.action()` in commands

### Ecosystem: publish, install, eject

Manta uses the same file-based convention for local code and packages. This makes contribution frictionless:

**Develop locally → extract → publish → others install → eject if needed**

1. **Develop** — Build your module or plugin in your project (src/modules/, src/commands/, etc.)
2. **Extract** — `manta extract module catalog` copies it into a publishable package with `package.json`
3. **Publish** — `npm publish` (works locally via workspace before publishing)
4. **Install** — Consumers run `pnpm add @my-org/module-catalog`. Framework discovers it from `node_modules/`
5. **Eject** — `manta eject @my-org/module-catalog` copies source back to `src/`. The consumer owns the code, no more upstream updates.

**Modules** = single domain (entities/ + commands/). Self-contained, no dependencies. The fundamental unit.

**Plugins** = orchestration layer: app-level commands + subscribers + jobs + links + contexts. **Plugins CANNOT contain modules.** They declare dependencies on published modules.

This separation is enforced at build time. A plugin that contains `defineModel()` or `defineService()` calls will fail validation. This forces module authors to publish modules independently, making them reusable across plugins.

See [Config — Publishing](./08-config.md#publishing-modules-and-plugins) for CLI details.

#### Why plugins can't contain modules

Modules are the fundamental data unit — entities, database tables, service CRUD. They must be independently publishable, versionable, and ejectible. If a plugin embedded its own modules, those modules would be locked inside the plugin and unavailable to others.

By forcing separation:
- **Modules are reusable** — any plugin can depend on `manta-module-customer`
- **Eject is granular** — eject the plugin (orchestration) or a module (data) independently
- **No vendor lock-in** — swap a plugin while keeping its modules, or vice versa

**Example: customizing for B2B**
1. Install `manta-plugin-ecommerce` (depends on `manta-module-customer`, `manta-module-product`, etc.)
2. Need B2B? Eject the plugin → get workflows/subscribers locally
3. Eject `manta-module-customer` → get entity code locally
4. Replace Customer with your own Organization module
5. Modify workflows to call Organization instead of Customer
6. All other modules stay as published packages

## What's auto-generated

| You write | Framework generates |
|-----------|-------------------|
| `defineModel('Product', { title: field.text() })` | Database table, migrations, TypeScript types |
| `defineService((model) => model.product, (db) => ({ activate: ... }))` | 8 CRUD methods, query helpers |
| `defineCommand({ name: 'create-product', ... })` | HTTP endpoint, AI tool schema, OpenAPI spec |
| `defineSubscriber({ event: 'product.created', ... })` | Event bus wiring |
| `defineJob({ name: 'cleanup', schedule: '0 * * * *', ... })` | Cron scheduling, job history |
| `defineLink((model) => [model.product, many(model.variant)])` | Pivot table, auto-cascade logic |
| `defineContext({ name: 'store', basePath: '/api/store', ... })` | Route filtering, auth checks |
| `manta dev` | `.manta/types/` — full TypeScript autocomplete for app.modules.*, events, entities |

## Constraint as Convention

Manta follows a **"you can't make mistakes"** philosophy:

- Services only receive their repository — **impossible** to call another module
- Service methods **must** be compensable — compile-time error if not
- Commands **must** have a name, description, Zod input, and workflow — runtime error at definition
- Entity names **must** be PascalCase — runtime error at definition
- Duplicate modules, links, and commands are **detected and rejected**
- Error messages tell you **what to do**, not just what went wrong

This makes the framework AI-safe: an AI coding agent reading the error messages can fix issues in one pass.

## Type safety guarantees

Manta is a zero-import framework but fully typed. When you write:

```typescript
export default defineCommand({
  name: 'create-product',
  input: z.object({ title: z.string() }),
  workflow: async (input, ctx) => {
    // input.title is inferred as string
    // ctx.app, ctx.app.infra, ctx.app.resolve() are all typed
    // step.service.product.create({ ... }) has full autocomplete
  },
})
```

All the following are available at compile time without any import:

| Global | Type |
|--------|------|
| `defineCommand`, `defineQuery`, `defineModel`, `defineService`, `defineLink`, `defineSubscriber`, `defineJob`, `defineAgent`, `defineContext`, `defineWorkflow`, `defineUserModel`, `defineConfig`, `definePreset`, `defineMiddleware` | Type-safe |
| `field`, `many`, `service` | Type-safe |
| `z` (Zod) | Type-safe |

These are declared in `packages/core/src/globals.d.ts` and injected at runtime by `registerGlobals()` in `@manta/cli`.

### Escape hatches
For rare cases where you need raw SQL or direct infra access:
- **`ctx.app.infra.db`** — the underlying `IDatabasePort`. Returns `unknown` from the public API for safety; cast to your adapter's type if needed.
- **`db.raw<T>(sql, params)`** — parameterized raw SQL. Use for CTEs, window functions, multi-table operations. Service methods should be preferred for simple cases.

### Auto-generated types
Running `manta dev` or `manta generate` produces `.manta/generated.d.ts` which augments the global registries:
- `MantaGeneratedEntities` — your DML entities
- `MantaGeneratedCommands` — your commands
- `MantaGeneratedAppModules` — `app.modules.*` autocomplete
- `MantaEventMap` — event names for subscribers
- `MantaActorMap` — actor types for contexts

This file is **gitignored** and regenerated on every `manta dev` boot. The codegen validates its own output (via TypeScript parser) to prevent invalid `.d.ts` from corrupting downstream tooling.

## Helpers (used inside define functions)

These are not primitives — they're building blocks used inside the `define*()` functions:

| Helper | Used inside | Purpose |
|--------|-----------|---------|
| `field.text()`, `field.number()`, etc. | `defineModel()` | Property type builders |
| `many(model.entity)` | `defineLink()` | Cardinality modifier |
| `service.method(forward, compensate)` | `defineService()` | Compensable method wrapper |
| `step.service.*`, `step.command.*`, `step.action()`, `step.emit()` | `defineCommand()` | Workflow step primitives |
| `makeIdempotent(cache, handler)` | `defineSubscriber()` | Deduplication wrapper |
| `z.object()`, `z.string()`, etc. | `defineCommand()` | Zod schema for input validation |

All `define*` functions and helpers (`field`, `many`) are **globals** — zero imports needed.

## Project structure

```
my-app/
├── manta.config.ts              # defineConfig()
├── src/
│   ├── modules/
│   │   ├── catalog/
│   │   │   ├── entities/
│   │   │   │   └── product/
│   │   │   │       ├── model.ts       # defineModel('Product', {...})
│   │   │   │       └── service.ts     # defineService((model) => model.product, (db) => ({...}))
│   │   │   ├── links/                 # Intra-module relations
│   │   │   │   └── product-category.ts
│   │   │   ├── commands/              # Module-scoped commands (optional)
│   │   │   │   └── activate-product.ts
│   │   │   └── index.ts              # Barrel: re-exports only
│   │   └── inventory/
│   │       ├── entities/
│   │       │   └── inventory-item/
│   │       │       ├── model.ts
│   │       │       └── service.ts
│   │       └── index.ts
│   ├── commands/
│   │   ├── create-product.ts    # defineCommand({...})
│   │   └── delete-product.ts
│   ├── subscribers/
│   │   ├── product-created.ts   # defineSubscriber({...})
│   │   └── low-stock-alert.ts
│   ├── jobs/
│   │   └── cleanup-drafts.ts    # defineJob({...})
│   ├── links/
│   │   └── product-inventory.ts # defineLink({...}) — cross-module ONLY
│   ├── agents/
│   │   └── categorize.ts        # defineAgent({...})
│   └── contexts/
│       ├── admin.ts             # defineContext({...})
│       └── store.ts
├── .manta/types/                # Auto-generated TypeScript types
└── drizzle/migrations/          # Auto-generated SQL migrations
```

Every directory is auto-discovered. The `export default` of each file is registered automatically at boot.
