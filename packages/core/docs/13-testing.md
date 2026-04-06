# Testing

## Philosophy

The framework provides `@manta/test-utils` with in-memory adapters, spies, and helpers so tests run fast (no database, no network) and are deterministic.

**Types of tests:**

| Type | What it tests | Speed | Database |
|------|--------------|-------|----------|
| Unit | Models, services, validators | <1ms | No |
| Integration | Commands, workflows, compensation | <100ms | No (in-memory) |
| E2E | Full HTTP flow (command → event → subscriber) | <500ms | Optional |

## Project structure

Tests live in a `tests/` folder at the root of your project (outside `src/`):

```
my-project/
├── src/
│   ├── modules/
│   ├── commands/
│   ├── queries/
│   └── ...
├── tests/
│   ├── unit/
│   │   ├── product.test.ts        # Service CRUD + custom methods
│   │   ├── inventory.test.ts
│   │   └── commands.test.ts       # Command validation
│   ├── integration/
│   │   ├── create-product.test.ts # Full workflow with compensation
│   │   └── auth.test.ts           # Login/logout flow
│   └── e2e/
│       └── api.test.ts            # HTTP endpoint testing
├── manta.config.ts
└── package.json
```

Why outside `src/`? The framework scans `src/` for modules, commands, queries, etc. Test files in `src/` could be picked up accidentally.

## Setup

```typescript
import {
  createTestMantaApp,
  InMemoryCacheAdapter,
  InMemoryEventBusAdapter,
  InMemoryFileAdapter,
  InMemoryLockingAdapter,
  InMemoryRepository,
  TestLogger,
} from '@manta/test-utils'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'

function makeTestInfra() {
  return {
    eventBus: new InMemoryEventBusAdapter(),
    logger: new TestLogger(),
    cache: new InMemoryCacheAdapter(),
    locking: new InMemoryLockingAdapter(),
    file: new InMemoryFileAdapter(),
  }
}

describe('My tests', () => {
  let app: TestMantaApp

  beforeEach(() => {
    app = createTestMantaApp({ infra: makeTestInfra() })
  })

  afterEach(async () => {
    await app.dispose()
  })
})
```

## Testing a service

```typescript
import { InMemoryRepository, instantiateServiceDescriptor } from '@manta/test-utils'
import productService from '../src/modules/catalog/entities/product/service'
import productModel from '../src/modules/catalog/entities/product/model'

describe('Product service', () => {
  let repo: InMemoryRepository
  let service: Record<string, Function>

  beforeEach(() => {
    repo = new InMemoryRepository('product')
    service = instantiateServiceDescriptor(productService, repo, undefined, new TestLogger())
  })

  it('createProducts creates a product', async () => {
    const product = await service.createProducts({
      title: 'Widget', sku: 'W-001', price: 999, status: 'draft',
    })
    expect(product.title).toBe('Widget')
    expect(product.id).toBeDefined()
  })

  it('activate changes status', async () => {
    const product = await service.createProducts({
      title: 'Widget', sku: 'W-001', price: 999, status: 'draft',
    })
    await service.activate(product.id)
    const updated = await repo.find({ where: { id: product.id } })
    expect(updated[0].status).toBe('active')
  })

  it('listProducts returns all products', async () => {
    await service.createProducts({ title: 'A', sku: 'A-001', price: 10, status: 'draft' })
    await service.createProducts({ title: 'B', sku: 'B-001', price: 20, status: 'active' })
    const list = await service.listProducts()
    expect(list).toHaveLength(2)
  })
})
```

Service methods are auto-compensated via repository snapshots. No manual `__compensate` needed.

## Testing a command

```typescript
describe('create-product command', () => {
  it('validates input with Zod', () => {
    const cmd = defineCommand({
      name: 'create-product',
      description: 'Create a product',
      input: z.object({
        title: z.string().min(1),
        sku: z.string(),
        price: z.number().min(0),
      }),
      workflow: async (input, { step }) => {
        return await step.service.catalog.create(input)
      },
    })

    // Valid input
    expect(cmd.input.safeParse({ title: 'Widget', sku: 'W-001', price: 99 }).success).toBe(true)

    // Invalid input
    expect(cmd.input.safeParse({ title: '', price: -1 }).success).toBe(false)
  })
})
```

## Testing a subscriber

Subscribers receive `(event, { command, log })`. Test them by calling the handler directly:

```typescript
import productCreated from '../src/subscribers/product-created'

describe('product-created subscriber', () => {
  it('dispatches a command', async () => {
    let commandCalled = false
    const mockCommand = {
      initializeInventory: async (input: unknown) => { commandCalled = true },
    }
    const mockLog = { info: () => {}, warn: () => {}, error: () => {} }

    const event = {
      eventName: 'product.created',
      data: { id: 'prod_1', sku: 'W-001' },
      metadata: { timestamp: Date.now() },
    }

    await productCreated.handler(event, { command: mockCommand, log: mockLog })
    expect(commandCalled).toBe(true)
  })
})
```

## Testing a job

Jobs also receive `{ command, log }`:

```typescript
import cleanupJob from '../src/jobs/cleanup-drafts'

describe('cleanup-drafts job', () => {
  it('dispatches cleanup command', async () => {
    let cleanupInput: unknown = null
    const mockCommand = {
      cleanupDraftProducts: async (input: unknown) => { cleanupInput = input },
    }
    const mockLog = { info: () => {} }

    await cleanupJob.handler({ command: mockCommand, log: mockLog })
    expect(cleanupInput).toEqual({ olderThanDays: 30 })
  })
})
```

## Testing events with spies

```typescript
describe('Event emission', () => {
  let bus: InMemoryEventBusAdapter

  beforeEach(() => {
    bus = new InMemoryEventBusAdapter()
  })

  it('product.created event is emitted', async () => {
    const received: Message[] = []
    bus.subscribe('product.created', (event) => { received.push(event) })

    await bus.emit({
      eventName: 'product.created',
      data: { id: 'prod_1', sku: 'W-001' },
      metadata: { timestamp: Date.now() },
    })

    expect(received).toHaveLength(1)
    expect(received[0].data).toEqual({ id: 'prod_1', sku: 'W-001' })
  })

  it('grouped events are buffered until release', async () => {
    const received: Message[] = []
    bus.subscribe('order.placed', (event) => { received.push(event) })

    await bus.emit(
      { eventName: 'order.placed', data: { id: 'ord_1' }, metadata: { timestamp: Date.now() } },
      { groupId: 'workflow-1' },
    )

    expect(received).toHaveLength(0) // Buffered

    await bus.releaseGroupedEvents('workflow-1')
    expect(received).toHaveLength(1) // Released
  })
})
```

## Testing queries

```typescript
import { QueryService } from '@manta/test-utils'

describe('list-products query', () => {
  it('returns products via graph', async () => {
    const queryService = new QueryService()
    queryService.registerResolver('product', async (config) => {
      return [
        { id: '1', title: 'Widget', status: 'active' },
        { id: '2', title: 'Gadget', status: 'draft' },
      ].filter((p) => !config.filters?.status || p.status === config.filters.status)
    })

    const result = await queryService.graph({
      entity: 'product',
      filters: { status: 'active' },
    })

    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Widget')
  })
})
```

## Testing with database (integration)

For tests that need a real PostgreSQL database:

```typescript
import { createTestDatabase, waitForPg } from '@manta/test-utils/pg'

describe('Database integration', () => {
  let dbUrl: string
  let cleanup: () => Promise<void>

  beforeAll(async () => {
    await waitForPg(30)
    const result = await createTestDatabase('test_catalog')
    dbUrl = result.url
    cleanup = result.cleanup
  })

  afterAll(async () => {
    await cleanup()
  })

  it('creates and queries products', async () => {
    // Use dbUrl to connect a real DrizzlePgAdapter
  })
})
```

Name integration test files with `.integration.test.ts` — they are excluded from `pnpm test` and run separately via `pnpm test:integration`.

## Test utilities reference

| Utility | Purpose |
|---------|---------|
| `createTestMantaApp(options)` | Create test app with in-memory adapters |
| `InMemoryRepository(name)` | In-memory data store |
| `InMemoryEventBusAdapter()` | Event pub/sub with grouped events |
| `InMemoryCacheAdapter()` | Key-value cache with TTL |
| `InMemoryLockingAdapter()` | Distributed lock simulation |
| `InMemoryFileAdapter()` | File storage simulation |
| `InMemoryJobScheduler()` | Cron job simulation |
| `TestLogger()` | Logger that captures output |
| `MockAuthPort()` | Mock JWT/API key verification |
| `MockAuthModuleService()` | Mock auth with session management |
| `MessageAggregator()` | Capture events emitted by services |
| `instantiateServiceDescriptor()` | Create service instance from defineService result |
| `QueryService()` | Test query handlers with mock resolvers |
| `WorkflowManager(app)` | Execute workflows in tests |
| `createTestDatabase(name)` | Isolated PostgreSQL DB per test file |
| `resetAll(app)` | Reset all in-memory state between tests |
| `spyOnEvents(app)` | Intercept events for assertions |

## Running tests

```bash
# Unit + integration tests (fast, no DB)
pnpm test

# Integration tests only (needs PostgreSQL)
pnpm test:integration

# Specific file
npx vitest run tests/unit/product.test.ts

# Watch mode
npx vitest tests/unit/product.test.ts
```

## AI guidance: writing tests

When generating tests:

1. **Start with CRUD** — Test all auto-generated methods first (createX, listX, retrieveX, updateX, deleteX)
2. **Test custom methods** — Each method defined in defineService
3. **Test validation** — Invalid inputs via Zod safeParse
4. **Test events** — Verify CRUD operations emit `entity.created`, `entity.updated`, `entity.deleted`
5. **Test subscribers** — Call handler directly with mock `{ command, log }`
6. **Test jobs** — Call handler directly with mock `{ command, log }`
7. **Use in-memory adapters** — No database needed for unit tests
8. **Isolate tests** — `beforeEach` creates fresh state, `afterEach` disposes. No shared state.
9. **Name clearly** — `it('createProducts creates a product with valid data')`
