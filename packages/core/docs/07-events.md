# Events & Workflows — defineSubscriber(), defineJob() & defineWorkflow()

## Events in Manta

Events are the communication layer between modules. They decouple the "what happened" (command) from the "what should happen next" (subscriber).

### Auto-generated events

Every CRUD operation emits events automatically:

| Operation | Event name | Data |
|-----------|-----------|------|
| `createProducts(data)` | `product.created` | `{ id }` |
| `updateProducts(data)` | `product.updated` | `{ id }` |
| `deleteProducts(ids)` | `product.deleted` | `{ id }` |

The event name is derived from the entity name: `Product` → `product.created`.

### Manual events

In commands: `step.emit('event.name', data)` — buffered until workflow commits.

## defineSubscriber()

```typescript
export default defineSubscriber({
  event: 'product.created',
  handler: async (event, { command, log }) => {
    const { id, sku } = event.data as { id: string; sku: string }
    log.info(`Product created: ${sku}`)
    await command.initializeInventory({ productId: id })
  },
})
```

**Signature:**
- `event` — Event name (string) or array of event names
- `handler` — `async (event, { command, log }) => void`
  - `event` — `Message<T>` with `eventName`, `data`, `metadata`
  - `command` — CQRS command callables (with autocomplete from codegen)
  - `log` — Logger instance

### Typed event data

Use the generic parameter to type `event.data`:

```typescript
interface ProductCreatedEvent {
  id: string
  sku: string
  title: string
  price: number
}

export default defineSubscriber<ProductCreatedEvent>({
  event: 'product.created',
  handler: async (event, { command, log }) => {
    event.data.sku  // TS knows this is string
  },
})
```

### Multiple events

```typescript
export default defineSubscriber({
  event: ['product.created', 'product.updated'],
  handler: async (event, { log }) => {
    log.info(`Product changed: ${event.eventName}`)
  },
})
```

### Idempotency (at-least-once)

Events can be delivered more than once (at-least-once guarantee). Use `makeIdempotent()` to deduplicate:

```typescript
export default defineSubscriber({
  event: 'order.created',
  handler: makeIdempotent(
    cache,  // ICachePort instance
    async (event, { command, log }) => {
      // Only executed once per unique event
      await command.sendConfirmationEmail({ email: event.data.email })
    },
    {
      keyFn: (event) => `order-confirm:${event.data.id}`,  // Custom dedup key
      ttl: 24 * 3600 * 1000,  // 24 hours (default)
    },
  ),
})
```

### Delivery guarantees

- **At-least-once** — Events may be delivered more than once
- **No ordering** — In production (queue), events arrive in any order
- **Fire-and-forget** — Subscriber errors don't block the emitter
- **No compensation** — Subscribers cannot roll back

## defineJob()

```typescript
// Positional form (preferred)
export default defineJob('cleanup-draft-products', '0 * * * *', async ({ command, log }) => {
  const result = await command.cleanupDraftProducts({ olderThanDays: 1 })
  log.info(`Cleanup: ${result.deleted} draft products removed`)
  return result
})
```

Or using the config object form:

```typescript
export default defineJob({
  name: 'cleanup-draft-products',
  schedule: '0 * * * *',  // Every hour
  handler: async ({ command, log }) => {
    const result = await command.cleanupDraftProducts({ olderThanDays: 1 })
    log.info(`Cleanup: ${result.deleted} draft products removed`)
    return result
  },
})
```

**Signature (positional):** `defineJob(name, schedule, handler)`
**Signature (config):** `defineJob({ name, schedule, handler })`

- `name` — Unique job identifier
- `schedule` — Cron expression (5-field standard)
- `handler` — `async ({ command, log }) => TResult`
  - `command` — CQRS command callables (same scope as subscribers)
  - `log` — Logger instance

Jobs receive `{ command, log }` — the same scope as subscribers. Every mutation goes through a command (compensation, retry, audit trail). Jobs do NOT have direct access to `app` or module services.

### Cron format

```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-7, 0=Sun)
│ │ │ │ │
* * * * *
```

Examples:
- `* * * * *` — Every minute
- `0 * * * *` — Every hour
- `0 0 * * *` — Every day at midnight
- `0 9 * * 1` — Every Monday at 9am
- `*/5 * * * *` — Every 5 minutes

### Job locking

Concurrent job executions are automatically skipped via `ILockingPort`. If a job is already running, the next invocation returns immediately without executing.

## Emitting events

In **commands**, events are buffered: `step.emit('event.name', data)` — only emitted if the workflow succeeds.

In **subscribers and jobs**, use commands to perform mutations. Events from auto-generated CRUD (e.g., `product.created`) are emitted automatically when commands call service methods.

## defineWorkflow() — Intra-module business logic

A workflow is a compensable operation scoped to a single module. It orchestrates multiple entity services within the same module — pure business logic with no auth context.

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
    await step.emit('product.categorized', { id: product.id, categoryId: input.categoryId })
    log.info(`Product ${product.id} categorized`)
    return { productId: product.id }
  },
})
```

**Signature:** `defineWorkflow({ name, input, workflow })`

- `name` — Unique workflow identifier (kebab-case)
- `input` — Zod schema (validates input)
- `workflow` — `async (input, { step, log }) => TResult`
  - `step` — Scoped step proxy (only this module's services)
  - `log` — Logger instance

### Key differences from defineCommand

| | defineCommand | defineWorkflow |
|---|---|---|
| **Location** | `src/commands/{ctx}/` | `src/modules/{mod}/workflows/` |
| **Context** | `{ step, log, auth, headers }` | `{ step, log }` |
| **Scope** | Any module | One module only |
| **HTTP endpoint** | Yes (`POST /api/...`) | No |
| **Auth** | Yes (`auth` param) | No |
| **Called from** | HTTP, CLI, sub-command | Commands via `step.workflow.MODULE.NAME()` |
| **Compensation** | Yes | Yes |

### Calling workflows from commands

```typescript
// src/commands/admin/create-and-categorize.ts
export default defineCommand({
  name: 'create-and-categorize',
  input: z.object({ title: z.string(), categoryId: z.string() }),
  workflow: async (input, { step, auth }) => {
    const product = await step.service.catalog.create({ title: input.title })
    await step.workflow.catalog.categorizeProduct({
      productId: product.id,
      categoryId: input.categoryId,
    })
    return product
  },
})
```

The workflow runs within the command's compensation chain. If any step fails, all completed steps (including those inside the workflow) compensate in reverse order.

## File locations

```
src/subscribers/{name}.ts                    # defineSubscriber()
src/jobs/{name}.ts                           # defineJob()
src/modules/{mod}/workflows/{name}.ts        # defineWorkflow()
```

## Validation errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Subscriber event must be non-empty` | Empty event string | Set `event: 'product.created'` |
| `Subscriber handler must be a function` | handler is not async function | Set `handler: async (event, { command, log }) => {...}` |
| `Job name is required` | Missing name | Add `name: 'my-job'` |
| `Job schedule (cron expression) is required` | Missing schedule | Add `schedule: '0 * * * *'` |
| `Job handler must be a function` | handler is not function | Set `handler: async ({ command, log }) => {...}` |
| `Workflow name is required` | Missing name | Add `name: 'my-workflow'` |
| `Workflow "X" requires an input Zod schema` | Missing input | Add `input: z.object({})` |
| `Workflow "X" workflow must be an async function` | workflow is not a function | Add `workflow: async (input, { step, log }) => {...}` |
