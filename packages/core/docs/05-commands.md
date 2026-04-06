# Commands — defineCommand()

## What is a command

A command is the **entry point for all mutations** in Manta. It's a compensable workflow that automatically becomes:

- `POST /api/{context}/command/{name}` — HTTP endpoint
- AI tool schema — JSON Schema from Zod for Claude, GPT, etc.
- Dashboard action — Clickable in admin UI
- CLI command — `manta exec {name}`
- Sub-workflow — callable from other commands via `step.command.{name}()`

**You don't define routes. You define commands. The framework handles the rest.**

## defineCommand()

```typescript
export default defineCommand({
  name: 'create-product',
  description: 'Create a product with inventory setup and activation',
  input: z.object({
    title: z.string(),
    sku: z.string(),
    price: z.number().min(0),
    initialStock: z.number().default(0),
    reorderPoint: z.number().default(10),
  }),
  workflow: async (input, { step }) => {
    // Step 1 — Create product (auto-compensated: delete on rollback)
    const product = await step.service.catalog.create({
      title: input.title,
      sku: input.sku,
      price: input.price,
      status: 'draft',
    })

    // Step 2 — Create inventory (auto-compensated)
    const inventory = await step.service.inventory.create({
      quantity: input.initialStock,
      reorder_point: input.reorderPoint,
      warehouse: 'default',
    })

    // Step 3 — Link product to inventory (auto-resolved IDs)
    await step.service.catalog.link.inventoryItem()

    // Step 4 — Activate product (auto-compensated via snapshot)
    await step.service.catalog.activate(product.id)

    // Step 5 — Emit events (buffered until workflow commits)
    await step.emit('product.created', {
      id: product.id,
      sku: input.sku,
      title: input.title,
      price: input.price,
    })

    return {
      product: { id: product.id, sku: input.sku, status: 'active' },
      inventory: { id: inventory.id, quantity: input.initialStock },
    }
  },
})
```

**Required fields:**
- `name` — Unique command identifier (kebab-case)
- `description` — Used for AI tool discovery and documentation
- `input` — Zod schema (validates input + generates JSON Schema)
- `workflow` — Async function receiving `(input, { step, log, auth, headers })`

## The step object

The workflow context provides `{ step, log, auth, headers }`:
- `step` — the fundamental unit of a workflow (typed, constrained, auto-compensated)
- `log` — structured logger
- `auth` — `AuthContext | null` (authenticated user, with `id` and `type`)
- `headers` — raw request headers

An AI cannot make mistakes with `step` — there are only 4 things you can do:

### step.service — Call service methods

```typescript
// CRUD (auto-compensated: create → delete on rollback)
const product = await step.service.catalog.create({ title: 'Widget', sku: 'W-001', price: 999 })
await step.service.catalog.update(product.id, { price: 1099 })
await step.service.catalog.delete(product.id)

// Custom compensable methods
await step.service.catalog.activate(product.id)
await step.service.inventory.adjustQuantity(inventoryId, -1)
```

Every `step.service.*` call is:
- **Checkpointed** — saved to storage, skipped on retry
- **Compensated** — rollback registered in LIFO order
- **Typed** — autocomplete from codegen (`.manta/types/`)

### step.service.MODULE.link — Create links

```typescript
// After creating both entities:
const product = await step.service.catalog.create({...})
const inventory = await step.service.inventory.create({...})

// Link them — IDs auto-resolved from previous creates
await step.service.catalog.link.inventoryItem()
```

The framework tracks the last created entity ID per type. `link.inventoryItem()` automatically resolves the Product ID and InventoryItem ID from the workflow context.

### step.command — Call sub-commands

```typescript
// Execute another command as a sub-command
const result = await step.command.createProduct({
  title: 'Widget',
  sku: 'W-001',
  price: 999,
})
```

The sub-command runs within the same compensation chain. If it fails, all its steps are compensated along with the parent.

### step.workflow — Call module workflows

```typescript
// Execute a module workflow (defined with defineWorkflow)
const result = await step.workflow.catalog.categorizeProduct({
  productId: product.id,
  categoryId: 'cat_123',
})
```

Module workflows are defined in `src/modules/{mod}/workflows/` with `defineWorkflow()`. They are scoped to a single module and contain pure business logic (no auth context). Commands invoke them via `step.workflow.MODULE.NAME(input)`.

### step.action — External actions with compensation

```typescript
// For external API calls where you MUST provide compensation
const chargeResult = await step.action('charge-payment', {
  invoke: async (input) => {
    const charge = await stripe.charges.create({ amount: input.amount })
    return { chargeId: charge.id }
  },
  compensate: async (result) => {
    await stripe.refunds.create({ charge: result.chargeId })
  },
})({ amount: 4999 })
```

`step.action()` **requires** a `compensate` function. No exceptions. This ensures external side-effects are always reversible.

### step.emit — Fire events

```typescript
await step.emit('product.created', { id: product.id, sku: input.sku })
await step.emit('inventory.stocked', { productId: product.id, quantity: 100 })
```

Events are **buffered** until the workflow commits. If the workflow fails and compensates, events are NOT emitted. Subscribers only see events from successful workflows.

## What happens automatically

When you define a command:

1. **Input validation** — Zod schema validates before workflow runs. Invalid input returns HTTP 400 with Zod error details.
2. **Checkpoint storage** — Each step result is saved. If the process crashes, the workflow resumes from the last completed step.
3. **Compensation (rollback)** — If any step fails, all completed steps compensate in reverse order (LIFO).
4. **Retry** — 3 attempts with exponential backoff (configurable).
5. **Event buffering** — `step.emit()` events are held until the workflow succeeds, then emitted together.
6. **HTTP endpoint** — `POST /api/{context}/command/create-product` with Zod-validated JSON body.
7. **AI tool schema** — `GET /api/{context}/tools` returns JSON Schema for all exposed commands.
8. **OpenAPI** — `GET /api/openapi.json` includes the command with full schema.

## Two types of commands

### Application commands (cross-module)

Located in `src/commands/`. These orchestrate multiple modules:

```
src/commands/create-product.ts
src/commands/checkout.ts
```

They can call any module's service via `step.service.*`:

```typescript
// src/commands/create-product.ts
workflow: async (input, { step }) => {
  const product = await step.service.catalog.create({...})
  const inventory = await step.service.inventory.create({...})
  await step.service.catalog.link.inventoryItem()
  // ↑ Cross-module: catalog + inventory
}
```

### Module workflows (scoped — defineWorkflow)

For intra-module business logic that orchestrates multiple entities within a module, use `defineWorkflow()` in `src/modules/{name}/workflows/`:

```
src/modules/catalog/workflows/categorize-product.ts
src/modules/catalog/workflows/activate-and-publish.ts
```

```typescript
// src/modules/catalog/workflows/activate-and-publish.ts
export default defineWorkflow({
  name: 'activate-and-publish',
  input: z.object({ id: z.string() }),
  workflow: async (input, { step, log }) => {
    // Can only use step.service.catalog.* — scoped to this module
    await step.service.catalog.activate(input.id)
    await step.emit('product.activated', { id: input.id })
    log.info(`Product ${input.id} activated`)
    return { id: input.id, status: 'active' }
  },
})
```

**Key differences from defineCommand:**
- Receives `{ step, log }` — NO `auth`, NO `headers` (pure business logic)
- NOT an HTTP endpoint — only callable from commands via `step.workflow.MODULE.NAME(input)`
- Scoped to one module — the step proxy only resolves the module's own entities
- Has compensation (same step proxy as commands)

### Calling module workflows from commands

Application commands invoke module workflows via `step.workflow`:

```typescript
// src/commands/admin/create-and-activate.ts
workflow: async (input, { step, auth }) => {
  const product = await step.service.catalog.create({...})
  // Call the module workflow — runs in same compensation chain
  await step.workflow.catalog.activateAndPublish({ id: product.id })
}
```

The module workflow runs within the parent's compensation chain. If it fails, all steps compensate.

## Validation errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Command name is required` | Missing name | Add `name: 'my-command'` |
| `Command "X" requires a description` | Missing description | Add `description: '...'` (used for AI tool discovery) |
| `Command "X" requires an input Zod schema` | Missing input | Add `input: z.object({})` (use empty for no-input commands) |
| `Command "X" workflow must be an async function` | workflow is not a function | Add `workflow: async (input, { step }) => {...}` |
| `Command "X" is already registered` | Duplicate name | Rename one of the commands |
| `Cannot link: no Product created yet` | Link before create | Call `step.service.catalog.create()` before `step.service.catalog.link.*()` |
| `Service "X" has no method "Y"` | Typo in method name | Check the service's `defineService()` for available methods |
| `step.action("X") requires a compensate function` | Missing compensate | Add `compensate: async (result) => {...}` to the action config |
