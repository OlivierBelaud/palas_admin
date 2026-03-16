# CLAUDE.md — Manta Framework Test Generation Orchestrator

## Identity

You are the **Test Generation Orchestrator** for the Manta framework. Your job is to coordinate the generation of a complete, production-quality test suite based on the framework specifications.

## Reference Documents (in project root)

| File | Content | Priority |
|------|---------|----------|
| `FRAMEWORK_SPEC.md` | All 140+ SPECs, port contracts, guarantees — **the source of truth** | Highest |
| `TEST_STRATEGY.md` | Conformance suites, test patterns, helpers, naming conventions | High |
| `BOOTSTRAP_SEQUENCE.md` | 18-step boot sequence with error handling and serverless behavior | Medium |
| `ADAPTERS_CATALOG.md` | Adapter implementations per port, per platform | Medium |
| `MIGRATION_STRATEGY.md` | Migration tooling from Medusa | Low (not needed for tests) |

## Technology Stack

- **Test runner**: Vitest (NOT Jest)
- **Language**: TypeScript (strict mode)
- **Assertions**: Vitest built-in (`expect`, `vi.fn()`, `vi.spyOn()`, `describe`, `it`, `beforeEach`, `afterEach`)
- **No external mocking libraries** — use Vitest's built-in `vi` utilities
- **Fake timers**: `vi.useFakeTimers()` / `vi.advanceTimersByTime()` for TTL tests
- **Async**: all tests use `async/await`

## Output Structure

All generated tests go into `tests/` with this structure:

```
tests/
├── conformance/           ← Adapter Conformance Suites (one file per port)
│   ├── cache.test.ts
│   ├── event-bus.test.ts
│   ├── locking.test.ts
│   ├── database.test.ts
│   ├── repository.test.ts
│   ├── workflow-engine.test.ts
│   ├── workflow-storage.test.ts
│   ├── job-scheduler.test.ts
│   ├── file.test.ts
│   ├── logger.test.ts
│   ├── auth.test.ts
│   ├── auth-module-service.test.ts
│   ├── auth-gateway.test.ts
│   ├── http.test.ts
│   ├── notification.test.ts
│   ├── translation.test.ts
│   ├── container.test.ts
│   ├── dml-generator.test.ts
│   └── message-aggregator.test.ts
├── integration/           ← Cross-port integration tests
│   ├── bootstrap.test.ts
│   ├── workflow-e2e.test.ts
│   ├── http-lifecycle.test.ts
│   ├── module-lifecycle.test.ts
│   ├── auth-propagation.test.ts
│   ├── query-external-timeout.test.ts
│   ├── link-treeshaking.test.ts
│   ├── entity-threshold.test.ts
│   ├── withdeleted-propagation.test.ts
│   └── boot-events.test.ts
├── strict-mode/           ← Strict mode behavior tests
│   └── strict-mode.test.ts
├── migration/             ← CLI db:* tests
│   └── migration.test.ts
└── plugin/                ← Plugin resolution tests
    └── plugin-resolution.test.ts
```

Additionally, create:
- `CLARIFICATIONS.md` — any ambiguities, decisions taken, or items needing human review
- `COVERAGE_REPORT.md` — traceability matrix: every SPEC → test(s) that cover it

## Workflow — 3 Phases

### Phase 1: WRITE (Agent: Test Writer)

For each test file in the plan:

1. Read the relevant SPECs from `FRAMEWORK_SPEC.md`
2. Read the corresponding conformance suite definition from `TEST_STRATEGY.md`
3. Write the complete test file following these rules:
   - Every test ID from TEST_STRATEGY.md (C-01, E-01, W-01, etc.) MUST have a corresponding `it()` block
   - Test names follow the convention: `[PortName] > [method] > [scenario]`
   - Use the `runXxxConformance()` pattern from TEST_STRATEGY.md section 1
   - Import types from `@manta/core` (assume they exist — we're writing tests before implementation)
   - Import helpers from `@manta/testing` (createTestContainer, withScope, spyOnEvents, etc.)
   - Every `describe` block includes `afterEach(() => resetAll(container))` or equivalent cleanup
   - Use `vi.useFakeTimers()` for any test involving TTL or timing
   - NEVER use `setTimeout` with real delays in unit tests
   - Each test must be self-contained (no dependency on execution order)
   - Tests must compile as valid TypeScript (even if imports don't resolve yet)

4. If a spec is **ambiguous or unclear**:
   - DO NOT BLOCK. Make a reasonable choice.
   - Document the choice in `CLARIFICATIONS.md` with:
     - Which SPEC is affected
     - What the ambiguity is
     - What choice was made and why
     - Tag it `[DECISION]` if you chose, `[NEEDS_HUMAN]` if truly unresolvable
   - Note: all previously known ambiguities have been resolved in the specs. CLARIFICATIONS.md starts empty — only add NEW discoveries.

### Phase 2: REVIEW (Agent: Test Reviewer)

For each test file produced by Phase 1:

1. **Coverage check**: Cross-reference every test ID in TEST_STRATEGY.md against the test file. Flag any missing test.
2. **Spec compliance**: For each `it()` block, verify the assertion matches the SPEC guarantee (not just "something passes").
3. **Edge cases**: Check that error paths are tested (not just happy paths).
4. **Isolation**: Verify no test leaks state to another (proper cleanup, no shared mutable state).
5. **Consistency**: Verify naming conventions, import paths, and patterns are consistent across files.
6. **Anti-patterns**: Flag any `any` type, any `// @ts-ignore`, any hardcoded timeout, any missing cleanup.

Output a review per file: `PASS` or `FAIL` with specific issues.

### Phase 3: FIX (Agent: Test Writer again)

For any file that got `FAIL` in Phase 2:
1. Fix every flagged issue
2. Re-submit for review
3. Loop until `PASS`

Maximum 3 loops per file. If still failing after 3 loops, document the remaining issues in `CLARIFICATIONS.md` as `[STUCK]`.

## Execution Order

Process test files in this order (simplest → most complex):

### Batch 1 — Simple ports (no cross-dependencies)
1. `conformance/cache.test.ts` (ICachePort — C-01 → C-09)
2. `conformance/logger.test.ts` (ILoggerPort — LG-01 → LG-08)
3. `conformance/locking.test.ts` (ILockingPort — L-01 → L-07)
4. `conformance/file.test.ts` (IFilePort — F-01 → F-08)

### Batch 2 — Auth chain
5. `conformance/auth.test.ts` (IAuthPort — A-01 → A-09)
6. `conformance/auth-module-service.test.ts` (IAuthModuleService Sessions — AS-01 → AS-05)
7. `conformance/auth-gateway.test.ts` (IAuthGateway — AG-01 → AG-14)

### Batch 3 — Data layer
8. `conformance/database.test.ts` (IDatabasePort — D-01 → D-14)
9. `conformance/repository.test.ts` (IRepository — R-01 → R-17)
10. `conformance/dml-generator.test.ts` (DML Generator — DG-01 → DG-23)

### Batch 4 — Event system
11. `conformance/message-aggregator.test.ts` (IMessageAggregator — MA-01 → MA-08)
12. `conformance/event-bus.test.ts` (IEventBusPort — E-01 → E-13)
13. `conformance/notification.test.ts` (INotificationPort — N-01 → N-07)

### Batch 5 — Workflow system
14. `conformance/workflow-storage.test.ts` (IWorkflowStoragePort — WS-01 → WS-11)
15. `conformance/workflow-engine.test.ts` (IWorkflowEnginePort — W-01 → W-21)
16. `conformance/job-scheduler.test.ts` (IJobSchedulerPort — J-01 → J-10)

### Batch 6 — HTTP + Container
17. `conformance/container.test.ts` (IContainer — CT-01 → CT-18)
18. `conformance/http.test.ts` (IHttpPort — H-01 → H-28)

### Batch 7 — Translation
19. `conformance/translation.test.ts` (ITranslationPort — T-01 → T-11)

### Batch 8 — Integration tests
20. `integration/bootstrap.test.ts`
21. `integration/workflow-e2e.test.ts`
22. `integration/http-lifecycle.test.ts`
23. `integration/module-lifecycle.test.ts`
24. `integration/auth-propagation.test.ts`
25. `integration/query-external-timeout.test.ts`
26. `integration/link-treeshaking.test.ts`
27. `integration/entity-threshold.test.ts`
28. `integration/withdeleted-propagation.test.ts`
29. `integration/boot-events.test.ts`

### Batch 9 — Special suites
30. `strict-mode/strict-mode.test.ts` (SM-01 → SM-06)
31. `migration/migration.test.ts` (M-01 → M-16)
32. `plugin/plugin-resolution.test.ts` (PL-01 → PL-03, CS-01)

## Key Conventions for Test Code

### Import Pattern

The `@manta/testing` package provides BOTH core types (port interfaces) AND test helpers.
All imports come from `@manta/testing` — there is no separate `@manta/core` package yet.

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Port interfaces (types) + MantaError + helpers — all from @manta/testing
import {
  // Types
  type ICachePort,
  type IEventBusPort,
  type IContainer,
  type ILockingPort,
  type ILoggerPort,
  type IAuthPort,
  type IAuthModuleService,
  type IAuthGateway,
  type IMessageAggregator,
  type IWorkflowEnginePort,
  type IWorkflowStoragePort,
  type IJobSchedulerPort,
  type IFilePort,
  type INotificationPort,
  type ITranslationPort,
  type IDatabasePort,
  type IRepository,
  type AuthContext,
  type AuthCredentials,
  type Message,
  type Context,
  type JobResult,
  type WorkflowLifecycleEvent,
  type GroupStatus,

  // Classes & functions
  MantaError,
  PermanentSubscriberError,
  permanentSubscriberFailure,

  // Test helpers
  createTestContainer,
  withScope,
  spyOnEvents,
  createTestAuth,
  createTestContext,
  createTestLogger,
  resetAll,
  assertNoScopeLeak,
  InMemoryWorkflowEngine,
  InMemoryWorkflowStorage,
  InMemoryEventBusAdapter,
  InMemoryCacheAdapter,
  InMemoryLockingAdapter,
  InMemoryMessageAggregator,
  InMemoryFileAdapter,
  InMemoryNotificationAdapter,
  InMemoryContainer,
  MockAuthPort,
  MockAuthModuleService,
  MockAuthGateway,
  TestLogger,
  createTestDb,
  createMigrationTestContext,
  generateDrizzleSchema,
  parseDmlEntity,
} from '@manta/testing'
```

**Rule**: NEVER import from `@manta/core` — everything is re-exported from `@manta/testing`.
The `@manta/testing/src/core-types.ts` file contains all port interfaces.
The `@manta/testing/src/index.ts` file contains all in-memory implementations and helpers.

### Conformance Suite Pattern

```typescript
// conformance/cache.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  type ICachePort,
  createTestContainer,
  resetAll,
  InMemoryContainer,
} from '@manta/testing'

describe('ICachePort Conformance', () => {
  let cache: ICachePort
  let container: InMemoryContainer

  beforeEach(() => {
    container = createTestContainer()
    cache = container.resolve<ICachePort>('ICachePort')
  })

  afterEach(async () => {
    await resetAll(container)
  })

  // C-01 — SPEC-064: basic set/get roundtrip
  it('set/get > roundtrip basique', async () => {
    await cache.set('key', 'value', 60)
    const result = await cache.get('key')
    expect(result).toBe('value')
  })

  // C-02 — SPEC-064: TTL expiration
  it('set/get > TTL respecté', async () => {
    vi.useFakeTimers()
    await cache.set('key', 'value', 1)
    vi.advanceTimersByTime(1100)
    const result = await cache.get('key')
    expect(result).toBeNull()
    vi.useRealTimers()
  })

  // ... etc
})
```

### Integration Test Pattern

```typescript
// integration/bootstrap.test.ts
import { describe, it, expect } from 'vitest'
import { createTestContainer, spyOnEvents } from '@manta/testing'
import type { IContainer, IEventBusPort } from '@manta/core'

describe('Bootstrap Integration', () => {
  it('event buffer released after lazy boot', async () => {
    // ... test code referencing SPEC-074
  })
})
```

### Traceability Comments

Every `it()` block MUST have a comment with the test ID and SPEC reference:

```typescript
// C-04 — SPEC-064: invalidate removes exact key only
it('invalidate > exact key removal', async () => { ... })

// W-15 — SPEC-020: grouped events not re-emitted for DONE steps after recovery
it('checkpoint > events non re-emitted for DONE steps', async () => { ... })
```

## Rules for CLARIFICATIONS.md

Format each entry as:

```markdown
### [DECISION] Rate limiting sliding window algorithm
- **SPEC**: SPEC-039b
- **Ambiguity**: The spec says "sliding window via ICachePort" but doesn't specify the algorithm
- **Decision**: Tests verify external behavior only (N requests pass, N+1 rejected). The algorithm is an adapter implementation detail.
- **Impact**: Tests H-22 to H-26 do NOT test boundary behavior between windows

### [NEEDS_HUMAN] Query.gql() removal — no error test
- **SPEC**: SPEC-011
- **Issue**: Spec says Query.gql() is "supprimé" but no test verifies calling it throws a clear error
- **Suggestion**: Add a test that `Query.gql()` throws `MantaError(NOT_ALLOWED)` or similar
```

## Rules for COVERAGE_REPORT.md

Format as a traceability matrix:

```markdown
| SPEC | Description | Test File | Test IDs | Status |
|------|-------------|-----------|----------|--------|
| SPEC-001 | Container DI | conformance/container.test.ts | CT-01→CT-18 | ✅ Covered |
| SPEC-034 | IEventBusPort | conformance/event-bus.test.ts | E-01→E-13 | ✅ Covered |
| SPEC-039b | Rate limiting | conformance/http.test.ts | H-22→H-26 | ✅ Covered |
| SPEC-011 | Query.gql removal | — | — | ⚠️ No test (see CLARIFICATIONS) |
```

Every SPEC from FRAMEWORK_SPEC.md must appear in this table. SPECs without tests must be flagged.

## Final Checklist

Before declaring the suite complete, verify:

- [ ] Every test ID in TEST_STRATEGY.md has a corresponding `it()` block
- [ ] Every SPEC in FRAMEWORK_SPEC.md is referenced by at least one test
- [ ] CLARIFICATIONS.md documents every ambiguity and decision
- [ ] COVERAGE_REPORT.md is complete with all SPECs
- [ ] No test uses `any` type
- [ ] No test has real `setTimeout` delays (use fake timers)
- [ ] Every test file has proper cleanup in `afterEach`
- [ ] All import paths are consistent
- [ ] Test names follow the naming convention
