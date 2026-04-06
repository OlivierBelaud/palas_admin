# Queries — defineQuery() & defineQueryGraph()

Queries are the CQRS read side. They expose data as GET endpoints. Two primitives:

- `defineQuery()` — named query with custom handler (specific reads)
- `defineQueryGraph()` — expose the query graph to frontend (flexible reads)

## defineQuery()

```typescript
// src/queries/admin/list-products.ts
import { z } from 'zod'

export default defineQuery({
  name: 'list-products',
  description: 'List products with filtering',
  input: z.object({
    status: z.string().optional(),
    ...listParams(),
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

### Signature

```typescript
defineQuery({
  name: string,            // Query name (becomes the endpoint)
  description: string,     // For docs and AI tool discovery
  input: z.ZodType,        // Zod schema for input validation
  handler: (input, ctx) => Promise<output>,
})
```

### Handler context

```typescript
{
  query: QueryService,                          // query.graph() for cross-module joins
  log: ILoggerPort,                             // Structured logging
  auth: AuthContext | null,                     // Authenticated user
  headers: Record<string, string | undefined>,  // Raw request headers
}
```

**No `app` access** — queries are forced to use `query.graph()` for reads. This ensures consistent access control.

### Routing

The folder name = the context:
```
src/queries/admin/list-products.ts   → GET /api/admin/list-products
src/queries/store/get-catalog.ts     → GET /api/store/get-catalog
```

Query parameters are passed as URL query string:
```
GET /api/admin/list-products?status=active&limit=10&offset=0
```

### Input helpers

```typescript
import { listParams, retrieveParams } from '@manta/sdk'

// listParams() adds: limit, offset, sort, order, search
z.object({
  category: z.string().optional(),
  ...listParams(),         // { limit: 20, offset: 0, sort?, order: 'desc', search? }
})

// retrieveParams() adds: id, fields
z.object({
  ...retrieveParams(),    // { id: string, fields?: string[] }
})
```

### Auth in queries

```typescript
handler: async (input, { query, auth }) => {
  // auth.id — user ID
  // auth.type — context ('admin', 'customer')
  // auth.email — user email

  // Example: only return MY orders
  return query.graph({
    entity: 'order',
    filters: { customer_id: auth!.id },
  })
}
```

## defineQueryGraph()

Exposes the query graph to the frontend. The frontend can compose arbitrary queries.

### Wildcard — full access (admin/AI)

```typescript
// src/queries/admin/graph.ts
export default defineQueryGraph('*')
```

Creates `POST /api/admin/graph`. The frontend can query any entity with any filters, relations, pagination.

### Scoped — per-entity access with row-level filtering

```typescript
// src/queries/store/graph.ts
export default defineQueryGraph({
  product: true,                                   // all products, no filter
  category: true,                                  // all categories
  order: (auth) => ({ customer_id: auth.id }),     // only MY orders
  customer: (auth) => ({ id: auth.id }),           // only MY profile
})
```

Creates `POST /api/store/graph` with access control:

| Entity | Access | Behavior |
|--------|--------|----------|
| Listed as `true` | All rows | No filter applied |
| Listed as function | Scoped rows | Function returns filters merged with user query |
| Not listed | Blocked | 403 Forbidden |
| Listed in `relations` but not allowed | Stripped | Warning logged in backend console |

### Frontend usage

```typescript
// Using @manta/sdk
const { data } = useGraphQuery({
  entity: 'product',
  filters: { status: 'active' },
  relations: ['inventory_item'],
  pagination: { limit: 20 },
  sort: { field: 'created_at', order: 'desc' },
})
```

### Graph query body

```json
POST /api/admin/graph
{
  "entity": "product",
  "filters": { "status": "active" },
  "pagination": { "limit": 20, "offset": 0 },
  "sort": { "field": "created_at", "order": "desc" },
  "relations": ["inventory_item", "category"],
  "fields": ["id", "title", "price", "status"]
}
```

### When to use defineQuery vs defineQueryGraph

| Use case | Primitive | Why |
|----------|-----------|-----|
| Admin dashboard | `defineQueryGraph('*')` | Admin sees everything, AI needs full access |
| Storefront public catalog | `defineQueryGraph({ product: true })` | Frontend composes queries freely, scoped |
| Storefront orders | `defineQuery` or scoped graph | Need row-level filtering by customer |
| Complex aggregation | `defineQuery` | Custom handler with business logic |
| API for third parties | `defineQuery` | Fixed contract, no graph exposure |

## extendQueryGraph() — external entity resolvers

`extendQueryGraph()` plugs a **module-level resolver** into the query engine. It's how modules that own [external entities](./02-models.md#external-entities) (PostHog, Stripe, etc.) translate a Manta query graph request into a call to the third-party backend.

Unlike `defineQueryGraph()` — which controls **access per context** — `extendQueryGraph()` adds **new resolution paths** to the engine itself. When any entity listed in `owns` is queried (via `query.graph()`, `useGraphQuery`, or an AI tool), the engine routes the query to your resolver instead of hitting the local database.

```typescript
// src/modules/posthog/queries/graph.ts
export default extendQueryGraph({
  owns: ['PostHogEvent', 'PostHogPerson', 'PostHogInsight'],

  async resolve(query, { app, logger }) {
    // `query` is the Manta GraphQueryConfig: entity, filters, pagination, sort, fields...
    // Translate it into a HogQL / REST call against PostHog, then return normalized rows.
    const rows = await fetchFromPostHog(query)
    return rows
  },

  // Optional: whitelist the filters your backend can honour. Unsupported filters
  // will throw a clear error so the caller (or AI) can adapt its query.
  supportedFilters: {
    PostHogEvent: ['distinct_id', 'event', 'timestamp'],
    PostHogPerson: ['id', 'email'],
  },
})
```

### Signature

```typescript
extendQueryGraph({
  owns: string[],                         // Entity names this module resolves
  resolve: (query, ctx) => Promise<Row[]>,
  supportedFilters?: Record<string, string[]>,
})
```

### Resolver context

```typescript
{
  app: MantaApp,       // Resolve plugin config, secrets, infra
  logger: ILoggerPort, // Structured logging
}
```

### Rules

- File location: `src/modules/{module}/queries/graph.ts` (module-scoped — NOT in `src/queries/`).
- `owns` must be non-empty and list entities declared with `.external()` in the same module.
- `resolve` must return normalized rows whose shape matches the entity's `defineModel()` schema (keys == field names). The engine then applies relation hydration + access control as usual.
- Omit `supportedFilters` to accept everything (use at your own risk — the resolver is fully on the hook for validation).
- Local entities are still resolved by the database; only entities listed in `owns` are routed to the extension.

### Relationship with defineLink

External entities linked to local ones via `defineLink()` are hydrated transparently: when a query requests `{ entity: 'product', relations: ['posthog_event'] }`, the engine first hits Drizzle for products, then calls the PostHog extension's `resolve()` with the event query — both halves merge in the final result.

## No defineQueryGraph = no useGraphQuery

If you don't create a `graph.ts` in a context, `useGraphQuery()` from the SDK will receive a 404. The query graph must be explicitly enabled per context.
