// @manta/core — Port interfaces and framework types
// This file defines the contracts. Adapters implement them. Tests assert against them.

// =============================================================================
// Common Types
// =============================================================================

export type MantaErrorType =
  | 'NOT_FOUND'
  | 'INVALID_DATA'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'DUPLICATE_ERROR'
  | 'CONFLICT'
  | 'NOT_ALLOWED'
  | 'UNEXPECTED_STATE'
  | 'DB_ERROR'
  | 'UNKNOWN_MODULES'
  | 'INVALID_STATE'
  | 'NOT_IMPLEMENTED'
  | 'RESOURCE_EXHAUSTED'

export class MantaError extends Error {
  readonly type: MantaErrorType
  readonly code?: string
  readonly date: Date
  readonly __isMantaError = true as const

  constructor(type: MantaErrorType, message: string, options?: { code?: string }) {
    super(message)
    this.type = type
    this.code = options?.code
    this.date = new Date()
    this.name = 'MantaError'
  }

  static is(err: unknown): err is MantaError {
    return (
      typeof err === 'object' &&
      err !== null &&
      '__isMantaError' in err &&
      (err as MantaError).__isMantaError === true
    )
  }
}

export class PermanentSubscriberError extends Error {
  readonly __isPermanentSubscriber = true as const
  constructor(public readonly cause: Error) {
    super(cause.message)
    this.name = 'PermanentSubscriberError'
  }
}

export function permanentSubscriberFailure(error: Error): PermanentSubscriberError {
  return new PermanentSubscriberError(error)
}

export type ServiceLifetime = 'SINGLETON' | 'SCOPED' | 'TRANSIENT'

export interface AuthContext {
  actor_type: 'user' | 'customer' | 'system'
  actor_id: string
  auth_identity_id?: string
  scope?: 'admin' | 'store'
  session_id?: string
  app_metadata?: Record<string, unknown>
}

export interface Message<T = unknown> {
  eventName: string
  data: T
  metadata: {
    auth_context?: AuthContext
    eventGroupId?: string
    transactionId?: string
    timestamp: number
    idempotencyKey?: string
    source?: string
  }
}

export interface Context {
  transactionManager?: unknown
  manager?: unknown
  isolationLevel?: string
  enableNestedTransactions?: boolean
  eventGroupId?: string
  transactionId?: string
  runId?: string
  requestId?: string
  messageAggregator?: IMessageAggregator
  idempotencyKey?: string
  isCancelling?: boolean
  auth_context?: AuthContext
}

export interface StepExecutionContext {
  container: IContainer
  metadata: {
    attempt: number
    idempotencyKey: string
    action: 'invoke' | 'compensate'
  }
  context: Context
}

export interface JobResult {
  status: 'success' | 'failure' | 'skipped'
  data?: unknown
  error?: MantaError
  duration_ms: number
}

export interface JobExecution {
  job_name: string
  started_at: Date
  finished_at: Date
  status: 'success' | 'failure' | 'skipped'
  error?: string
  attempt: number
}

export interface MantaErrorResponse {
  type: string
  message: string
  code?: string
  details?: unknown
  stack?: string
}

export interface RelationPagination {
  [relationName: string]: {
    limit?: number
    offset?: number
  }
}

export interface CursorPagination {
  cursor?: string
  limit: number
  direction: 'forward' | 'backward'
}

export interface WorkflowLifecycleEvent {
  type: 'STEP_SUCCESS' | 'STEP_FAILURE' | 'FINISH' | 'COMPENSATE_BEGIN' | 'COMPENSATE_END'
  workflowId: string
  transactionId: string
  stepId?: string
  result?: unknown
  error?: MantaError
  status?: string
}

export interface AuthCredentials {
  bearer?: string
  apiKey?: string
  sessionId?: string
}

export interface SessionOptions {
  ttl?: number
}

export interface TransactionOptions {
  isolationLevel?: 'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE'
  transaction?: unknown
  enableNestedTransactions?: boolean
}

export interface DatabaseConfig {
  url: string
  pool?: { min?: number; max?: number; idleTimeout?: number }
  ssl?: boolean
}

export interface GroupStatus {
  exists: boolean
  eventCount: number
  createdAt: number
  ttlRemainingMs?: number
}

// =============================================================================
// Port Interfaces
// =============================================================================

/** SPEC-001 — Container DI */
export interface IContainer {
  id: string
  resolve<T>(key: string): T
  register(key: string, value: unknown, lifetime?: ServiceLifetime): void
  createScope(): IContainer
  registerAdd(key: string, value: unknown): void
  aliasTo(alias: string, target: string): void
  dispose(): Promise<void>
}

/** SPEC-064/077 — Cache */
export interface ICachePort {
  get(key: string): Promise<string | null>
  set(key: string, data: string, ttl?: number): Promise<void>
  invalidate(key: string): Promise<void>
  clear(): Promise<void>
}

/** SPEC-034 — Event Bus */
export interface IEventBusPort {
  emit(event: Message | Message[], options?: { groupId?: string }): Promise<void>
  subscribe(
    eventName: string,
    handler: (event: Message) => Promise<void> | void,
    options?: { subscriberId?: string }
  ): void
  unsubscribe(subscriberId: string): void
  releaseGroupedEvents(eventGroupId: string): Promise<void>
  clearGroupedEvents(eventGroupId: string): Promise<void>
  addInterceptor(fn: (message: Message, context?: { isGrouped?: boolean; eventGroupId?: string }) => Promise<void> | void): void
  removeInterceptor(fn: Function): void
  onGroupCreated?(handler: (eventGroupId: string, eventCount: number) => void): void
  onGroupReleased?(handler: (eventGroupId: string, eventCount: number) => void): void
  onGroupCleared?(handler: (eventGroupId: string, eventCount: number, reason: 'explicit' | 'ttl') => void): void
  getGroupStatus?(eventGroupId: string): GroupStatus | null
}

/** SPEC-066/089/090 — Locking */
export interface ILockingPort {
  execute<T>(keys: string[], job: () => Promise<T>, options?: { timeout?: number }): Promise<T>
  acquire(keys: string | string[], options?: { ownerId?: string; expire?: number }): Promise<boolean>
  release(keys: string | string[], options?: { ownerId?: string }): Promise<void>
  releaseAll(options?: { ownerId?: string }): Promise<void>
}

/** SPEC-056 — Database */
export interface IDatabasePort {
  initialize(config: DatabaseConfig): Promise<void>
  dispose(): Promise<void>
  healthCheck(): Promise<boolean>
  getClient(): unknown
  getPool(): unknown
  transaction<T>(fn: (tx: unknown) => Promise<T>, options?: TransactionOptions): Promise<T>
  introspect?(): Promise<unknown>
}

/** SPEC-126 — Repository */
export interface IRepository<T = unknown> {
  find(options?: {
    where?: Record<string, unknown>
    withDeleted?: boolean
    limit?: number
    offset?: number
    order?: Record<string, 'ASC' | 'DESC'>
    cursor?: CursorPagination
  }): Promise<T[]>
  findAndCount(options?: Record<string, unknown>): Promise<[T[], number]>
  create(data: Record<string, unknown> | Record<string, unknown>[]): Promise<T | T[]>
  update(data: Record<string, unknown> | Record<string, unknown>[]): Promise<T | T[]>
  delete(ids: string | string[]): Promise<void>
  softDelete(ids: string | string[]): Promise<Record<string, string[]>>
  restore(ids: string | string[]): Promise<void>
  serialize(data: unknown, options?: unknown): Promise<unknown>
  upsertWithReplace(
    data: Record<string, unknown>[],
    replaceFields?: string[],
    conflictTarget?: string[]
  ): Promise<T[]>
  transaction<TManager = unknown>(
    task: (transactionManager: TManager) => Promise<unknown>,
    options?: TransactionOptions
  ): Promise<unknown>
}

/** SPEC-019b — Workflow Engine */
export interface IWorkflowEnginePort {
  run(
    workflowId: string,
    options: {
      input?: unknown
      context?: Context
      transactionId?: string
      resultFrom?: string
      throwOnError?: boolean
    }
  ): Promise<{ status: string; output?: unknown; errors?: unknown[] }>
  getRunningTransaction(workflowId: string, transactionId: string): Promise<unknown>
  setStepSuccess(idempotencyKey: string, response: unknown): Promise<void>
  setStepFailure(idempotencyKey: string, error: Error): Promise<void>
  subscribe(
    options: { event: WorkflowLifecycleEvent['type']; workflowId?: string },
    handler: (event: WorkflowLifecycleEvent) => Promise<void> | void
  ): () => void
}

/** SPEC-020 — Workflow Storage */
export interface IWorkflowStoragePort {
  save(transactionId: string, stepId: string, data: Record<string, unknown>): Promise<void>
  load(transactionId: string, stepId?: string): Promise<Record<string, unknown> | null>
  list(transactionId: string): Promise<Array<{ stepId: string; data: Record<string, unknown> }>>
  delete(transactionId: string): Promise<void>
}

/** SPEC-063 — Job Scheduler */
export interface IJobSchedulerPort {
  register(
    name: string,
    schedule: string,
    handler: (container: IContainer) => Promise<JobResult>,
    options?: {
      concurrency?: 'allow' | 'forbid'
      numberOfExecutions?: number
      retry?: { maxRetries: number; backoff?: 'fixed' | 'exponential'; delay?: number }
    }
  ): void
  runJob(name: string): Promise<JobResult>
  getJobHistory(jobName: string, limit?: number): Promise<JobExecution[]>
}

/** SPEC-065/080/081 — File */
export interface IFilePort {
  upload(key: string, data: Buffer | ReadableStream, contentType?: string): Promise<{ key: string; url: string }>
  delete(key: string | string[]): Promise<void>
  getPresignedDownloadUrl(key: string): Promise<string>
  getPresignedUploadUrl?(key: string): Promise<string>
  getDownloadStream(key: string): Promise<ReadableStream>
  getAsBuffer(key: string): Promise<Buffer>
  list(prefix?: string): Promise<string[]>
  getUploadStream?(key: string): Promise<{ stream: WritableStream; done: Promise<void> }>
}

/** SPEC-067/082 — Logger */
export interface ILoggerPort {
  error(msg: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  info(msg: string, ...args: unknown[]): void
  http(msg: string, ...args: unknown[]): void
  verbose(msg: string, ...args: unknown[]): void
  debug(msg: string, ...args: unknown[]): void
  silly(msg: string, ...args: unknown[]): void
  panic(data: unknown): void
  activity(msg: string): string
  progress(id: string, msg: string): void
  success(id: string, msg: string): void
  failure(id: string, msg: string): void
  shouldLog(level: string): boolean
  setLogLevel(level: string): void
  unsetLogLevel(): void
}

/** SPEC-049 — Auth (crypto pure) */
export interface IAuthPort {
  verifyJwt(token: string): AuthContext | null
  verifyApiKey(key: string): AuthContext | null
  createJwt(payload: AuthContext, options?: { expiresIn?: string | number }): string
}

/** SPEC-050 — Auth Module Service (business logic + sessions) */
export interface IAuthModuleService {
  authenticate(data: Record<string, unknown>): Promise<AuthContext | null>
  register(data: Record<string, unknown>): Promise<{ authIdentity: unknown }>
  validateCallback(data: Record<string, unknown>): Promise<AuthContext | null>
  createSession(authContext: AuthContext, options?: SessionOptions): Promise<{ sessionId: string; expiresAt: Date }>
  destroySession(sessionId: string): Promise<void>
  verifySession(sessionId: string): Promise<AuthContext | null>
}

/** SPEC-049b — Auth Gateway */
export interface IAuthGateway {
  authenticate(credentials: AuthCredentials): Promise<AuthContext | null>
}

/** SPEC-018 — Message Aggregator */
export interface IMessageAggregator {
  save(messages: Message[]): void
  getMessages(options?: { groupBy?: string; sortBy?: string }): Message[]
  clearMessages(): void
}

/** SPEC-097 — Notification */
export interface INotificationPort {
  send(notification: {
    to: string
    channel: string
    template?: string
    data?: Record<string, unknown>
    idempotency_key?: string
  }): Promise<{ status: 'SUCCESS' | 'FAILURE' | 'PENDING'; id?: string; error?: Error }>
  sendBatch?(notifications: Array<Parameters<INotificationPort['send']>[0]>): Promise<Array<Awaited<ReturnType<INotificationPort['send']>>>>
  list?(): Promise<unknown[]>
  retrieve?(id: string): Promise<unknown | null>
}

/** SPEC-134 — Translation */
export interface ITranslationPort {
  applyTranslations<T>(results: T[], locale: string, entityType: string): Promise<T[]>
  createTranslations(
    data: Array<{
      reference_id: string
      reference: string
      locale_code: string
      translations: Record<string, string>
    }>
  ): Promise<unknown[]>
  updateTranslations(
    data: Array<{
      reference_id: string
      locale_code: string
      translations: Record<string, string>
    }>
  ): Promise<unknown[]>
  deleteTranslations(filters: { reference_id?: string[]; locale_code?: string[] }): Promise<void>
  getStatistics(input: { entity_type: string; locale_code?: string }): Promise<{
    expected: number
    translated: number
    missing: number
  }>
  listLocales(): Promise<Array<{ code: string; name: string }>>
}

/** SPEC-039 — HTTP Port (simplified for testing) */
export interface IHttpPort {
  registerRoute(method: string, path: string, handler: (req: Request) => Promise<Response> | Response): void
  handleRequest(req: Request): Promise<Response>
}

// =============================================================================
// DML types (SPEC-057)
// =============================================================================

export interface DmlProperty {
  type: string
  nullable?: boolean
  default?: unknown
  index?: boolean | string
  unique?: boolean | string
  primaryKey?: boolean
  computed?: boolean
  searchable?: boolean
  translatable?: boolean
}

export interface DmlRelation {
  type: 'hasOne' | 'hasOneWithFK' | 'belongsTo' | 'hasMany' | 'manyToMany'
  target: () => unknown
  options?: Record<string, unknown>
}

export interface DmlEntity {
  name: string
  tableName?: string
  schema: Record<string, DmlProperty | DmlRelation>
  cascades?: { delete?: string[]; detach?: string[] }
  indexes?: Array<{
    on: string[]
    unique?: boolean
    where?: string | Record<string, unknown>
    name?: string
    type?: string
  }>
  checks?: Array<{ name?: string; expression: string | ((columns: Record<string, string>) => string) }>
}

// =============================================================================
// Utility exports
// =============================================================================

export function deriveWorkflowTransactionId(workflowId: string, event: Message): string {
  if (event.metadata.idempotencyKey) {
    return `${workflowId}:${event.metadata.idempotencyKey}`
  }
  return `${workflowId}:${crypto.randomUUID()}`
}

export function mapExternalError(error: Error, context?: string): MantaError {
  const message = context ? `${context}: ${error.message}` : error.message
  return new MantaError('UNEXPECTED_STATE', message)
}
