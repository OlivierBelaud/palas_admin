// =============================================================================
// @manta/test-utils — Test helpers ONLY
// =============================================================================
//
// All adapter implementations live in @manta/core/adapters.
// This package re-exports them for backward compatibility and provides
// test-only helpers (createTestApp, spyOnEvents, resetAll, etc.).
//
// References: TEST_STRATEGY.md Section 4 (§4.1 → §4.12)
// =============================================================================

// Re-export types from @manta/core
export type {
  AuthContext,
  AuthCredentials,
  Context,
  CursorPagination,
  DatabaseConfig,
  EnvProfile,
  // DML types
  GeneratedSchema,
  GroupStatus,
  IAnalyticsProvider,
  IAuthGateway,
  IAuthModuleService,
  IAuthPort,
  // Port interfaces
  ICachePort,
  IDatabasePort,
  IEventBusPort,
  IFilePort,
  IHttpPort,
  IJobSchedulerPort,
  ILockingPort,
  ILoggerPort,
  IMessageAggregator,
  INotificationPort,
  IRepository,
  IRepositoryFactory,
  ISchemaGenerator,
  ISearchProvider,
  JobExecution,
  JobResult,
  // Adapter types
  LogEntry,
  // App types
  MantaApp,
  // Config types
  MantaConfig,
  MantaErrorResponse,
  // Error types
  MantaErrorType,
  // Event types
  Message,
  ParsedDmlEntity,
  ParsedDmlIndex,
  ParsedDmlProperty,
  ParsedDmlRelation,
  PresetAdapterEntry,
  PresetDefinition,
  ProjectConfig,
  RequestContext,
  SessionOptions,
  TestAuthConfig,
  TransactionOptions,
  WorkflowLifecycleEvent,
} from '@manta/core'
// Re-export everything from @manta/core so tests can import from @manta/test-utils
export {
  ConfigManager,
  ContainerRegistrationKeys,
  // App
  createApp,
  // Config
  defineConfig,
  FlagRouter,
  generateDrizzleSchema,
  // Adapters (re-exported from @manta/core)
  InMemoryCacheAdapter,
  InMemoryDatabaseAdapter,
  InMemoryEventBusAdapter,
  InMemoryFileAdapter,
  InMemoryHttpAdapter,
  InMemoryJobScheduler,
  InMemoryLockingAdapter,
  InMemoryNotificationAdapter,
  InMemoryRepository,
  InMemoryRepositoryFactory,
  InMemoryTransaction,
  // Types & errors
  MantaError,
  // Events
  MessageAggregator,
  MockAuthGateway,
  MockAuthModuleService,
  MockAuthPort,
  // Subscriber utilities
  makeIdempotent,
  PermanentSubscriberError,
  // DML Generator
  parseDmlEntity,
  permanentSubscriberFailure,
  // Request context
  runInRequestContext,
  TestLogger,
} from '@manta/core'

// =============================================================================
// §4.1 — createTestApp
// =============================================================================

import type { Context, MantaApp, Message, RequestContext, TestAuthConfig } from '@manta/core'

import {
  createApp,
  InMemoryCacheAdapter,
  InMemoryEventBusAdapter,
  InMemoryFileAdapter,
  InMemoryLockingAdapter,
  MantaError,
  MessageAggregator,
  MockAuthGateway,
  MockAuthModuleService,
  MockAuthPort,
  runInRequestContext,
  TestLogger,
} from '@manta/core'

interface TestAppOptions {
  overrides?: Partial<Record<string, unknown>>
}

/**
 * Creates a MantaApp with all in-memory adapters for testing.
 */
export function createTestApp(options?: TestAppOptions): MantaApp<Record<string, unknown>> {
  const eventBus = new InMemoryEventBusAdapter()
  const logger = new TestLogger()
  const cache = new InMemoryCacheAdapter()
  const locking = new InMemoryLockingAdapter()
  const file = new InMemoryFileAdapter()

  const builder = createApp({
    infra: { eventBus, logger, cache, locking, file, db: {} },
  })

  // Register overrides as modules if provided
  if (options?.overrides) {
    for (const [key, value] of Object.entries(options.overrides)) {
      if (value !== undefined) builder.registerModule(key, value)
    }
  }

  return builder.build()
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
// §4.5 — resetAll (accepts MantaApp)
// =============================================================================

/**
 * Resets all in-memory adapters in the app.
 * Call in `afterEach` for isolation between tests.
 */
export async function resetAll(app: MantaApp): Promise<void> {
  const resettables = [
    'ICachePort',
    'IEventBusPort',
    'ILoggerPort',
    'IFilePort',
    'INotificationPort',
    'IJobSchedulerPort',
    'IAuthModuleService',
    'IHttpPort',
    'IRepository',
  ]

  for (const key of resettables) {
    try {
      const svc = app.resolve<Record<string, unknown>>(key)
      if (svc && typeof svc._reset === 'function') {
        ;(svc._reset as () => void)()
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

import type { GeneratedSchema } from '@manta/core'
import { generateDrizzleSchema, InMemoryTransaction, parseDmlEntity } from '@manta/core'

export interface TestDb {
  withRollback<T>(fn: (tx: unknown) => Promise<T>): Promise<T>
  cleanup(): Promise<void>
}

/**
 * Creates an in-memory test database with rollback-per-test isolation.
 */
export async function createTestDb(_options?: { schema?: unknown[] }): Promise<TestDb> {
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
// §4.7 — spyOnEvents (accepts MantaApp)
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
export function spyOnEvents(app: MantaApp): EventSpy {
  const captured: Array<{ name: string; payload: Message; timestamp: number }> = []
  const bus = app.resolve<InMemoryEventBusAdapter>('IEventBusPort')

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
    messageAggregator: new MessageAggregator(),
    idempotencyKey: crypto.randomUUID(),
    isCancelling: false,
    auth_context: undefined,
    ...overrides,
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
export async function createMigrationTestContext(_options?: Record<string, unknown>): Promise<MigrationTestContext> {
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
        const tableName = `${(entity.name as string).toLowerCase()}s`
        const cols = Object.entries(schema.columns)
          .map(([name, col]) => `  "${name}" ${col.type}${col.notNull ? ' NOT NULL' : ''}`)
          .join(',\n')
        sqlParts.push(`CREATE TABLE IF NOT EXISTS "${tableName}" (\n${cols}\n);`)
        for (const idx of schema.indexes) {
          const using = idx.using ? ` USING ${idx.using}` : ''
          const where = idx.where ? ` WHERE ${idx.where}` : ''
          sqlParts.push(
            `CREATE INDEX "${idx.name}" ON "${tableName}"${using} (${idx.columns.map((c) => `"${c}"`).join(', ')})${where};`,
          )
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
      type Difference = { table: string; column?: string; action: string; warning?: string }
      const differences: Difference[] = []
      for (let i = 0; i < entities.length; i++) {
        const entity = entities[i]
        const tableName = `${(entity.name as string).toLowerCase()}s`
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
            differences.push({
              table: tableName,
              column: colName,
              action: 'ALTER',
              warning: `unsafe type change from ${migrated.columns[colName].type} to ${colDef.type}`,
            })
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
      entities = []
      generatedSchemas = []
      migratedSchemas = []
      generatedSql = ''
    },
  }
}

// =============================================================================
// §4.9 — assertNoScopeLeak (CT-16)
// =============================================================================

export interface ScopeLeakChecker {
  /** Track an object (scope, context) that should be GC'd after the test */
  track(scope: object): void
  /** Verify all tracked objects were garbage collected */
  verify(): Promise<void>
}

/**
 * Asserts that no scope references are leaked after a test.
 * Tracks WeakRef to scope/context objects and verifies they are GC'd.
 *
 * Requires Node with --expose-gc flag for reliable results.
 * Without GC access, verify() is a no-op (no false positives).
 *
 * @example
 * const leak = assertNoScopeLeak(app)
 * const ctx = createTestContext()
 * leak.track(ctx)
 * // ... test code that should release ctx ...
 * await leak.verify()
 */
export function assertNoScopeLeak(_app: MantaApp): ScopeLeakChecker {
  const scopeRefs: WeakRef<object>[] = []

  return {
    track(scope: object) {
      scopeRefs.push(new WeakRef(scope))
    },
    async verify() {
      // Without --expose-gc, we cannot force GC — skip to avoid false positives
      if (!globalThis.gc) return

      globalThis.gc()
      // Give GC a tick to finalize
      await new Promise((r) => setTimeout(r, 50))
      globalThis.gc()

      const leaked = scopeRefs.filter((ref) => ref.deref() !== undefined)
      if (leaked.length > 0) {
        throw new MantaError('INVALID_STATE', `Scope leak detected: ${leaked.length} scope(s) not garbage collected`)
      }
    },
  }
}

// =============================================================================
// §4.10 — withScope
// =============================================================================

/**
 * Creates a scoped execution context using AsyncLocalStorage.
 * Useful for testing SCOPED services that require an active request context.
 *
 * Wraps the callback in runInRequestContext from @manta/core so that
 * getRequestContext() returns a valid RequestContext inside the callback.
 *
 * @example
 * await withScope(app, async (scope) => {
 *   // getRequestContext() returns { requestId: scope.requestId }
 *   const svc = app.modules.stats
 *   await svc.increment('counter')
 * })
 */
export async function withScope<T>(_app: MantaApp, fn: (scope: RequestContext) => Promise<T>): Promise<T> {
  const ctx: RequestContext = {
    requestId: crypto.randomUUID(),
  }
  return runInRequestContext(ctx, () => fn(ctx))
}

// =============================================================================
// §4.11 — validateSerializability (WS-08/WS-09/WS-10)
// =============================================================================

/**
 * Validates that a value can be safely serialized for workflow checkpoints.
 * Throws MantaError if the value contains BigInt, Map, Set, Buffer, or Function.
 *
 * @example
 * validateSerializability({ count: 42, name: 'ok' }) // passes
 * validateSerializability({ m: new Map() })           // throws
 */
export function validateSerializability(value: unknown, path = ''): void {
  if (value === null || value === undefined) return

  if (typeof value === 'bigint') {
    throw new MantaError('INVALID_DATA', `Non-serializable value at ${path || 'root'}: BigInt`)
  }
  if (value instanceof Map) {
    throw new MantaError('INVALID_DATA', `Non-serializable value at ${path || 'root'}: Map`)
  }
  if (value instanceof Set) {
    throw new MantaError('INVALID_DATA', `Non-serializable value at ${path || 'root'}: Set`)
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    throw new MantaError('INVALID_DATA', `Non-serializable value at ${path || 'root'}: Buffer`)
  }
  if (typeof value === 'function') {
    throw new MantaError('INVALID_DATA', `Non-serializable value at ${path || 'root'}: Function`)
  }
  if (value instanceof Date) {
    // Dates are JSON-serializable (toJSON → ISO string)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      validateSerializability(item, `${path}[${i}]`)
    })
    return
  }
  if (typeof value === 'object') {
    for (const [key, val] of Object.entries(value)) {
      validateSerializability(val, path ? `${path}.${key}` : key)
    }
  }
}

// =============================================================================
// §4.12 — deriveWorkflowTransactionId & mapExternalError
// =============================================================================

// Re-export from core-types (standalone contract definitions)
export { deriveWorkflowTransactionId, mapExternalError } from './core-types'
