// =============================================================================
// @manta/test-utils — Test helpers ONLY
// =============================================================================
//
// All adapter implementations live in @manta/core/adapters.
// This package re-exports them for backward compatibility and provides
// test-only helpers (createTestContainer, spyOnEvents, withScope, etc.).
//
// References: TEST_STRATEGY.md Section 4 (§4.1 → §4.10)
// =============================================================================

// Re-export everything from @manta/core so tests can import from @manta/test-utils
export {
  // Types & errors
  MantaError,
  PermanentSubscriberError,
  permanentSubscriberFailure,

  // Container
  MantaContainer,
  containerALS,
  withScope as coreWithScope,
  ContainerRegistrationKeys,

  // Events
  MessageAggregator,

  // Config
  defineConfig,
  ConfigManager,
  FlagRouter,

  // Adapters (re-exported from @manta/core)
  InMemoryCacheAdapter,
  InMemoryEventBusAdapter,
  InMemoryLockingAdapter,
  TestLogger,
  InMemoryFileAdapter,
  InMemoryNotificationAdapter,
  NoOpTranslationAdapter,
  InMemoryWorkflowStorage,
  InMemoryWorkflowEngine,
  InMemoryJobScheduler,
  InMemoryHttpAdapter,
  InMemoryRepository,
  InMemoryDatabaseAdapter,
  InMemoryTransaction,
  InMemoryContainer,
  InMemoryMessageAggregator,
  MockAuthPort,
  MockAuthModuleService,
  MockAuthGateway,

  // DML Generator
  parseDmlEntity,
  generateDrizzleSchema,
} from '@manta/core'

// Re-export types from @manta/core
export type {
  // Error types
  MantaErrorType,
  MantaErrorResponse,

  // Container types
  IContainer,
  ServiceLifetime,

  // Event types
  Message,
  IMessageAggregator,

  // Config types
  MantaConfig,
  ProjectConfig,
  EnvProfile,

  // Port interfaces
  ICachePort,
  IEventBusPort,
  ILockingPort,
  IDatabasePort,
  IRepository,
  IWorkflowEnginePort,
  IWorkflowStoragePort,
  IFilePort,
  ILoggerPort,
  IJobSchedulerPort,
  INotificationPort,
  ISearchProvider,
  IAnalyticsProvider,
  ITranslationPort,
  IHttpPort,
  IAuthPort,
  IAuthModuleService,
  IAuthGateway,
  Context,
  JobResult,
  JobExecution,
  WorkflowLifecycleEvent,
  TransactionOptions,
  DatabaseConfig,
  CursorPagination,
  GroupStatus,
  AuthContext,
  AuthCredentials,
  SessionOptions,

  // Adapter types
  LogEntry,
  TestAuthConfig,

  // DML types
  GeneratedSchema,
  ParsedDmlEntity,
} from '@manta/core'

// =============================================================================
// §4.1 — createTestContainer
// =============================================================================

import type {
  IContainer,
  ICachePort,
  IEventBusPort,
  ILockingPort,
  ILoggerPort,
  IAuthPort,
  IAuthModuleService,
  IAuthGateway,
  IMessageAggregator,
  IWorkflowStoragePort,
  IFilePort,
  INotificationPort,
  ITranslationPort,
  IHttpPort,
  IRepository,
  Message,
  Context,
} from '@manta/core'

import {
  InMemoryContainer,
  InMemoryCacheAdapter,
  InMemoryEventBusAdapter,
  InMemoryLockingAdapter,
  TestLogger,
  MockAuthPort,
  MockAuthModuleService,
  MockAuthGateway,
  InMemoryMessageAggregator,
  InMemoryWorkflowStorage,
  InMemoryWorkflowEngine,
  InMemoryFileAdapter,
  InMemoryNotificationAdapter,
  NoOpTranslationAdapter,
  InMemoryHttpAdapter,
  InMemoryRepository,
  InMemoryJobScheduler,
} from '@manta/core'

interface TestContainerOptions {
  overrides?: Partial<Record<string, unknown>>
}

/**
 * Creates a fully wired container with in-memory adapters for all ports.
 * Override specific adapters via `overrides`.
 */
export function createTestContainer(options?: TestContainerOptions): InMemoryContainer {
  const container = new InMemoryContainer()

  // Register all default in-memory adapters
  container.register('ICachePort', new InMemoryCacheAdapter(), 'SINGLETON')
  container.register('IEventBusPort', new InMemoryEventBusAdapter(), 'SINGLETON')
  container.register('ILockingPort', new InMemoryLockingAdapter(), 'SINGLETON')
  container.register('ILoggerPort', new TestLogger(), 'SINGLETON')
  container.register('IAuthPort', new MockAuthPort(), 'SINGLETON')
  container.register('IAuthModuleService', new MockAuthModuleService(), 'SINGLETON')
  container.register('IAuthGateway', new MockAuthGateway(
    container.resolve<IAuthPort>('IAuthPort'),
    container.resolve<IAuthModuleService>('IAuthModuleService'),
  ), 'SINGLETON')
  container.register('IMessageAggregator', InMemoryMessageAggregator, 'SCOPED')
  container.register('IWorkflowStoragePort', new InMemoryWorkflowStorage(), 'SINGLETON')
  container.register('IWorkflowEnginePort', new InMemoryWorkflowEngine(), 'SINGLETON')
  container.register('IFilePort', new InMemoryFileAdapter(), 'SINGLETON')
  container.register('INotificationPort', new InMemoryNotificationAdapter(), 'SINGLETON')
  container.register('ITranslationPort', new NoOpTranslationAdapter(), 'SINGLETON')
  container.register('IHttpPort', new InMemoryHttpAdapter(), 'SINGLETON')
  container.register('IRepository', new InMemoryRepository(), 'SINGLETON')
  container.register('IJobSchedulerPort', new InMemoryJobScheduler(
    container.resolve('ILockingPort'),
    container.resolve('ILoggerPort'),
    container.resolve('IWorkflowStoragePort'),
  ), 'SINGLETON')

  // Apply overrides
  if (options?.overrides) {
    for (const [key, value] of Object.entries(options.overrides)) {
      if (value !== undefined) {
        container.register(key, value, 'SINGLETON')
      }
    }
  }

  return container
}

// =============================================================================
// §4.2 — withScope
// =============================================================================

/**
 * Executes `fn` inside a scoped container backed by AsyncLocalStorage.
 * SCOPED services are resolvable within the callback.
 */
export async function withScope<T>(
  container: InMemoryContainer,
  fn: (scopedContainer: InMemoryContainer) => Promise<T> | T,
): Promise<T> {
  const scope = container.createScope() as InMemoryContainer
  return container._runInScope(scope, () => fn(scope))
}

// =============================================================================
// §4.3 — createTestLogger
// =============================================================================

/**
 * Silent logger that captures all output for assertions.
 */
export function createTestLogger(): TestLogger {
  return new TestLogger()
}

// =============================================================================
// §4.4 — createTestAuth
// =============================================================================

import type { TestAuthConfig } from '@manta/core'

interface TestAuthResult {
  authPort: MockAuthPort
  authModuleService: MockAuthModuleService
  authGateway: MockAuthGateway
}

/**
 * Mock IAuthPort + IAuthModuleService with configurable responses.
 */
export function createTestAuth(config?: TestAuthConfig): TestAuthResult {
  const authPort = new MockAuthPort(config)
  const authModuleService = new MockAuthModuleService(config)
  const authGateway = new MockAuthGateway(authPort, authModuleService)
  return { authPort, authModuleService, authGateway }
}

// =============================================================================
// §4.5 — resetAll
// =============================================================================

/**
 * Resets all in-memory adapters in the container.
 * Call in `afterEach` for isolation between tests.
 */
export async function resetAll(container: InMemoryContainer): Promise<void> {
  const resettables = [
    'ICachePort', 'IEventBusPort', 'ILoggerPort', 'IWorkflowStoragePort',
    'IWorkflowEnginePort', 'IFilePort', 'INotificationPort', 'IJobSchedulerPort',
    'IAuthModuleService', 'IHttpPort', 'IRepository',
  ]

  for (const key of resettables) {
    try {
      const svc = container.resolve<Record<string, unknown>>(key)
      if (svc && typeof svc._reset === 'function') {
        (svc._reset as () => void)()
      } else if (svc && typeof svc.clear === 'function') {
        await (svc.clear as () => Promise<void>)()
      }
    } catch {
      // Service not registered — skip
    }
  }
}

// =============================================================================
// §4.6 — createTestDb
// =============================================================================

import { MantaError, InMemoryTransaction, generateDrizzleSchema, parseDmlEntity } from '@manta/core'
import type { GeneratedSchema } from '@manta/core'

export interface TestDb {
  withRollback<T>(fn: (tx: unknown) => Promise<T>): Promise<T>
  cleanup(): Promise<void>
}

/**
 * Creates an in-memory test database with rollback-per-test isolation.
 */
export async function createTestDb(_options?: {
  schema?: unknown[]
}): Promise<TestDb> {
  const tables = new Map<string, Map<string, Record<string, unknown>>>()
  const schema = new Map<string, { notNull: Set<string> }>()
  let disposed = false

  return {
    async withRollback(fn) {
      if (disposed) {
        throw new MantaError('INVALID_STATE', 'Database has been disposed')
      }
      const snapshot = new Map<string, Map<string, Record<string, unknown>>>()
      for (const [name, rows] of tables) {
        const rowsCopy = new Map<string, Record<string, unknown>>()
        for (const [id, row] of rows) {
          rowsCopy.set(id, { ...row })
        }
        snapshot.set(name, rowsCopy)
      }
      const schemaCopy = new Map(schema)
      const tx = new InMemoryTransaction(snapshot, schemaCopy)
      return fn(tx)
    },
    async cleanup() {
      disposed = true
      tables.clear()
      schema.clear()
    },
  }
}

// =============================================================================
// §4.7 — spyOnEvents
// =============================================================================

export interface EventSpy {
  received(eventName: string): boolean
  payloads(eventName: string): Message[]
  count(eventName: string): number
  all(): Array<{ name: string; payload: Message; timestamp: number }>
  reset(): void
}

/**
 * Intercepts all events emitted via IEventBusPort for assertion.
 * Non-intrusive — real subscribers still receive events.
 */
export function spyOnEvents(container: InMemoryContainer): EventSpy {
  const captured: Array<{ name: string; payload: Message; timestamp: number }> = []
  const bus = container.resolve<InMemoryEventBusAdapter>('IEventBusPort')

  const interceptor = (message: Message) => {
    captured.push({ name: message.eventName, payload: message, timestamp: Date.now() })
  }

  bus.addInterceptor(interceptor)

  return {
    received(eventName: string) {
      return captured.some((e) => e.name === eventName)
    },
    payloads(eventName: string) {
      return captured.filter((e) => e.name === eventName).map((e) => e.payload)
    },
    count(eventName: string) {
      return captured.filter((e) => e.name === eventName).length
    },
    all() {
      return [...captured]
    },
    reset() {
      captured.length = 0
    },
  }
}

// =============================================================================
// §4.8 — createTestContext
// =============================================================================

/**
 * Creates a minimal valid Context (SPEC-060) for testing.
 */
export function createTestContext(overrides?: Partial<Context>): Context {
  return {
    transactionManager: undefined,
    manager: undefined,
    isolationLevel: 'READ COMMITTED',
    enableNestedTransactions: false,
    eventGroupId: undefined,
    transactionId: undefined,
    requestId: crypto.randomUUID(),
    messageAggregator: new InMemoryMessageAggregator(),
    idempotencyKey: crypto.randomUUID(),
    isCancelling: false,
    auth_context: undefined,
    ...overrides,
  }
}

// =============================================================================
// §4.9 — assertNoScopeLeak
// =============================================================================

/**
 * Verifies that creating N scopes does not cause memory to grow linearly.
 */
export async function assertNoScopeLeak(
  container: InMemoryContainer,
  iterations: number = 1000,
): Promise<void> {
  // Warm up — create 10 scopes to establish baseline
  for (let i = 0; i < 10; i++) {
    await withScope(container, async (scope) => {
      scope.resolve<IMessageAggregator>('IMessageAggregator')
    })
  }

  if (typeof globalThis.gc === 'function') globalThis.gc()
  const baselineHeap = process.memoryUsage().heapUsed

  // Create N scopes
  for (let i = 0; i < iterations; i++) {
    await withScope(container, async (scope) => {
      scope.resolve<IMessageAggregator>('IMessageAggregator')
    })
  }

  if (typeof globalThis.gc === 'function') globalThis.gc()
  const finalHeap = process.memoryUsage().heapUsed

  const growth = finalHeap - baselineHeap
  const tolerance = baselineHeap * 0.20

  if (growth > tolerance) {
    throw new Error(
      `Potential scope leak: heap grew by ${(growth / 1024).toFixed(0)}KB after ${iterations} scopes ` +
      `(baseline: ${(baselineHeap / 1024).toFixed(0)}KB, tolerance: ${(tolerance / 1024).toFixed(0)}KB)`
    )
  }
}

// =============================================================================
// Migration test helpers (§9.3)
// =============================================================================

export interface MigrationTestContext {
  defineDml(entities: unknown[]): void
  generate(): Promise<{ sql: string }>
  migrate(): Promise<void>
  diff(): Promise<{ differences: Array<{ table: string; column?: string; action: string; warning?: string }> }>
  rollback(): Promise<void>
  cleanup(): Promise<void>
}

/**
 * Stub for migration testing context. Requires PG local.
 */
export async function createMigrationTestContext(
  _options?: Record<string, unknown>,
): Promise<MigrationTestContext> {
  let entities: Array<Record<string, unknown>> = []
  let generatedSchemas: GeneratedSchema[] = []
  let migratedSchemas: GeneratedSchema[] = []
  let generatedSql = ''

  return {
    defineDml(dmlEntities: Array<Record<string, unknown>>) {
      entities = dmlEntities
      generatedSchemas = entities.map((e) => generateDrizzleSchema(parseDmlEntity(e)))
    },

    async generate() {
      const sqlParts: string[] = []
      for (let i = 0; i < entities.length; i++) {
        const entity = entities[i]
        const schema = generatedSchemas[i]
        const tableName = (entity.name as string).toLowerCase() + 's'
        const cols = Object.entries(schema.columns)
          .map(([name, col]) => `  "${name}" ${col.type}${col.notNull ? ' NOT NULL' : ''}`)
          .join(',\n')
        sqlParts.push(`CREATE TABLE IF NOT EXISTS "${tableName}" (\n${cols}\n);`)
        for (const idx of schema.indexes) {
          const using = idx.using ? ` USING ${idx.using}` : ''
          const where = idx.where ? ` WHERE ${idx.where}` : ''
          sqlParts.push(`CREATE INDEX "${idx.name}" ON "${tableName}"${using} (${idx.columns.map((c) => `"${c}"`).join(', ')})${where};`)
        }
      }
      generatedSql = sqlParts.join('\n\n')
      return { sql: generatedSql }
    },

    async migrate() {
      migratedSchemas = generatedSchemas.map((s) => ({
        columns: { ...s.columns },
        relations: { ...s.relations },
        indexes: [...s.indexes],
        checks: [...s.checks],
      }))
    },

    async diff() {
      type Difference = { table?: string; column?: string; action: string; warning?: string }
      const differences: Difference[] = []
      for (let i = 0; i < entities.length; i++) {
        const entity = entities[i]
        const tableName = (entity.name as string).toLowerCase() + 's'
        const expected = generatedSchemas[i]
        if (i >= migratedSchemas.length) {
          for (const colName of Object.keys(expected.columns)) {
            differences.push({ table: tableName, column: colName, action: 'CREATE' })
          }
          continue
        }
        const migrated = migratedSchemas[i]
        for (const [colName, colDef] of Object.entries(expected.columns)) {
          if (!migrated.columns[colName]) {
            differences.push({ table: tableName, column: colName, action: 'CREATE' })
          } else if (migrated.columns[colName].type !== colDef.type) {
            differences.push({ table: tableName, column: colName, action: 'ALTER', warning: `unsafe type change from ${migrated.columns[colName].type} to ${colDef.type}` })
          }
        }
      }
      return { differences }
    },

    async rollback() {
      if (migratedSchemas.length === 0 && generatedSql === '') {
        throw new MantaError('NOT_FOUND', 'No rollback file found')
      }
      migratedSchemas = []
    },

    async cleanup() {
      entities = []; generatedSchemas = []; migratedSchemas = []; generatedSql = ''
    },
  }
}
