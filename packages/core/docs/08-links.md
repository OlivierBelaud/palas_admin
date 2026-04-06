# Links — defineLink()

## Why links exist

Entities need relations. In Manta, relations are always defined with `defineLink()` — never in the model itself. There is no `field.relation()`, `belongsTo()`, `hasMany()`, or `hasOne()` API.

`defineLink()` is the ONE interface for all relations:

- **Intra-module** (`src/modules/{mod}/links/`): 1:1 and 1:N create a FK directly on the child table. M:N creates a pivot table.
- **Cross-module** (`src/links/`): always creates a pivot table (modules are isolated, no shared FK).

Same API in both cases.

## defineLink()

```typescript
// src/links/product-inventory.ts — cross-module link
export default defineLink('product', many('inventory_item'))
```

**Signature:** `defineLink(left: string, right: string | many(string), extraColumns?)`

- `left` — Left entity name (string, autocompletes from codegen)
- `right` — Right entity name, optionally wrapped in `many()` for cardinality
- `extraColumns` — (optional) Additional columns on the pivot table using `field.*`

No imports needed — `defineLink`, `many`, and `field` are globals.

## Cardinality with `many()`

The `many()` modifier controls the relationship type and cascade behavior:

| Pattern | Cardinality | Cascade behavior |
|---------|-------------|-----------------|
| `defineLink('a', 'b')` | 1:1 | Symmetric — delete either side deletes the other |
| `defineLink('a', many('b'))` | 1:N | Delete parent (a) cascades to children (b) |
| `defineLink(many('a'), many('b'))` | M:N | Delete either side only cleans pivot |

Cascade is **automatic** — no configuration needed.

## Two locations, different storage

### Intra-module links (`src/modules/{mod}/links/`)

For entities within the **same module**. The storage strategy depends on cardinality:

**1:1 — FK on child table:**
```typescript
// src/modules/blog/links/post-seo.ts
// Creates seo.post_id FK (no pivot table)
export default defineLink('post', 'seo')
```

**1:N — FK on child table:**
```typescript
// src/modules/catalog/links/product-variant.ts
// Creates variant.product_id FK (no pivot table)
export default defineLink('product', many('variant'))
```

**M:N — Pivot table:**
```typescript
// src/modules/catalog/links/product-tag.ts
// Creates product_tag pivot table
export default defineLink(many('product'), many('tag'))
```

### Cross-module links (`src/links/`)

For entities in **different modules**. Always creates a pivot table (modules cannot share FK columns):

**1:1 — Pivot table:**
```typescript
// src/links/customer-profile.ts
// Creates customer_profile pivot table
export default defineLink('customer', 'profile')
```

**1:N — Pivot table:**
```typescript
// src/links/product-inventory.ts
// Creates product_inventory_item pivot table
export default defineLink('product', many('inventory_item'))
```

**M:N — Pivot table:**
```typescript
// src/links/product-collection.ts
// Creates product_collection pivot table
export default defineLink(many('product'), many('collection'))
```

## Summary: all 6 cases

| Location | Cardinality | Storage |
|----------|-------------|---------|
| Intra-module | 1:1 | FK on child |
| Intra-module | 1:N | FK on child |
| Intra-module | M:N | Pivot table |
| Cross-module | 1:1 | Pivot table |
| Cross-module | 1:N | Pivot table |
| Cross-module | M:N | Pivot table |

## Extra columns on pivot table

For M:N relations (or any cross-module link), you can add extra columns:

```typescript
export default defineLink(many('product'), many('collection'), {
  position: field.number().default(0),
})
```

Extra columns are only supported on pivot tables — not on FK-based links.

## Usage in workflows

After creating both entities in a command, link them:

```typescript
workflow: async (input, { step }) => {
  const product = await step.service.catalog.create({ title: 'Widget' })
  const inventory = await step.service.inventory.create({ quantity: 100 })

  // Link them — IDs are auto-resolved from the creates above
  await step.service.catalog.link.inventoryItem()
}
```

The framework tracks the last created ID per entity type. `link.inventoryItem()` automatically resolves the Product ID and InventoryItem ID.

## Cascade delete

With `many('inventory_item')`, deleting the parent (product) automatically cascades:

```typescript
// Deleting a product also soft-deletes linked inventory items
await step.service.catalog.delete(productId)
// → Product soft-deleted
// → All linked InventoryItems soft-deleted
// → Pivot table entries soft-deleted (cross-module) or FK nulled (intra-module)
```

The cascade is determined by `many()` placement — no manual configuration needed.

## File locations

```
src/links/{name}.ts                      # Cross-module links (always pivot)
src/modules/{mod}/links/{name}.ts        # Intra-module links (FK or pivot)
```

Each file exports a single `defineLink()` as the default export.

## Validation errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Link requires exactly two entities` | Missing second argument | Use `defineLink('a', 'b')` or `defineLink('a', many('b'))` |
| `Link between "X" and "Y" is already defined` | Duplicate link | Remove the duplicate file |
| `No link defined between "X" and "Y"` | Missing link definition | Create a file in `src/links/` with `defineLink()` |
| `Cannot link: no X created yet` | Link before create | Call `step.service.MODULE.create()` before linking |
