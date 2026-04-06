# Configuration — defineConfig() & CLI

## Project setup

### `manta init` — New standalone project

```bash
manta init my-app
cd my-app
pnpm install
manta dev
```

Creates a complete, functional Manta project. After `pnpm install`, the project is ready to run with admin dashboard, database, and all framework features.

**What `manta init` generates:**

```
my-app/
├── manta.config.ts           # defineConfig() — database, http, admin: true
├── package.json              # @manta/core, @manta/cli, @manta/host-nitro, @manta/dashboard
├── tsconfig.json             # ES2022, ESNext, JSX support, strict
├── .env / .env.example       # DATABASE_URL, PORT, ANTHROPIC_API_KEY
├── .gitignore                # .manta/, .manta/types/, node_modules/, .env
├── AGENT.md                  # AI instructions (copied from @manta/core/docs/)
└── src/
    ├── modules/              # Your business modules (entities + services)
    ├── commands/              # Application commands (cross-module workflows)
    ├── subscribers/           # Event handlers
    ├── jobs/                  # Cron tasks
    ├── links/                 # Cross-module relations
    ├── queries/               # CQRS read endpoints (defineQuery, defineQueryGraph)
    ├── agents/                # AI steps
    └── admin/                 # Dashboard (index.html + main.tsx)
        ├── index.html
        └── main.tsx
```

**What it does NOT generate:**
- No `nitro.config.ts` — the host adapter handles this internally
- No `drizzle.config.ts` — the CLI handles this internally
- No `src/api/` — routes are auto-generated from commands + queries

The only config file the developer maintains is `manta.config.ts`.

### `manta setup` — Add Manta to existing project

```bash
cd my-nextjs-app
npx manta setup
```

Detects the existing framework and adapts:

| Detected | Context | What it generates |
|----------|---------|------------------|
| `next.config.*` | Next.js | `AGENT.md` with Next.js + Manta instructions, `src/manta/` subdirectory |
| `nuxt.config.*` | Nuxt | `AGENT.md` with Nuxt + Manta instructions, `server/manta/` subdirectory |
| `workspaces` in package.json | Monorepo | `AGENT.md` at root, `packages/backend/` with Manta structure |
| Nothing detected | Standalone | Full Manta project structure in current directory |

In all cases, `manta setup`:
1. Creates `manta.config.ts`
2. Creates module/command/subscriber directories
3. Generates **`AGENT.md` at the project root** — the first file an AI reads
4. The `AGENT.md` is context-aware (mentions the detected framework)
5. `AGENT.md` is committed to git (not gitignored) — every clone has it

### The AGENT.md

The `AGENT.md` lives at the root of every Manta project. It's the first file an AI reads.

**Canonical location:** `@manta/core/docs/AGENT.md` — alongside all other framework documentation. The CLI copies it to the project root during `manta init`.

For `manta setup` (existing projects), context-specific templates exist in the CLI:

```
packages/cli/src/templates/agent/
├── nextjs.md        # Next.js + Manta
└── nuxt.md          # Nuxt + Manta
```

`manta init` copies the canonical AGENT.md from `@manta/core/docs/`. `manta setup` detects the context and uses the appropriate template. The developer can then edit it to add project-specific context (business domain, team conventions, etc.).

Each AGENT.md contains:
- Stack description (what framework + Manta)
- The primitives with file locations
- Project structure adapted to the context
- Critical rules
- Links to full documentation in `node_modules/@manta/core/docs/`

The templates are maintained by the framework team. They are rich, detailed documents — not auto-generated strings.

## manta.config.ts

```typescript
export default {
  database: {
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/my_app',
    pool: { min: 2, max: 10 },
  },
  http: { port: 3000 },
  admin: { enabled: true },
}
```

Or with validation via `defineConfig()`:

```typescript
export default defineConfig({
  database: { url: process.env.DATABASE_URL },
  http: { port: 3000 },
  auth: {
    jwtSecret: process.env.JWT_SECRET,
  },
  admin: { enabled: true },
  strict: false,
})
```

`defineConfig()` validates `http`, `auth`, and `query` sections immediately via Zod. Invalid values throw at definition time, not at boot.

## Configuration sections

| Section | Key fields | Default |
|---------|-----------|---------|
| `database` | `url`, `pool.min`, `pool.max` | Required |
| `http` | `port` | `9000` |
| `auth` | `jwtSecret`, `session.enabled`, `session.cookieName` | Dev: auto-generated secret |
| `query` | `maxEntities`, `defaultLimit` | `10000`, `100` |
| `admin` | `enabled` | `false` |
| `preset` | `'dev'`, `'vercel'` | Auto-detected from `APP_ENV` |
| `strict` | `true`/`false` | `false` |
| `plugins` | Array of plugin configs | `[]` |

## Presets (adapter bundles)

The framework auto-detects the environment and loads appropriate adapters:

| Adapter | Dev (in-memory) | Prod (Vercel) |
|---------|----------------|---------------|
| Database | PostgreSQL (local) | Neon (serverless) |
| Cache | In-memory | Upstash Redis |
| Events | In-memory | Upstash Queues |
| File | Local filesystem | Vercel Blob |
| Logger | Pino (pretty) | Pino (JSON) |
| Locking | In-memory | Neon advisory locks |
| Jobs | node-cron | Vercel Cron |

Detection: `APP_ENV` > `NODE_ENV` > default `'development'`.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Prod only | JWT signing secret (dev: auto-generated) |
| `APP_ENV` | No | Force environment (`development` or `production`) |
| `ANTHROPIC_API_KEY` | No | Enable AI chat in admin dashboard |

## CLI commands

| Command | Description |
|---------|-------------|
| `manta init` | Scaffold new project |
| `manta dev` | Dev server with hot reload + auto-migration |
| `manta build` | Production build |
| `manta start` | Start production server |
| `manta db:create` | Create PostgreSQL database |
| `manta db:generate` | Generate SQL migrations from DML models |
| `manta db:migrate` | Apply pending migrations |
| `manta db:rollback` | Revert last migration(s) |
| `manta db:diff` | Compare schema vs database (diagnostic) |
| `manta exec <script>` | Run TypeScript script with app context |
| `manta user -e <email>` | Create admin user |

### manta dev

Starts development server. Auto-performs:
1. Load env + config
2. Generate `.manta/types/` (TypeScript types for autocomplete)
3. Start Nitro dev server with HMR
4. On first request: connect DB, instantiate adapters, discover modules/commands/subscribers/jobs/links/queries
5. Auto-create tables in dev mode (no manual migration needed)
6. Wire all routes, subscribers, jobs

### manta db:generate

Scans `src/modules/*/models/` and `src/links/` to generate SQL migrations:

```bash
manta db:generate --name add-blog-post
# Creates: drizzle/migrations/20260323_add-blog-post.sql
```

### manta exec

Run scripts with full app context:

```typescript
// scripts/seed.ts
export async function main(app) {
  await app.modules.blog.createPosts([
    { title: 'First Post', slug: 'first', content: '...', status: 'published' },
    { title: 'Second Post', slug: 'second', content: '...', status: 'draft' },
  ])
}
```

```bash
manta exec scripts/seed.ts
manta exec scripts/seed.ts --dry-run  # Rollback after execution (test mode)
```

## Codegen (.manta/types/)

On `manta dev` or `manta build`, the framework generates:

| File | Content |
|------|---------|
| `types.ts` | `MantaEntities` — typed step proxy for `step.service.catalog.create()` |
| `app.d.ts` | `MantaAppModules` — typed `app.modules.catalog.listProducts()` |
| `events.d.ts` | `MantaEventName` — union of all known event names |

These are TypeScript module augmentations. After codegen, `app.modules.*` has full autocomplete in your IDE.

## Bootstrap sequence (summary)

1. Load .env + config
2. Resolve preset → adapter list
3. Initialize logger, database, cache, locking, events, file, jobs
4. Create `MantaApp` builder
5. Discover resources (modules, commands, subscribers, jobs, links, queries)
6. Load modules → instantiate services → generate tables (dev only)
7. Load links → generate pivot tables
8. Load subscribers → wire event bus
9. Load jobs → schedule cron
10. Load commands → register in CommandRegistry → wire HTTP callables
11. Wire relational query (Drizzle relations for Query.graph)
12. Build immutable app
13. Wire auth routes + query routes + OpenAPI
14. Ready to serve

## Publishing modules and plugins

### Naming convention

All published packages must include `manta` in the name:

- Module: `manta-module-catalog`, `manta-module-blog`, `@my-org/manta-module-payment`
- Plugin: `manta-plugin-ecommerce`, `@my-org/manta-plugin-cms`

This makes packages discoverable on npm and distinguishable from non-Manta packages.

### Package structure convention

**Module package** — contains entities and services (the fundamental data unit):

```
manta-module-catalog/
├── entities/                 # Entities (model.ts + service.ts)
│   └── product/
│       ├── model.ts
│       └── service.ts
├── commands/                 # Module-scoped commands (optional)
├── index.ts                  # Barrel exports
├── package.json              # name: "manta-module-catalog"
├── AGENT.md                  # AI instructions (written by dev)
├── README.md                 # Auto-generated documentation
└── docs/                     # Detailed docs (optional, for complex modules)
```

**Plugin package** — orchestration only, NO entities:

```
manta-plugin-ecommerce/
├── commands/                 # Application-level commands (cross-module orchestration)
│   ├── create-order.ts
│   └── process-payment.ts
├── subscribers/              # Event reactions
│   └── order-placed.ts
├── jobs/                     # Scheduled tasks
│   └── cleanup-abandoned-carts.ts
├── links/                    # Cross-module relationships
│   └── order-product.ts
├── queries/                  # CQRS read endpoints
│   └── store/
├── index.ts                  # Barrel exports
├── package.json              # name: "manta-plugin-ecommerce"
│                             # peerDependencies: { "manta-module-customer": "^1.0", ... }
├── AGENT.md                  # AI instructions
└── README.md                 # Auto-generated
```

Note: the plugin's `package.json` lists its module dependencies as `peerDependencies`. The consumer installs both the plugin and the modules it needs.

**`AGENT.md`** — Written by the module developer. Explains to an AI agent:
- What the module does and why
- How to use it (which commands, which entities)
- What events it emits
- What dependencies it has
- Integration examples

When an AI encounters this module in `node_modules/`, it reads `AGENT.md` first and knows exactly how to use it.

**`README.md`** — Auto-generated by `manta extract`. Parsed from the source code:
- Entity schemas (from `defineModel`)
- Service methods with signatures (from `defineService`)
- Commands with input schemas (from `defineCommand`)
- Events emitted
- Install instructions

**`docs/`** — Optional. For complex modules that need to explain business concepts beyond the API reference.

### Extract a module

```bash
manta extract module catalog
```

Interactive prompts:
1. **npm scope** — `@my-org` or none (guides to npm account creation if needed)
2. **Package name** — defaults to `manta-module-catalog`

What it generates:
1. `packages/manta-module-catalog/` with entities, commands, barrel
2. `package.json` with name, version, exports
3. `AGENT.md` template (dev fills in the "why" and "how to use")
4. `README.md` auto-generated from code analysis (entities, methods, commands, events)
5. Workspace reference in root `package.json`

Works locally via pnpm workspace before publishing:

```bash
cd packages/manta-module-catalog
npm publish
```

### Extract a plugin

```bash
manta extract plugin ecommerce
```

Interactive CLI:
1. **npm scope** — same as module
2. **Select module dependencies** — which published modules does this plugin depend on? (listed as `peerDependencies`)
3. **Select commands** (application-level)
4. **Select subscribers, jobs, links, queries**

What it generates:
1. `packages/manta-plugin-ecommerce/` with commands, subscribers, jobs, links, queries
2. `package.json` with `peerDependencies` on the required modules
3. `AGENT.md` template
4. `README.md` auto-generated
5. All selected elements organized following the same file-based convention

**Important:** The extract command will refuse to include entities or services in a plugin. If your `src/` contains modules that the plugin uses, extract them as separate module packages first:

```bash
# First: extract the modules
manta extract module customer
manta extract module product

# Then: extract the plugin (references modules as peerDependencies)
manta extract plugin ecommerce
```

### Module vs Plugin — the fundamental separation

**A plugin CANNOT contain modules.** This is enforced at build time.

Modules are the fundamental data unit (entities + service + DB). Plugins are the orchestration layer (workflows, subscribers, jobs, links, queries). Forcing this separation ensures modules are independently publishable, reusable, and ejectible.

| | Module | Plugin |
|---|--------|--------|
| **Contains** | entities/ + commands/ for one domain | App commands + subscribers + jobs + links + queries. **NO entities.** |
| **Dependencies** | None (self-contained) | Declares dependencies on published modules (e.g., `manta-module-customer`) |
| **Naming** | `manta-module-{name}` | `manta-plugin-{name}` |
| **AI docs** | `AGENT.md` at package root | `AGENT.md` at package root |
| **Extract** | `manta extract module <name>` | `manta extract plugin <name>` |
| **Eject** | `manta eject <package>` | `manta eject <package>` |
| **Build validation** | Must contain at least one entity | Must NOT contain `defineModel()` |

**Why?** If a plugin embedded modules, those modules would be locked inside the plugin. By forcing separation:
- Modules are reusable across plugins (any plugin can depend on `manta-module-customer`)
- Eject is granular (eject the plugin or a specific module independently)
- Plugin authors are incentivized to publish their modules separately

### Eject

```bash
# Eject a module — copies entity + service code to src/modules/
manta eject manta-module-catalog

# Eject a plugin — copies orchestration code (commands, subscribers, jobs, links, queries) to src/
manta eject manta-plugin-ecommerce
```

**Module eject:** Copies the module source from `node_modules/` into `src/modules/catalog/`. Removes the npm dependency. The code is now yours — no more updates from the package.

**Plugin eject:** Copies the plugin's commands, subscribers, jobs, links, and queries into your `src/` directories. Module dependencies stay as npm packages — you only eject the orchestration layer. To also customize a module, eject it separately:

```bash
# Eject the plugin (orchestration)
manta eject manta-plugin-ecommerce

# Eject just one module you need to customize
manta eject manta-module-customer

# Other modules (product, order, etc.) stay as npm packages
```

This granular eject is possible precisely because plugins don't embed modules.

### Auto-generated README

The `manta extract` command generates `README.md` by parsing the source:

```markdown
# manta-module-catalog

## Entities

### Product
| Property | Type | Modifiers |
|----------|------|-----------|
| title | text | — |
| sku | text | unique |
| price | number | — |
| status | enum(draft, active, archived) | — |

## Service methods
| Method | Arguments | Description |
|--------|-----------|-------------|
| activate | (id: string) | Activate a draft product |
| archive | (id: string) | Archive a product |

## Auto-generated CRUD
createProducts, listProducts, retrieveProduct, updateProducts,
deleteProducts, softDeleteProducts, restoreProducts

## Commands
| Name | Description | Input |
|------|-------------|-------|
| catalog:activate-product | Activate a draft product | { id: string } |

## Events emitted
product.created, product.updated, product.deleted

## Install
pnpm add manta-module-catalog

## Usage
Add to your manta.config.ts modules section. The framework discovers it automatically.
```

This is generated entirely from code — no manual documentation needed for the technical reference.

### Naming convention — full ecosystem

Every published Manta package follows a strict naming convention for automatic discovery:

| Type | Naming pattern | Example |
|------|---------------|---------|
| Module | `manta-module-{name}` | `manta-module-blog`, `@acme/manta-module-payment` |
| Plugin | `manta-plugin-{name}` | `manta-plugin-ecommerce`, `@acme/manta-plugin-cms` |
| Adapter | `manta-adapter-{port}-{impl}` | `manta-adapter-cache-redis`, `manta-adapter-file-s3` |

**Why the naming convention matters:** The Manta community registry automatically scans npm for packages matching `manta-module-*`, `manta-plugin-*`, `manta-adapter-*`. Published packages are indexed and listed on the community page — no manual submission required.

### Community registry (automatic)

The Manta ecosystem page scans npm and GitHub for published packages:

1. **Auto-discovery** — Any package matching `manta-module-*`, `manta-plugin-*`, or `manta-adapter-*` is found automatically
2. **Auto-documentation** — The registry reads the package's `AGENT.md` and `README.md` to generate a listing page
3. **Security audit** — Packages are checked for known vulnerabilities before being listed (npm audit + custom checks)
4. **Categories** — Modules, plugins, and adapters are listed separately with search and filtering

This means: publish on npm with the right name, include `AGENT.md` and `README.md`, and your package appears in the community listing automatically.
