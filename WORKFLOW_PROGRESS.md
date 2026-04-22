# Workflow Progress Tracking — Design

> **Purpose of this document**: This is the authoritative design for how Manta tracks, reports, and lets the frontend observe workflow execution — from sub-second commands to multi-hour long-running jobs. It exists so any builder (human or agent) can implement the feature without re-deriving the tradeoffs. Read it in full before touching code.
>
> **Status**: Design locked. Ready for `thinker → spec → architect → builder` pipeline.

---

## 1. Problem

Manta workflows run in serverless environments (Vercel, Neon). Their durations span three orders of magnitude:

- **90% of commands** — sub-second DB writes (cart update, user edit, form submission)
- **Some commands** — a few seconds (external API calls, email sends)
- **Edge cases** — minutes to hours (product imports, data migrations, event-stream replays, snapshot reconstructions)

Today the implicit UX is "spin until it resolves". That's fine for the 90%, broken for the rest: the user can't close their tab, can't see where the work is, can't cancel.

**Goal** — a single primitive, `useCommand`, that handles all durations transparently:
- Short commands: zero observable change, no overhead, inline response.
- Long commands: the same hook exposes live progress, step timeline, and cancel — no new API to learn, no opt-in flag to remember.

---

## 2. Non-goals

| Rejected | Why |
|---|---|
| SSE / WebSocket transport | Serverless function durations cap out (10s hobby, 60s pro, 15min fluid). Long workflows outlive any connection. Reconnection logic = reinventing polling, but worse. |
| Adaptive polling (500ms → 2s → 30s) | Added complexity, no perceptible benefit. 1s fixed is predictable and always responsive. |
| `trackable: true` / `estimatedDuration` on `defineCommand` | Command duration is input-dependent. Trackability should be emergent, not declared. |
| Per-step `progressThrottle` config | Unnecessary once progress writes go to Redis (fire-and-forget, no throttle needed). |
| Writing all progress to Postgres | Conflates durability and liveness. Create write amplification, locking, throttle UX degradation. |
| Blocking cancel (wait for current step) | User expects cancel to be immediate. Polite cancel is an anti-feature. |
| `current_step: string` field on runs | Breaks when parallel DAG steps land. Derive "active steps" from the steps array. |

---

## 3. Core insight — separate **durability** from **liveness**

Two questions, two stores.

| Question | Store | Write volume | Latency |
|---|---|---|---|
| "Did step N happen? What was the final result?" | **Postgres** (`workflow_runs`) | O(steps) per workflow — a handful | ms |
| "Where is the running step right now?" | **Upstash Redis** (cache) | Unbounded, fire-and-forget | sub-ms |

**Why this matters** — forcing intermediate progress into Postgres is a category error:
- Progress is ephemeral, lossy-tolerant, liveness-oriented. Redis is that.
- Postgres is for durability: state transitions, audit trail, final result.

Separating them produces three compounding benefits:
1. `ctx.progress()` has **zero throttle**. Dev calls it freely — 10 000 times/sec if they want. Redis doesn't care.
2. DB write volume is **bounded by step count**, not by progress event count.
3. The status endpoint reads both in parallel and merges — cheap, fast, no lock contention.

This is the defining architectural choice of the whole feature. Everything else follows.

---

## 4. Architecture

```
                  ┌────────────────────────────────────┐
                  │          CLIENT (useCommand)        │
                  │  run() → inline result OR runId     │
                  │  polls /_workflow/:id every 1s      │
                  │  exposes { status, steps, ... }     │
                  └─────────────────┬──────────────────┘
                                    │
                                    │ HTTP poll (1s fixed)
                                    ▼
                  ┌────────────────────────────────────┐
                  │     GET/DELETE /_workflow/:id       │
                  │     Promise.all([dbRead, redisRead])│
                  │     merge → respond                 │
                  └──────┬────────────────────────┬────┘
                         │                        │
                durable  ▼                        ▼  live
            ┌──────────────────┐         ┌────────────────────┐
            │  workflow_runs    │         │  workflow:{id}:    │
            │  (Postgres)       │         │  progress          │
            │                   │         │  (Upstash Redis)   │
            │  state transitions│         │  TTL 1h            │
            │  only             │         │  latest overrides  │
            └─────────▲────────┘         └──────────▲─────────┘
                      │                             │
                      │    written by engine        │    written by
                      │    on transitions           │    ctx.progress()
                      │                             │
                      └─────────────┬───────────────┘
                                    │
                                    ▼
                      ┌──────────────────────────┐
                      │   WORKFLOW STEP HANDLER   │
                      │   (serverless invocation) │
                      └──────────────────────────┘
```

---

## 5. Data model

### 5.1 Postgres — `workflow_runs`

```ts
interface WorkflowRun {
  id: string                     // runId (UUID)
  command_name: string
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  steps: StepState[]             // ordered, same order as command definition
  input: unknown                 // JSONB
  output?: unknown               // JSONB, set on success
  error?: {                      // JSONB, set on failure
    message: string
    code?: string
    stack?: string
  }
  started_at: Date
  completed_at?: Date
  cancel_requested_at?: Date
}

interface StepState {
  name: string
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'compensated'
  started_at?: Date
  completed_at?: Date
  error?: { message: string; code?: string }
}
```

**Writes** — only on state transitions:
- Workflow created (pending → running)
- Step started (pending → running)
- Step succeeded/failed/compensated
- Workflow terminal (succeeded/failed/cancelled)

Expected volume: **~2× step count** writes per workflow. Nothing for Postgres.

**No `current_step` field.** The client derives active steps via:
```ts
const active = run.steps.filter(s => s.status === 'running')
```
This future-proofs against parallel DAG execution (active becomes a list of length > 1) without schema change.

### 5.2 Redis — `workflow:{runId}:progress`

```ts
interface ProgressSnapshot {
  stepName: string               // which step is reporting
  current: number
  total: number
  message?: string
  at: number                     // epoch ms
}
```

- **One key per workflow**, updated in place — latest overrides previous. No history retained.
- **TTL 1h** (or cleared on workflow completion, whichever first).
- **Fire-and-forget writes** — `ctx.progress()` does not await Redis response.

---

## 6. API contracts

### 6.1 `run()` — 300ms short-circuit

The engine races the workflow against a 300ms timer on the HTTP invocation:

```ts
type RunResult<T> =
  | { status: 'succeeded'; result: T }
  | { status: 'failed'; error: MantaError }
  | { runId: string; status: 'running' }
```

- If the workflow completes within 300ms → full result inline, no runId exposed, client doesn't poll.
- Otherwise → `{ runId, status: 'running' }` returned immediately; workflow continues in background (subsequent steps via job queue / function chaining — standard Manta machinery).

**Why 300ms** — aligns with the UX threshold where users start perceiving latency (Nielsen ~100ms-1s). Most CRUD commands finish in under 100ms; the 300ms window absorbs normal variance without ever exposing runId for the 90% case.

### 6.2 `ctx.progress(current, total, message?)`

Injected into every step handler. Non-blocking, never throws, no throttle.

```ts
step('import-products', async (input, ctx) => {
  for (let i = 0; i < products.length; i++) {
    await importOne(products[i])
    ctx.progress(i + 1, products.length, `Imported ${products[i].title}`)
  }
})
```

Implementation sketch:
```ts
ctx.progress = (current, total, message?) => {
  progressChannel
    .set(runId, { stepName, current, total, message, at: Date.now() })
    .catch(err => logger.warn({ err }, 'progress write failed'))
}
```

- Returns `void` synchronously. Fire-and-forget.
- Errors logged, never propagated. Progress is observability, not correctness.

### 6.3 `ctx.signal` — cancellation

Standard `AbortSignal`. Aborted when `cancel_requested_at` is written to the run.

**Contract with step authors**: any long-running step MUST respect `ctx.signal`. Either:
- Pass it through to I/O: `fetch(url, { signal: ctx.signal })`
- Check between work units: `if (ctx.signal.aborted) throw new CancelledError()`

Node can't forcibly interrupt a running promise — cooperation is required. `ctx.forEach` (below) handles this automatically, so in practice most devs never manually check the signal.

### 6.4 `ctx.forEach(items, opts, handler)` — ergonomic helper

Combines **batching + progress + cancel** into one idiom. This is the recommended default for any iterative long-running work.

```ts
step('import-products', async (input, ctx) => {
  await ctx.forEach(products, { batchSize: 100 }, async (batch, info) => {
    await db.insert(productsTable).values(batch)
    // progress(info.done, info.total) called automatically after each batch
    // ctx.signal.aborted checked automatically between batches
  })
})
```

Signature:
```ts
ctx.forEach<T>(
  items: T[] | AsyncIterable<T>,
  opts: { batchSize: number; message?: (info: ForEachInfo) => string },
  handler: (batch: T[], info: ForEachInfo) => Promise<void>
): Promise<void>

interface ForEachInfo {
  done: number
  total: number              // approximate for AsyncIterable
  batchIndex: number
}
```

Accepting `AsyncIterable` lets streams (e.g., paginated API responses) flow through without buffering the full list in memory.

### 6.5 HTTP endpoints

#### `GET /_workflow/:id`

Merged snapshot read.

```ts
// Server implementation (pseudocode)
const [durable, live] = await Promise.all([
  workflowStore.get(runId),
  progressChannel.get(runId),
])
if (!durable) return 404

return {
  id: durable.id,
  command_name: durable.command_name,
  status: durable.status,
  steps: durable.steps,
  inFlightProgress: live ?? undefined,   // only present if a step is running and reporting
  output: durable.output,
  error: durable.error,
  started_at: durable.started_at,
  completed_at: durable.completed_at,
}
```

Cost: one Postgres `SELECT` by PK + one Redis `GET`, in parallel. ~5ms. Cacheable behind a short edge TTL if needed (0.5-1s).

#### `DELETE /_workflow/:id`

Requests cancellation.

```ts
await workflowStore.requestCancel(runId)   // sets cancel_requested_at
// Engine detects on next signal check, aborts current step, runs compensation
return { status: 'cancel_requested' }
```

Idempotent. No-op if workflow is already terminal.

---

## 7. `useCommand` hook

Single hook, one shape, handles all durations.

```ts
const {
  run,           // (input) => Promise<RunResult<Output>>
  runId,         // string | undefined
  status,        // 'idle' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  steps,         // StepState[] | undefined
  progress,      // ProgressSnapshot | undefined — live from Redis for the active step
  result,        // Output | undefined
  error,         // MantaError | undefined
  cancel,        // () => Promise<void>
} = useCommand<Input, Output>('command:name')
```

### Behavior

1. **Idle** — hook mounts, nothing happens until `run()` is called.
2. **Run inline** — `run(input)` calls the engine. If engine returns `{ status: 'succeeded' | 'failed', ... }` inline → hook sets `result` / `error`, `status` becomes terminal, no polling.
3. **Run async** — if engine returns `{ runId, status: 'running' }` → hook sets `runId`, `status: 'running'`, and enters polling mode.
4. **Polling** — fetches `/_workflow/:runId` every **1 second** (fixed). Stops automatically on terminal status.
5. **Cancel** — `cancel()` calls `DELETE /_workflow/:runId`. No-op unless `runId` exists and `status === 'running'`. Polling continues until the server reports a terminal status (cancelled).

### Read-only mode

For pages that observe an existing run (e.g., the dashboard detail page), the hook can be initialized with a runId without calling `run()`:

```ts
const status = useCommand('command:name', { runId: 'abc-123' })
// Polls immediately, never calls run()
```

### Frontend example — long workflow with navigation

```tsx
function ImportButton() {
  const { run, status } = useCommand('products:import')
  const navigate = useNavigate()

  async function onClick() {
    const res = await run({ file: selectedFile })
    if ('runId' in res) {
      navigate(`/admin/_runs/${res.runId}`)
    }
    // else: short workflow completed inline, show inline success
  }

  return <Button onClick={onClick} loading={status === 'running'}>Import</Button>
}
```

The frontend decides whether to navigate, show inline, or both. The hook makes no assumption about UX.

---

## 8. Dashboard — generic run viewer

Route: `/admin/_runs/:runId` — shipped by `dashboard-core`, always available.

A generic component that takes a runId, mounts `useCommand` in read-only mode, and renders:

- Command name + overall status badge
- Ordered step timeline — each step shows status icon (pending / running / success / failed / cancelled / compensated), started/completed timestamps, error detail if failed
- For the currently running step: progress bar if `progress.total > 0`, indeterminate spinner with `progress.message` otherwise
- Cancel button (shown while `status === 'running'`)
- Error detail panel (if failed)
- Result preview (collapsible JSON) on success

**This page is a fallback.** End-developers can render their own run viewer using the same `useCommand` hook — the shipped page exists so a newly-created long command works out of the box with zero frontend code.

A reusable `<WorkflowStatus runId={...} />` component is also exported from `dashboard-core` for embedding in custom pages.

---

## 8.1 Persistent toast layer (dashboard-core)

**Problem.** Triggering a long workflow from a list or detail page used to navigate the user to `/admin/_runs/:runId`, ejecting them from the work they were doing. Delete commands were especially painful: click delete on row N, get teleported away, lose scroll position and filters.

**Solution.** A persistent sonner toast that observes the run in-place. The user stays on the page that started the work; the toast shows live progress, a Cancel button, and a "Voir les détails" link that navigates to the full run page on demand. The toast survives navigation within the originating page via a sessionStorage registry + resurrection effect.

### 8.1.1 Public API

```ts
import { toastWorkflowRun } from '@manta/dashboard-core'

toastWorkflowRun(runId, {
  commandName: 'import-products',     // used as fallback label
  commandLabel: 'Importer produits',  // optional display label
  originPath?: string,                // defaults to window.location.pathname
  detailPath?: string,                // defaults to `/_runs/${runId}`
})
```

Callers must only invoke this on the `'running'` branch of `run()`:

```tsx
const r = await cmd.run(input)
if (r.status === 'running') {
  toastWorkflowRun(r.runId, { commandName, commandLabel })
  return
}
// handle 'succeeded' / 'failed' inline as before
```

Three dashboard-core call sites are already wired:
- `blocks/PageHeader.tsx` — `CommandButton` (action-bar commands)
- `blocks/PageHeader.tsx` — delete command on detail pages
- `renderers/FormRenderer.tsx` — create/edit form submissions

### 8.1.2 Behavior rules

- **Stacking**: each run mounts its own toast. Sonner's default stack order applies. No artificial cap today — revisit if live workflow count routinely exceeds ~3.
- **Dedupe**: `toast.custom` receives `id: workflow-run-${runId}`, so repeat calls with the same runId are a no-op (sonner merges by id).
- **Never auto-dismiss while running**: `duration: Number.POSITIVE_INFINITY`, `dismissible: false`. Only terminal status or an explicit Cancel removes the toast.
- **Completion**: on `succeeded` / `failed` / `cancelled`, the persistent toast is dismissed and replaced by a transient `toast.success` / `toast.error` / `toast.message` (4 s, 10 s for failure with error description).
- **Orphan fallback**: if polling errors N consecutive times (`ORPHAN_THRESHOLD = 5`), the toast dismisses itself with an "Exécution introuvable" message. This covers runs that were deleted server-side.

### 8.1.3 Resurrection (sessionStorage registry)

The challenge: when the user navigates away from the page that started the run and returns, sonner's in-memory state is gone — the toast has to be recreated from scratch.

Mechanism:
1. `toastWorkflowRun()` writes an `ActiveRun` record to `window.sessionStorage` under key `manta.activeRuns` (runId, commandName, originPath, detailPath, startedAt).
2. `<ActiveRunsBridge />` is mounted inside `MainLayout`. On every pathname change, `useResurrectActiveRuns()` walks the registry and re-emits `toast.custom` for each run whose `originPath === currentPathname`. Sonner dedupes by `id`, so the call is a no-op if the toast is still visible.
3. On terminal status or orphan detection, the run is removed from the registry.

**Exact-match only.** `originPath` is compared with `===` against `location.pathname`. No prefix matching, no query-string normalization. This is deliberate: a toast spawned on `/admin/products` should not resurrect on `/admin/products/abc` — the user is doing something else there.

**SSR-safe.** Every storage op guards `typeof window !== 'undefined'`.

### 8.1.4 File map

```
packages/dashboard-core/src/workflow/
  active-runs.ts                  — sessionStorage registry (list/has/add/remove/subscribe)
  toast-workflow-run.ts           — public helper
  workflow-toast.tsx              — internal <WorkflowToast> (mounts useCommand in read-only mode)
  use-resurrect-active-runs.ts    — hook + pure resurrectForPath(pathname)
  active-runs-bridge.tsx          — render-less <ActiveRunsBridge /> shell bridge
  index.ts                        — barrel (exports toastWorkflowRun + ActiveRunsBridge)

packages/dashboard-core/tests/
  active-runs.test.ts             — 7 registry tests (AR-01..07)
  toast-workflow-run.test.tsx     — 5 helper tests (TWR-01..05)
  use-resurrect-active-runs.test.tsx — 4 resurrection tests (URA-01..04)
```

### 8.1.5 Out of scope (deferred)

- **Overflow UI** — no "Cap 3 + N more" indicator when many runs stack. Defer until a real call site stacks noisily.
- **Cross-tab sync** — a run started in tab A does not show as a toast in tab B. Would use `BroadcastChannel`; not needed for the pilot use case.
- **Public SDK `useActiveRuns()`** — not exported. End-developers who want a custom badge/list must reach into dashboard-core today.
- **401-aware dismissal** — orphan fallback triggers the same way for a lost session as for a truly missing run. Should short-circuit on 401 with "Veuillez vous reconnecter".
- **Generic wrapper** (`useRunDashboardCommand`) — to prevent future call sites from forgetting to call `toastWorkflowRun()` on the running branch (spec Risk 6). The three existing sites are correct; a fourth might not be.

---

## 9. Ports and adapters

Two new ports, following Manta's existing architecture.

### 9.1 `IWorkflowStorePort` (durable, required)

```ts
interface IWorkflowStorePort {
  create(run: NewWorkflowRun): Promise<void>
  updateStep(runId: string, stepName: string, patch: Partial<StepState>): Promise<void>
  updateStatus(
    runId: string,
    status: WorkflowStatus,
    fields?: { output?: unknown; error?: WorkflowError; completed_at?: Date }
  ): Promise<void>
  requestCancel(runId: string): Promise<void>
  get(runId: string): Promise<WorkflowRun | null>
}
```

- **Default adapter**: Postgres via `adapter-database-pg` / `adapter-database-neon`.

### 9.2 `IProgressChannelPort` (ephemeral, optional but auto-detected)

```ts
interface IProgressChannelPort {
  set(runId: string, snapshot: ProgressSnapshot): Promise<void>
  get(runId: string): Promise<ProgressSnapshot | null>
  clear(runId: string): Promise<void>
}
```

Three adapters, chosen by the engine based on configured capabilities:

| Adapter | When used | Behavior |
|---|---|---|
| `progress-upstash` (default) | Upstash cache is configured | Single `SET` per call with TTL. Sub-ms. |
| `progress-db` (fallback) | No cache available | Postgres write **throttled at 500ms**. Degraded but functional. |
| `progress-memory` (test) | Test containers | In-process map. |

The engine wires `ctx.progress()` to whichever is present. Users never configure this explicitly — it's detected from the container.

---

## 10. Engine implementation notes

### 10.1 Step lifecycle

```
1. Engine picks next pending step (or next batch for parallel DAG)
2. store.updateStep(runId, step, { status: 'running', started_at: now })
3. Invoke handler with ctx = {
     input,
     signal: abortController.signal,
     progress: (...) => progressChannel.set(runId, ...),
     forEach: (items, opts, handler) => ...,  // uses progress + signal internally
   }
4. On success: store.updateStep(..., { status: 'succeeded', completed_at: now })
5. On handler error: store.updateStep(..., { status: 'failed', error })
                    → trigger compensation for completed steps (existing mechanism)
6. On cancel (signal fired via requestCancel): step throws CancelledError
                    → store.updateStep(..., { status: 'cancelled' })
                    → run compensation
7. When all steps terminal: store.updateStatus(runId, status, { output, error, completed_at: now })
8. progressChannel.clear(runId)  // free Redis slot immediately
```

### 10.2 Progress writes — fire-and-forget

```ts
// Injected into ctx
const progress = (current: number, total: number, message?: string): void => {
  progressChannel
    .set(runId, { stepName: currentStepName, current, total, message, at: Date.now() })
    .catch(err => logger.warn({ err, runId, stepName: currentStepName }, 'progress write failed'))
  // returns immediately — never awaited
}
```

Three invariants:
1. **Never awaited** — calling `ctx.progress()` does not add latency to the step's hot loop.
2. **Never throws** — channel errors are logged, not propagated. A dead Redis must not fail a workflow.
3. **No throttle** — up to the channel implementation to cope. Upstash handles thousands/sec trivially; the DB fallback handles throttling itself.

### 10.3 Cancel detection

The engine watches `cancel_requested_at` via whichever mechanism is natural for the host:
- **Preferred**: event bus notification (if `adapter-eventbus-upstash` configured — publish a `workflow:cancel:{runId}` event on DELETE endpoint).
- **Fallback**: cancel check on each step boundary (not ideal for long single steps — hence the eventbus path).

On detection → `abortController.abort()` → step's `ctx.signal` fires → step is expected to throw `CancelledError` → compensation runs.

### 10.4 Compensation

Reuses the existing compensation machinery in Manta's workflow engine. Compensation runs in reverse order for all steps whose status is `succeeded`. After compensation, those steps get status `compensated`.

This is unchanged from today — the feature just adds the `cancelled` status for the step that was mid-flight, and ensures the overall workflow status is `cancelled`.

---

## 11. Reference use case — PostHog cart snapshot rebuild

The motivating concrete scenario. Use this to validate the design end-to-end.

- **Command**: `snapshot:rebuild-cart-from-events`
- **Input**: `{ cartId: string }`
- **Duration**: variable, minutes on busy carts
- **Steps**:

  1. `fetch-events` — paged reads from PostHog API. Uses `ctx.signal` via `fetch()`. Reports `ctx.progress(fetched, null, "Fetched N events so far")` (total unknown until last page).
  2. `replay-events` —
     ```ts
     await ctx.forEach(events, { batchSize: 500 }, async (batch) => {
       for (const event of batch) applyEventToSnapshot(event, snapshot)
     })
     ```
     Progress flows automatically.
  3. `persist-snapshot` — single DB insert.
- **Cancel**: aborts PostHog pagination mid-flight, skips replay and persist, compensation no-ops (nothing persisted yet).
- **Failure**: if any step fails, workflow status `failed`, error captured.

The frontend experience:
- Admin clicks "Rebuild snapshot" on cart detail page.
- Workflow takes > 300ms → returns runId → frontend navigates to `/admin/_runs/:runId`.
- Admin sees step timeline, current step, live progress bar, cancel button.
- Admin closes tab, comes back in 10 min, opens the URL → same page restores from DB+Redis.
- On complete, result payload shown inline with link back to cart.

If this works, the design works.

---

## 12. Implementation checklist

### Core engine (`packages/core`)

- [ ] `workflow_runs` table + migration (adapter-database-pg, adapter-database-neon)
- [ ] `IWorkflowStorePort` interface + default Postgres adapter
- [ ] `IProgressChannelPort` interface + three adapters (upstash, db-fallback, memory)
- [ ] Auto-selection of progress adapter based on container capabilities
- [ ] `ctx.progress()` injection in step runtime
- [ ] `ctx.signal` injection (AbortController per step)
- [ ] `ctx.forEach()` helper (batching + progress + cancel)
- [ ] `run()` short-circuit: race workflow against 300ms timer
- [ ] HTTP routes: `GET /_workflow/:id`, `DELETE /_workflow/:id`
- [ ] Cancel eventbus publish on DELETE (if eventbus configured)
- [ ] Compensation path for `cancelled` status (reuse existing compensation)

### SDK (`packages/sdk`)

- [ ] `useCommand` polling mode — 1s fixed, starts on runId, stops on terminal status
- [ ] Hook state shape: `{ run, runId, status, steps, progress, result, error, cancel }`
- [ ] Read-only mode: `useCommand(name, { runId })` skips `run()`, polls immediately
- [ ] `cancel()` wired to `DELETE /_workflow/:runId`

### Dashboard (`packages/dashboard-core`)

- [ ] Route `/admin/_runs/:runId` — generic run viewer
- [ ] `<WorkflowStatus runId={...} />` reusable component
- [ ] Step timeline renderer (ordered, per-step icon + state)
- [ ] Progress bar (determinate if `total > 0`, indeterminate fallback with message)
- [ ] Cancel button
- [ ] Error detail panel
- [ ] Result preview (collapsible JSON)

### Tests

- [ ] Unit: `run()` short-circuits correctly at 300ms (sub/over boundary)
- [ ] Unit: `ctx.progress` is non-blocking, never throws, writes to channel
- [ ] Unit: `ctx.forEach` emits progress per batch, checks cancel between batches
- [ ] Integration: cancel mid-step triggers compensation in reverse order
- [ ] Integration: `GET /_workflow/:id` merges DB + Redis snapshots correctly
- [ ] Integration: `progress-db` fallback adapter respects 500ms throttle
- [ ] E2E: PostHog snapshot rebuild — observe live, cancel midway, verify compensation

### Docs

- [ ] Add example in `demo/commerce/` wiring a long command + dashboard page
- [ ] Update CLAUDE.md with pointer to this doc
- [ ] Update BACKLOG.md: move related items to this feature's scope

---

## 13. Summary — the one-paragraph version

Manta workflows write **state transitions** to Postgres (durable, O(steps)) and **in-flight progress** to Upstash Redis (ephemeral, unbounded, fire-and-forget). `run()` awaits up to 300ms and returns results inline for short workflows, or a runId for long ones. `useCommand` polls `GET /_workflow/:id` every 1 second whenever a runId is present, exposing live status, step timeline, and progress to the frontend via a uniform hook shape. Steps use `ctx.progress()` (no throttle, no cost), `ctx.signal` (cancel-aware), and `ctx.forEach()` (batched iteration with both built in). Cancellation is immediate via `AbortSignal` + existing compensation. A generic `/admin/_runs/:runId` dashboard page ships by default. No new transport, no new config flags, no adaptive anything — one mechanism, cleanly separated into durability vs liveness, end to end.
