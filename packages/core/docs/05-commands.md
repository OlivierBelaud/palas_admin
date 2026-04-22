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

## Long-running commands — progress, cancel, and the 300ms race

Any command can take longer than 300ms. Some (data imports, event replays, snapshot rebuilds) take minutes. The framework handles all three regimes through a single primitive — `useCommand` on the client — so you never branch your UI on "is this long or short".

> **Full design**: `WORKFLOW_PROGRESS.md` at the repo root. This section summarizes the developer-facing surface.

### The 300ms race

When a client calls a command, the engine races the workflow against a 300ms timer:

- **If the workflow completes within 300ms** → full result returned inline. The client sees a normal sub-second request, no runId is exposed, nothing to observe.
- **Otherwise** → the HTTP response is `202 Accepted` with envelope `{ runId, status: 'running' }`. The workflow continues in the background; the client uses the runId to observe progress.

This threshold is NOT configurable. It aligns with the UX threshold where users start perceiving latency. 90%+ of commands finish inside the window and never expose a runId.

### Step context helpers

Step handlers receive an extended `ctx` with three helpers. All are optional (only populated when the runtime has a store/channel wired) and zero-cost when unused.

#### `ctx.progress(current, total, message?)`

Report in-flight progress. **Fire-and-forget, synchronous return, never throws.**

```ts
step('import-products', async (input, ctx) => {
  for (let i = 0; i < products.length; i++) {
    await importOne(products[i])
    ctx.progress?.(i + 1, products.length, `Imported ${products[i].title}`)
  }
})
```

Signature:
```ts
progress?: (current: number, total: number | null, message?: string) => void
```

Invariants:
1. **Never awaited** — calling `ctx.progress()` adds zero latency to the step's hot loop.
2. **Never throws** — channel errors are logged, not propagated. A dead Redis must not fail a workflow.
3. **No throttle at the call site** — call it as often as you want. The channel adapter copes (Upstash handles volumes trivially; the DB fallback throttles internally at 500ms).
4. Pass `total: null` when the total is unknown (e.g. paginated API reads).

Progress is written to a liveness channel (Redis or DB fallback), **not** to Postgres. It's ephemeral by design — latest snapshot overrides previous, no history retained.

#### `ctx.signal` — cooperative cancellation

Standard `AbortSignal`. Aborted when `DELETE /api/admin/_workflow/:id` is called or the eventbus publishes `workflow:cancel:{runId}`.

**Contract for step authors**: any long-running step MUST respect `ctx.signal`. Either:

```ts
// Pass through to I/O — preferred
await fetch(url, { signal: ctx.signal })

// Or check between work units
if (ctx.signal?.aborted) throw new CancelledError()
```

Node cannot forcibly interrupt a running promise — cooperation is required. `ctx.forEach` (below) handles this automatically, so in practice most devs never manually check the signal.

On abort → the step is expected to throw → compensation runs in reverse order for all already-succeeded steps → overall status becomes `cancelled`.

#### `ctx.forEach(items, opts, handler)` — batched iteration with progress + cancel

Recommended default for any iterative long-running work. Combines batching, progress, and cancel into one idiom.

```ts
step('replay-events', async (input, ctx) => {
  await ctx.forEach?.(events, { batchSize: 500 }, async (batch, info) => {
    for (const event of batch) applyEventToSnapshot(event, snapshot)
    // ctx.progress() is called automatically after each batch completes
    // ctx.signal.aborted is checked automatically between batches
  })
})
```

Signature:
```ts
forEach?: <T>(
  items: T[] | AsyncIterable<T>,
  opts: { batchSize: number; message?: (info: ForEachInfo) => string },
  handler: (batch: T[], info: ForEachInfo) => Promise<void>,
) => Promise<void>

interface ForEachInfo {
  done: number
  total: number | null   // null for unbounded AsyncIterable
  batchIndex: number
}
```

Accepting `AsyncIterable` lets streams (paginated API responses, DB cursors) flow through without buffering the full list in memory — critical for workflows over millions of rows.

### Client — `useCommand`

One hook, all durations. The shape doesn't change between short and long commands.

```tsx
const { run, runId, status, steps, progress, result, error, cancel } = useCommand<Input, Output>('command-name')

async function onSubmit() {
  const res = await run(input)
  if ('runId' in res) {
    navigate(`/admin/_runs/${res.runId}`)  // long workflow — observe it
  }
  // else: inline result, show inline
}
```

| Field | Type | Semantics |
|---|---|---|
| `run(input)` | `(input) => Promise<RunResult>` | Kicks off the command. Returns inline result or `{ runId }`. |
| `runId` | `string \| undefined` | Present when the workflow is async. Triggers polling. |
| `status` | `'idle' \| 'running' \| 'succeeded' \| 'failed' \| 'cancelled'` | Overall workflow status. |
| `steps` | `StepState[] \| undefined` | Ordered step timeline with per-step status + timestamps. |
| `progress` | `ProgressSnapshot \| undefined` | Live snapshot from the active step (from liveness channel). |
| `result` | `Output \| undefined` | Final result on success. |
| `error` | `MantaError \| undefined` | Error details on failure. |
| `cancel()` | `() => Promise<void>` | `DELETE /api/admin/_workflow/:runId`. No-op if terminal. |

Polling: **1000ms fixed** whenever `runId` is set and status is non-terminal. Stops automatically on terminal status.

**Read-only mode** — for pages that observe an existing run without calling `run()`:
```ts
const status = useCommand('command-name', { runId: 'abc-123' })
// Polls immediately, never calls run()
```

### Dashboard integration — `<WorkflowStatus>` and `/admin/_runs/:runId`

The framework ships a generic run viewer out of the box. Every long command is observable at `/admin/_runs/:runId` with zero frontend code:

- Command name + status badge
- Ordered step timeline (pending / running / succeeded / failed / cancelled / compensated)
- Progress bar for the active step (determinate if `total > 0`, indeterminate spinner with message otherwise)
- Cancel button while `status === 'running'`
- Error detail panel on failure
- Collapsible result JSON on success

The `<WorkflowStatus runId={id} />` component is exported from `@manta/dashboard-core` so you can embed the same renderer in a custom page (e.g. a cart detail view showing the active "rebuild-snapshot" run inline).

When a user clicks a `PageHeader.CommandButton` or submits a form built from a command spec, the framework:
1. Calls `run(input)`.
2. If the response is `{ runId }` → navigates to `/admin/_runs/:runId`.
3. If the response is an inline result → shows inline success/error.

No client-side branching needed.

### HTTP routes (framework-owned)

| Route | Purpose |
|---|---|
| `POST /api/{context}/command/{name}` | Start command. Returns inline result OR `202 { runId, status: 'running' }`. |
| `GET /api/admin/_workflow/:id` | Merged snapshot — durable state (Postgres `workflow_runs`) + live progress (Redis or DB fallback). Returns 404 if runId unknown. |
| `DELETE /api/admin/_workflow/:id` | Requests cancellation. Idempotent. Publishes `workflow:cancel:{runId}` on the eventbus so cross-worker instances pick it up. |

These three routes are the entire API surface. `useCommand` is the only thing a frontend dev ever calls.

### Ports

Two ports power the feature. Both are auto-wired; you never configure them explicitly.

#### `IWorkflowStorePort` — durable

```ts
interface IWorkflowStorePort {
  create(run: NewWorkflowRun): Promise<void>
  updateStep(runId: string, stepName: string, patch: Partial<StepState>): Promise<void>
  updateStatus(runId: string, status: WorkflowStatus, fields?: { output?; error?; completed_at?: Date }): Promise<void>
  requestCancel(runId: string): Promise<void>
  get(runId: string): Promise<WorkflowRun | null>
}
```

Writes state transitions (O(steps) per workflow) to Postgres via `DrizzleWorkflowStore`. Table `workflow_runs` — created by `ensureFrameworkTables` in dev. **Append-on-miss semantics**: `updateStep` appends a new step if the name is not yet in the array (see port JSDoc).

#### `IProgressChannelPort` — ephemeral

```ts
interface IProgressChannelPort {
  set(runId: string, snapshot: ProgressSnapshot): Promise<void>   // never throws
  get(runId: string): Promise<ProgressSnapshot | null>
  clear(runId: string): Promise<void>
}
```

Auto-selection at bootstrap — `selectProgressChannel` in `init-infra.ts`:

| Adapter | Chosen when | Behavior |
|---|---|---|
| `UpstashProgressChannel` | `adapter-cache-upstash` configured | Single `SET` with TTL. Sub-ms. Preferred for prod. |
| `DbProgressChannel` | Postgres available, no cache | Throttled at 500ms to avoid write amplification. `workflow_progress` table. |
| `InMemoryProgressChannel` | Tests / no durable store | Process-local map. |

### Execution model — Node vs serverless

Manta's workflow engine runs **in-process**. The `WorkflowManager` is constructed per-request (per `wire-commands.ts`), and the per-run AbortController map lives in that instance. This has two implications:

**Node long-running host (default today, `host-nitro`)** — commands that take >300ms continue executing in the Node process that received the HTTP call. This is the happy path:
- Progress writes stream live.
- Cancel via `DELETE` aborts the same AbortController that the handler holds.
- Compensation runs normally on failure.

**Serverless (Vercel, etc.)** — function durations cap at 10s (hobby) / 60s (pro) / 15min (fluid). A workflow that outlives its invocation will be killed by the platform, leaving `workflow_runs.status = 'running'` indefinitely. V1 relies on Node long-running. For Vercel, see `WP-F04` in `BACKLOG.md` — a cron-based orphan-reaper is on the roadmap.

#### Cross-instance cancel

On serverless hosts, a workflow started on worker A can receive its `DELETE` on worker B. The per-run AbortController only exists in-memory on worker A, so we need a side channel to reach across workers.

**Mechanism**:

1. `DELETE /api/admin/_workflow/:id` writes `cancel_requested_at = now()` on `workflow_runs` (durable — survives worker death).
2. The same handler publishes `workflow:cancel:{runId}` on the event bus.
3. Every `WorkflowManager.run()` subscribes to `workflow:cancel:{runId}` at run start. If the payload matches a runId it's currently executing, it aborts its local AbortController.
4. The next step boundary sees `ctx.signal.aborted = true`, throws, compensation runs.

```
  Worker A                    Event Bus                 Worker B (running run X)
  ────────                    ─────────                 ────────────────────────
  DELETE /run/X ──► store.requestCancel(X)
                 └► publish 'workflow:cancel:X' ──────► subscription fires
                                                        └► abortControllers[X].abort()
                                                           └► next ctx.signal check
                                                              └► throw → compensate
```

**Requires**: a multi-worker event bus. `adapter-eventbus-upstash` is the supported choice for serverless deployments. In single-worker setups (dev, tests) `InMemoryEventBus` works trivially.

**Fallback without event bus** — the step-boundary check still works: each step transition reads `workflow_runs.cancel_requested_at` via `store.get(runId)` before continuing. Cancel is still honored, just with up to one extra step of latency (the current step runs to completion). See `WORKFLOW_PROGRESS.md` §10.3 for the full rationale.

### Reference use case — PostHog cart snapshot rebuild

The motivating scenario (see `demo/commerce/src/commands/admin/rebuild-carts.ts`):

1. `fetch-events` — paginated reads from PostHog API. `fetch(url, { signal: ctx.signal })`. Reports `ctx.progress(fetched, null, "Fetched N events")` (total unknown until last page).
2. `replay-events` — `ctx.forEach(events, { batchSize: 500 }, handler)`. Progress + cancel free. Compensation is no-op by design (destructive rebuild, non-reversible).
3. `persist-stats` — single DB write.

Admin flow:
- Click "Reconstruire" on cart list page.
- Workflow > 300ms → `{ runId }` returned → navigate to `/admin/_runs/:runId`.
- Live step timeline + progress bar + cancel button.
- Close tab, come back 10min later, reopen the URL → same page restores from DB + liveness channel.

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
