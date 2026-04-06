# Models — defineModel()

## What is a model

A model declares the shape of an entity in your database. It generates:
- A PostgreSQL table (via `manta db:generate`)
- TypeScript types (via codegen)
- CRUD methods on the service (auto-generated at boot)

## defineModel()

```typescript
export default defineModel('Product', {
  title: field.text(),
  description: field.text().nullable(),
  sku: field.text().unique(),
  price: field.number(),
  status: field.enum(['draft', 'active', 'archived']),
  image_urls: field.json().nullable(),
})
```

**Signature:** `defineModel(name: string, schema: Record<string, Property>): DmlEntity`

- `name` must be PascalCase (e.g., `Product`, `InventoryItem`, `BlogPost`)
- `schema` must have at least one property
- `defineModel` is a global — no import needed

## Property types

`field` is the global property factory:

| Factory | TypeScript type | PostgreSQL type | Example |
|---------|----------------|-----------------|---------|
| `field.text()` | `string` | `TEXT` | `title: field.text()` |
| `field.number()` | `number` | `INTEGER` | `quantity: field.number()` |
| `field.boolean()` | `boolean` | `BOOLEAN` | `active: field.boolean()` |
| `field.float()` | `number` | `REAL` | `rating: field.float()` |
| `field.bigNumber()` | `number` | `NUMERIC` | `amount: field.bigNumber()` |
| `field.serial()` | `number` | `SERIAL` | `position: field.serial()` |
| `field.dateTime()` | `Date` | `TIMESTAMPTZ` | `published_at: field.dateTime()` |
| `field.json()` | `Record<string, unknown>` | `JSONB` | `metadata: field.json()` |
| `field.enum(values)` | Union type | `TEXT + CHECK` | `status: field.enum(['draft', 'active'])` |
| `field.array()` | `unknown[]` | `JSONB` | `tags: field.array()` |

## Modifiers

Chain modifiers after any property:

```typescript
field.text().nullable()        // Allow NULL
field.text().unique()          // UNIQUE constraint
field.text().indexed()         // Create index
field.number().default(0)      // Default value
```

| Modifier | Effect |
|----------|--------|
| `.nullable()` | Column allows NULL |
| `.unique()` | UNIQUE constraint |
| `.indexed()` | B-tree index |
| `.searchable()` | Full-text search index |
| `.default(value)` | Default value in SQL |

## Implicit columns

Every entity automatically gets these columns (you cannot redefine them):

| Column | Type | Description |
|--------|------|-------------|
| `id` | `TEXT PRIMARY KEY` | UUID auto-generated |
| `created_at` | `TIMESTAMPTZ DEFAULT NOW()` | Creation timestamp |
| `updated_at` | `TIMESTAMPTZ DEFAULT NOW()` | Last update timestamp |
| `deleted_at` | `TIMESTAMPTZ NULL` | Soft-delete marker |

## Relations

Relations between entities are defined with `defineLink()`, not in the model. There is no `field.relation()` API.

- **Intra-module relations**: `defineLink()` in `src/modules/{mod}/links/` (1:1/1:N create FK directly, M:N creates pivot)
- **Cross-module relations**: `defineLink()` in `src/links/` (always creates pivot table)

See [Links](./08-links.md) for the full API and examples.

## File location

Each entity has a folder inside `entities/`. The model is `model.ts`, the service is `service.ts` (same folder):

```
src/modules/catalog/entities/product/model.ts
src/modules/catalog/entities/category/model.ts
src/modules/inventory/entities/inventory-item/model.ts
```

## Migrations

After defining or changing a model:

```bash
manta db:generate              # Generate SQL migration
manta db:migrate               # Apply to database
manta db:diff                  # Compare schema vs DB (diagnostic)
```

## External entities

Mark an entity as **external** when it lives in a third-party system (PostHog, Stripe, Shopify, etc.) and Manta should NOT own its storage. The framework still registers the entity so it remains visible to the query graph, to AI tools (`query_entity`, `describe_entity`), and can be linked to local entities with `defineLink()`.

```typescript
// src/modules/posthog/entities/posthog-event/model.ts
export default defineModel('PostHogEvent', {
  id: field.text().primaryKey(),
  event: field.text(),
  distinct_id: field.text(),
  timestamp: field.dateTime(),
  properties: field.json(),
}).external()
```

When `.external()` is set, the framework:

- does **NOT** generate a database table
- does **NOT** generate migrations
- does **NOT** auto-generate a CRUD service
- **DOES** register the entity in the entity registry (links, AI tools, query graph)

External entities MUST be paired with a resolver declared via `extendQueryGraph()` in the same module — see [06-queries.md](./06-queries.md#extendquerygraph--external-entity-resolvers).

### fromZodSchema() — declaring an external model from a Zod schema

When you already have a Zod schema for the third-party payload (e.g. generated from an SDK via `ts-to-zod`), use `fromZodSchema()` to turn it into a DML field record:

```typescript
import { defineModel, fromZodSchema } from '@manta/core'
import { postHogEventSchema } from './schemas'

export default defineModel('PostHogEvent', fromZodSchema(postHogEventSchema)).external()
```

Zod → DML mapping:

| Zod | DML |
|-----|-----|
| `z.string()` | `field.text()` |
| `z.number()` | `field.number()` |
| `z.boolean()` | `field.boolean()` |
| `z.date()` | `field.dateTime()` |
| `z.enum([...])` | `field.enum([...])` |
| `z.array(...)` | `field.array()` |
| `z.object(...)` / `z.record(...)` | `field.json()` |
| `.optional()` / `.nullable()` / `.default()` | `.nullable()` |

Convention: a field named `id` is automatically marked as primary key.

## Validation errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Entity name is required` | Empty string passed | Use PascalCase name: `defineModel('Product', {...})` |
| `Entity name must be PascalCase` | Lowercase name | Change `product` to `Product` |
| `Entity must have at least one property` | Empty schema `{}` | Add properties: `{ title: field.text() }` |
| `Property "id" is implicit and cannot be redefined` | Declared `id` in schema | Remove it — `id` is auto-generated |
| `Property uses reserved "raw_" prefix` | Name starts with `raw_` | Rename — `raw_` is for bigNumber shadow columns |
