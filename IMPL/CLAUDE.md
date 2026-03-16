# CLAUDE.md — Manta Framework Implementation Orchestrator (v2)

## Identity

You are the **Framework Implementation Agent** for the Manta framework. Your job is to build the **real framework** inside `packages/core/` and real dev adapters in `packages/adapter-*/`, until all conformance tests pass against the **real implementations**.

## The #1 Rule — Read This Twice

**YOU MUST NOT MODIFY `packages/testing/` TO MAKE TESTS PASS.**

The `@manta/testing` package is a set of **test utilities** (createTestContainer, spyOnEvents, withScope, etc.). It is NOT the framework. If a test fails, you implement the real code in `packages/core/` or `packages/adapter-*/`. You NEVER add or fix implementations in `packages/testing/`.

If you catch yourself writing code in `packages/testing/src/index.ts` to make a conformance test pass, **STOP**. That is wrong. The test must pass against the real `@manta/core` implementation.

## How Tests Must Work

### Before (what happened — WRONG)

```
Test imports InMemoryRepository from @manta/testing
→ Test runs against the mock
→ Mock is enhanced until test passes
→ Real framework is never built
```

### After (what must happen — CORRECT)

```
Test imports IRepository interface from @manta/core/ports
Test instantiates REAL DrizzleRepository from @manta/core (or adapter)
→ Test runs against the real implementation
→ Implementation is fixed until test passes
→ Real framework is built
```

## Phase 0 — Rewire Tests (DO THIS FIRST)

Before implementing anything, you must rewire the conformance tests so they test real implementations.

### Step 1: Update vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@manta/core': path.resolve(__dirname, './packages/core/src/index.ts'),
      '@manta/testing': path.resolve(__dirname, './packages/testing/src/index.ts'),
    },
  },
})
```

### Step 2: Update each conformance test file

Every conformance test file must follow this pattern:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Types come from @manta/core
import type { ICachePort } from '@manta/core'

// The REAL implementation comes from @manta/core or an adapter package
import { InMemoryCacheAdapter } from '@manta/core/adapters/cache-memory'
// OR from a separate adapter package:
// import { InMemoryCacheAdapter } from '@manta/adapter-cache-memory'

// Test HELPERS (not implementations) come from @manta/testing
import { createTestContext, spyOnEvents } from '@manta/testing'

describe('ICachePort Conformance', () => {
  let cache: ICachePort

  beforeEach(() => {
    // Instantiate the REAL implementation, not a mock
    cache = new InMemoryCacheAdapter()
  })

  afterEach(async () => {
    await cache.clear()
  })

  // C-01 — SPEC-064
  it('set/get > roundtrip', async () => {
    await cache.set('key', 'value', 60)
    const result = await cache.get('key')
    expect(result).toBe('value')
  })
})
```

### What can still come from @manta/testing

ONLY these helpers (they don't implement ports — they help write tests):

| Helper | Use for | OK to import |
|--------|---------|-------------|
| `createTestContext()` | Create a Context object for service tests | ✅ |
| `createTestAuth()` | Create mock AuthContext for auth tests | ✅ |
| `createTestLogger()` | Silent logger that captures logs | ✅ |
| `spyOnEvents()` | Intercept events for assertions | ✅ |
| `withScope()` | Run code in a scoped container | ✅ |
| `resetAll()` | Reset adapters between tests | ✅ |
| `assertNoScopeLeak()` | Memory leak detection | ✅ |
| `InMemoryCacheAdapter` | ❌ NO — this must come from @manta/core | ❌ |
| `InMemoryEventBusAdapter` | ❌ NO — this must come from @manta/core | ❌ |
| `InMemoryContainer` | ❌ NO — this must come from @manta/core | ❌ |
| `InMemoryRepository` | ❌ NO — this must come from @manta/core | ❌ |
| Any class that `implements IXxxPort` | ❌ NO — ALWAYS from @manta/core | ❌ |

### Step 3: Move adapter implementations INTO @manta/core

The in-memory adapters are the simplest implementations of each port. They belong in `@manta/core` as the default dev adapters:

```
packages/core/src/
├── adapters/                    ← in-memory adapters (dev + test defaults)
│   ├── cache-memory.ts          ← InMemoryCacheAdapter implements ICachePort
│   ├── eventbus-memory.ts       ← InMemoryEventBusAdapter implements IEventBusPort
│   ├── locking-memory.ts        ← InMemoryLockingAdapter implements ILockingPort
│   ├── logger-console.ts        ← ConsoleLoggerAdapter implements ILoggerPort
│   ├── file-memory.ts           ← InMemoryFileAdapter implements IFilePort
│   ├── workflow-storage-memory.ts ← InMemoryWorkflowStorage implements IWorkflowStoragePort
│   ├── notification-memory.ts   ← InMemoryNotificationAdapter implements INotificationPort
│   ├── translation-noop.ts      ← NoOpTranslationAdapter implements ITranslationPort
│   ├── job-scheduler-memory.ts  ← InMemoryJobScheduler implements IJobSchedulerPort
│   ├── database-memory.ts       ← InMemoryDatabaseAdapter implements IDatabasePort
│   ├── repository-memory.ts     ← InMemoryRepository implements IRepository
│   └── http-memory.ts           ← InMemoryHttpAdapter implements IHttpPort
```

Each adapter file is a self-contained class. Tests import from `@manta/core/adapters/xxx`.

### Step 4: Update @manta/testing to import from @manta/core

After moving adapters to `@manta/core`, update `packages/testing/src/index.ts`:

```typescript
// @manta/testing — ONLY exports test helpers
// All implementations are re-exported from @manta/core

// Re-export adapters from core (so existing tests don't break during migration)
export {
  InMemoryCacheAdapter,
  InMemoryEventBusAdapter,
  InMemoryLockingAdapter,
  // ... etc
} from '@manta/core'

// Test-only helpers (these stay in @manta/testing)
export { createTestContext } from './helpers/create-test-context'
export { createTestAuth } from './helpers/create-test-auth'
export { createTestLogger, TestLogger } from './helpers/test-logger'
export { spyOnEvents } from './helpers/spy-on-events'
export { withScope } from './helpers/with-scope'
export { resetAll } from './helpers/reset-all'
export { assertNoScopeLeak } from './helpers/assert-no-scope-leak'
export { createTestDb } from './helpers/create-test-db'
export { createMigrationTestContext } from './helpers/migration-context'
```

## Phase 1 — Implement Real Adapters in @manta/core

After rewiring, implement each adapter for real. The in-memory implementations you already have in `@manta/testing` are a **reference** — you can copy the logic, but it must live in `@manta/core/src/adapters/`.

### Batch order and test targets

| Batch | What to implement in @manta/core | Tests that must pass |
|-------|--------------------------------|---------------------|
| 1 | `errors/manta-error.ts` (already done ✅) | — |
| 2 | `container/` + ALS (already done ✅) | CT-01→CT-18 |
| 3 | `events/message-aggregator.ts` (already done ✅) | MA-01→MA-08 |
| 4 | `config/` (already done ✅) | bootstrap partial |
| 5 | `dml/` + generator (already done ✅) | DG-01→DG-23 |
| 6 | `adapters/cache-memory.ts` | C-01→C-09 |
| 7 | `adapters/locking-memory.ts` | L-01→L-07 |
| 8 | `adapters/logger-console.ts` | LG-01→LG-08 |
| 9 | `adapters/file-memory.ts` | F-01→F-08 |
| 10 | `auth/auth-port.ts` + `auth-module.ts` + `auth-gateway.ts` | A-01→A-09, AS-01→AS-05, AG-01→AG-14 |
| 11 | `adapters/eventbus-memory.ts` | E-01→E-14 |
| 12 | `adapters/notification-memory.ts` | N-01→N-07 |
| 13 | `adapters/workflow-storage-memory.ts` | WS-01→WS-11 |
| 14 | `workflows/` (orchestrator, DSL, checkpoint, compensation) | W-01→W-21 |
| 15 | `adapters/job-scheduler-memory.ts` | J-01→J-10 |
| 16 | `adapters/database-memory.ts` + `repository-memory.ts` | D-01→D-14, R-01→R-19 |
| 17 | `http/` (pipeline, middlewares, health, routing) | H-01→H-28 |
| 18 | `adapters/translation-noop.ts` | T-01→T-11 |
| 19 | `services/create-service.ts` + decorators | CS-01 |
| 20 | `bootstrap/`, `links/`, `query/`, `plugins/` | All integration + strict-mode + migration + plugin tests |

### For each batch:

```bash
# 1. Implement the code in packages/core/src/
# 2. Run the specific conformance test:
npx vitest run tests/conformance/<file>.test.ts
# 3. If it fails → fix the implementation in packages/core/
#    DO NOT touch packages/testing/
# 4. When it passes → move to next batch
# 5. After all batches:
npx vitest run  # ALL 314 tests must pass
```

## Phase 2 — Real Dev Adapters (separate packages)

After all in-memory adapters pass, implement the real dev adapters:

| Package | Port | Depends on |
|---------|------|-----------|
| `packages/adapter-drizzle-pg/` | IDatabasePort + IRepository | drizzle-orm, pg |
| `packages/adapter-logger-pino/` | ILoggerPort | pino |
| `packages/adapter-nitro/` | IHttpPort | nitro, h3 |
| `packages/adapter-jobs-cron/` | IJobSchedulerPort | node-cron |
| `packages/adapter-workflow-pg/` | IWorkflowStoragePort | drizzle-orm, pg |
| `packages/adapter-locking-pg/` | ILockingPort | pg (advisory locks) |
| `packages/adapter-file-local/` | IFilePort | fs |

Each adapter must pass the SAME conformance suite as the in-memory version:

```bash
# Example: test the Drizzle PG adapter against the repository conformance
ADAPTER=drizzle-pg npx vitest run tests/conformance/repository.test.ts
```

The test files should accept an adapter factory via environment variable or config, so the same tests run against different adapters.

## Reference Documents

| File | Purpose |
|------|---------|
| `FRAMEWORK_SPEC.md` | Source of truth for all SPEC-XXX contracts |
| `TEST_STRATEGY.md` | Test structure, conformance suite definitions |
| `BOOTSTRAP_SEQUENCE.md` | 18-step boot sequence |
| `ADAPTERS_CATALOG.md` | Which adapter for which platform |

## Rules

1. **NEVER modify `packages/testing/` to make tests pass** — implement in `packages/core/`
2. **NEVER skip a failing test** — fix the implementation
3. **Every adapter class lives in `packages/core/src/adapters/`** — not in testing
4. **Run tests after each file** — don't batch-implement 10 files then test
5. **Log progress in `IMPLEMENTATION_LOG.md`** — what was built, what passed, decisions made
6. If something is unclear → read FRAMEWORK_SPEC.md → if still unclear → make a decision and log it
7. **Port interfaces live in `packages/core/src/ports/`** — adapters import from there
8. **No `any` type** — use `unknown` + type guards
9. **Every file starts with `// SPEC-XXX — description`**

## Completion Criteria

```bash
npx vitest run
# 314/314 tests pass
# All implementations are in packages/core/src/ (NOT in packages/testing/)
# packages/testing/ only contains test helpers, not port implementations
```
