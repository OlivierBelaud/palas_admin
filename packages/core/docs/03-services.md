# Services — defineService()

## The rule

**1 entity = 1 service. Always.**

A service defines the mutations (writes) for **one** entity. The repository it receives is typed for that entity only. A service cannot mutate another entity — that's a command.

A module can have multiple entities, and therefore multiple services. If you need to mutate two entities together, write a module command that orchestrates them.

If you don't have an entity, you don't have a module. Use `app.infra.*` for infrastructure (file storage, cache, logging).

## defineService()

```typescript
export default defineService('product', ({ db, log }) => ({
  activate: async (id: string) => {
    await db.update({ id, status: 'active' })
    log.info(`Product ${id} activated`)
  },

  archive: async (id: string) => {
    await db.update({ id, status: 'archived' })
    log.info(`Product ${id} archived`)
  },
}))
```

**Signature:** `defineService(entityName: string, factory: ({ db, log }) => Methods, options?)`

- `entityName` — Entity name as a string (autocompletes from codegen)
- `factory` — Receives `{ db, log }` (typed repository + logger), returns methods
- `options.publicMethods` — (optional) Array of method names visible to other modules

No imports needed — `defineService` is a global. Compensation is automatic — the repo snapshots state before every mutation. No `service.method()` wrapper needed.

## Auto-generated CRUD methods

From `defineService(Product, ...)`, the framework generates these 8 methods automatically:

| Method | Signature | Events emitted |
|--------|-----------|---------------|
| `retrieveProduct(id, config?)` | `(string, ServiceConfig?) => Promise<Product>` | none |
| `listProducts(filters?, config?)` | `(Partial<Product>?, ServiceConfig?) => Promise<Product[]>` | none |
| `listAndCountProducts(filters?, config?)` | `(Partial<Product>?, ServiceConfig?) => Promise<[Product[], number]>` | none |
| `createProducts(data)` | `(Partial<Product> \| Partial<Product>[]) => Promise<Product \| Product[]>` | `product.created` |
| `updateProducts(data)` | `(({id} & Partial<Product>) \| ...[]) => Promise<Product \| Product[]>` | `product.updated` |
| `deleteProducts(ids)` | `(string \| string[]) => Promise<void>` | `product.deleted` |
| `softDeleteProducts(ids)` | `(string \| string[]) => Promise<Record<string, string[]>>` | none |
| `restoreProducts(ids)` | `(string \| string[]) => Promise<void>` | none |

Plus two query helpers:
- `list()` — All entities, ordered by `created_at DESC`
- `findById(id)` — Single entity or `null`

**The method names are derived from the entity name.** `Product` → `createProducts`, `InventoryItem` → `createInventoryItems`.

## Auto-compensation — snapshot-based rollback

Service methods are plain `async` functions. No `service.method()` wrapper needed.

```typescript
activate: async (id: string) => {
  await db.update({ id, status: 'active' })
}
```

**How it works:** The framework auto-snapshots repository state before every mutation. In a workflow, if step 3 fails, steps 1 and 2 are automatically rolled back using the snapshots. You don't write compensation logic — the framework handles it.

## TypedRepository — the db API

The `db` parameter is a `TypedRepository<T>` where `T` is the inferred entity type:

```typescript
// Find entities
const products = await db.find({
  where: { status: 'active' },     // Partial<Product> filter
  order: { created_at: 'DESC' },   // Sort
  limit: 10,                        // Pagination
  offset: 0,
  withDeleted: false,                // Include soft-deleted (default: false)
})

// Find with count
const [items, total] = await db.findAndCount({ where: { status: 'draft' } })

// Create
const product = await db.create({ title: 'Widget', sku: 'W-001', price: 999 })

// Update (id required)
const updated = await db.update({ id: 'prod_123', status: 'active' })

// Delete
await db.delete('prod_123')         // Hard delete
await db.delete(['id1', 'id2'])     // Batch delete

// Soft-delete
await db.softDelete(['prod_123'])   // Sets deleted_at
await db.restore(['prod_123'])       // Clears deleted_at

// Bulk upsert (insert or replace on conflict)
await db.upsertWithReplace(
  [{ id: 'prod_1', title: 'A' }, { id: 'prod_2', title: 'B' }],
  ['title'],           // fields to replace on conflict (optional)
  ['id'],              // conflict target columns (optional, defaults to ['id'])
)
// Note: upsertWithReplace bypasses compensation — it's a bulk operation
// mixing creates and updates, which cannot be atomically reversed.
```

## Raw SQL escape hatch — db.raw()

When TypedRepository methods are not enough (complex aggregations, window functions, CTEs), use `db.raw()` on the database port:

```typescript
// In a command step or via app.infra.db
const results = await app.infra.db.raw<{ total: number; status: string }>(
  `SELECT status, COUNT(*)::int AS total FROM product WHERE created_at > $1 GROUP BY status`,
  [since],
)
```

**Signature:** `raw<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>`

- Uses `$1`, `$2` parameterized placeholders (safe from SQL injection)
- Available on all database adapters: DrizzlePgAdapter, NeonAdapter, InMemoryDatabaseAdapter
- The in-memory adapter throws `MantaError('NOT_FOUND')` — raw SQL only works against real databases
- **Use sparingly** — prefer TypedRepository methods for standard CRUD. `raw()` is for queries that the ORM cannot express.

## Isolation

The service factory receives **only `{ db, log }`** (typed repository + logger). You cannot:
- Import another module's service
- Access `app` or `app.modules.*`
- Call external APIs directly

This is **structural**, not a convention — the type system enforces it. If you need to orchestrate multiple modules, use a `defineCommand()`.

## publicMethods (access control)

By default, all methods (CRUD + custom) are accessible from jobs, subscribers, and commands. To restrict:

```typescript
export default defineService('product', ({ db }) => ({
  activate: async (id: string) => {
    await db.update({ id, status: 'active' })
  },
  _internalReset: async (id: string) => {
    await db.update({ id, status: 'draft' })
  },
}), { publicMethods: ['activate'] })  // Only activate is visible via app.modules.catalog
```

## Soft-delete behavior

All reads automatically filter `WHERE deleted_at IS NULL`. To include soft-deleted records:

```typescript
await db.find({ withDeleted: true })
// Or via auto-generated CRUD:
await app.modules.catalog.listProducts({}, { withDeleted: true })
```

## Module structure

Each entity lives in its own folder inside `entities/`, containing both `model.ts` and `service.ts`:

```
src/modules/catalog/
├── entities/
│   ├── product/
│   │   ├── model.ts        # defineModel('Product', {...})
│   │   └── service.ts      # defineService('product', ({ db, log }) => ({...}))
│   └── category/
│       ├── model.ts        # defineModel('Category', {...})
│       └── service.ts      # defineService('category', ({ db, log }) => ({...}))
├── links/                  # Intra-module relations (FK or pivot)
│   └── product-category.ts
├── workflows/              # Intra-module business logic (no auth)
│   └── categorize-product.ts
└── index.ts                # Barrel — re-exports only
```

The `model.ts` and `service.ts` are an inseparable pair. One entity, one service, one folder. The service uses the entity name as a string to reference its entity (no imports needed).

### The barrel (index.ts)

Pure re-exports, no logic:

```typescript
// src/modules/catalog/index.ts
export { Product } from './entities/product/model'
export { Category } from './entities/category/model'
export { default } from './entities/product/service'
```

### Why 1 entity = 1 service?

A service method that mutates Product AND Category in the same call cannot be compensated correctly — if the Category mutation fails, how does the service undo the Product mutation? It can't, because it only has the Product `db`.

That's why cross-entity mutations go in **workflows** (intra-module) or **commands** (cross-module): the step proxy handles compensation across multiple services automatically.

## Validation errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Service method "X" must be an async function` | Non-function in factory return | Define as `async (args) => { ... }` |
| `Module "X" is already registered` | Two modules with same name | Rename one of the modules |
