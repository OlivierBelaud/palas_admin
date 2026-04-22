// @manta/core — Public API
//
// Everything is a define*():
//   import { defineModel, defineService, defineCommand, ... } from '@manta/core'
//
// Helpers used inside define*():
//   field.text(), field.number(), defineService()
//
// Step (workflow unit):
//   step.MODULE.create(), step.action(), step.emit()

// ── Framework internals ──────────────────────────
// Used by CLI bootstrap, adapters, plugins. Not for application code.
export type { LogEntry, TestAuthConfig } from './adapters'
export {
  InMemoryCacheAdapter,
  InMemoryDatabaseAdapter,
  InMemoryEventBusAdapter,
  InMemoryFileAdapter,
  InMemoryHttpAdapter,
  InMemoryJobScheduler,
  InMemoryLockingAdapter,
  InMemoryNotificationAdapter,
  InMemoryRelationalQuery,
  InMemoryRepository,
  InMemoryRepositoryFactory,
  InMemoryTransaction,
  MockAuthGateway,
  MockAuthModuleService,
  MockAuthPort,
  TestLogger,
} from './adapters'
export type { AgentDefinition } from './ai'
// ── Agent (AI step) ──────────────────────────────
export { defineAgent } from './ai'
// ── App ──────────────────────────────────────────
export type { MantaApp, MantaAppModules, MantaInfra, RequestContext, TestMantaApp } from './app'
export { createApp, createTestMantaApp, getRequestContext, MantaAppBuilder, runInRequestContext } from './app'
export type {
  CommandAccessMap,
  CommandAccessRule,
  CommandDefinition,
  CommandGraphDefinition,
  CommandToolSchema,
  EntityCommand,
  EntityCommandOperation,
  EntityZodSchemas,
  MantaCommands,
  MantaEntities,
  TypedCommandConfig,
  TypedStep,
} from './command'
// ── Commands (CQRS tool-first) ───────────────────
export {
  CommandRegistry,
  defineCommand,
  defineCommandGraph,
  dmlToZod,
  generateEntityCommands,
  generateLinkCommands,
  generateModuleCommands,
  getCommandScope,
  isCommandAllowed,
  isModuleAllowed,
  QUERY_TOOL_SCHEMA,
  zodToJsonSchema,
} from './command'
export type { EnvProfile, MantaConfig, PresetAdapterEntry, PresetDefinition, ProjectConfig, SpaConfig } from './config'
// ── Config ───────────────────────────────────────
export {
  AuthConfigSchema,
  AuthSessionConfigSchema,
  BootConfigSchema,
  BUILT_IN_PRESETS,
  ConfigManager,
  DatabaseConfigSchema,
  defineConfig,
  definePreset,
  devPreset,
  EventsConfigSchema,
  FlagRouter,
  HttpConfigSchema,
  LoadedConfigSchema,
  QueryConfigSchema,
  RateLimitConfigSchema,
  SessionCookieConfigSchema,
  SPA_DEFAULTS,
  vercelPreset,
} from './config'
// ── Context (internal — V2 is filesystem-derived, no public defineContext) ──
export type {
  ActorType,
  AiContextConfig,
  CommandName,
  ContextDefinition,
  MantaRegistry,
  ModuleExposeConfig,
  ModuleName,
  ResolvedContext,
} from './context'
export { ContextRegistry } from './context'
export {
  ArrayProperty,
  AutoIncrementProperty,
  BaseProperty,
  BaseProperty as DmlProperty,
  BigNumberProperty,
  BooleanProperty,
  ComputedProperty,
  DateTimeProperty,
  EnumProperty,
  FloatProperty,
  JSONProperty,
  NullableModifier,
  NumberProperty,
  PrimaryKeyModifier,
  type PropertyMetadata,
  TextProperty,
} from './dml'
export type { DmlEntityOptions, DmlPropertyDefinition, DmlRelationDefinition } from './dml/entity'
export { DmlEntity } from './dml/entity'
export { fromZodSchema } from './dml/from-zod'
export type {
  GeneratedSchema,
  ParsedDmlEntity,
  ParsedDmlIndex,
  ParsedDmlProperty,
  ParsedDmlRelation,
} from './dml/generator'
export { generateDrizzleSchema, parseDmlEntity } from './dml/generator'
export type { InferEntity } from './dml/infer'
// ── DML (Data Modeling Language) ─────────────────
export { defineModel, field, model } from './dml/model'
export { belongsTo } from './dml/relations/belongs-to'
export { hasMany } from './dml/relations/has-many'
export { hasOne, hasOneWithFK } from './dml/relations/has-one'
export type { MantaErrorResponse, MantaErrorType } from './errors/manta-error'
// ── Errors ───────────────────────────────────────
export { MantaError, PermanentSubscriberError, permanentSubscriberFailure } from './errors/manta-error'
// ── Events ───────────────────────────────────────
export type { IMessageAggregator, MantaEventMap, Message } from './events'
export { MessageAggregator } from './events'
export type { JobDefinition, JobScope } from './job'
// ── Job ──────────────────────────────────────────
export { defineJob } from './job'
export type { ManyRef, ModelProxy, ModelRef, ResolvedLink } from './link'
// ── Link ─────────────────────────────────────────
export {
  clearLinkRegistry,
  createModelProxy,
  defineLink,
  getRegisteredLinks,
  many,
  REMOTE_LINK,
  registerLink,
} from './link'
export type { MiddlewareConfig, MiddlewareDefinition, MiddlewareRequest } from './middleware'
export { defineMiddleware, defineMiddlewares, ERROR_STATUS_MAP, mapErrorToStatus } from './middleware'
// ── Module (internal — no public defineModule, the filesystem IS the module) ──
export type { ModuleExports, ModuleLifecycleHooks } from './module'
export { Module } from './module' // internal — used by plugin-medusa shim
export type { ModuleVersionStore, VersionCheckResult, VersionMismatch, VersionUpgrade } from './module/versioning'
export { ModuleVersionChecker } from './module/versioning'
// ── Naming conventions ──────────────────────────
export {
  pluralize,
  toCamel,
  toKebab,
  toPascal,
  toSnake,
  toTableKey,
  validateCamelCase,
  validatePascalCase,
} from './naming'
// ── Port interfaces (type-only) ──────────────────
export type {
  AuthContext,
  AuthCredentials,
  AuthenticationInput,
  AuthenticationResponse,
  Context,
  CursorPagination,
  DatabaseConfig,
  GroupStatus,
  IAnalyticsProvider,
  IAuthGateway,
  IAuthModuleService,
  IAuthPort,
  ICachePort,
  IDatabasePort,
  IEventBusPort,
  IFilePort,
  IHttpPort,
  IJobSchedulerPort,
  ILockingPort,
  ILoggerPort,
  INotificationPort,
  IProgressChannelPort,
  IRelationalQueryPort,
  IRepository,
  IRepositoryFactory,
  ISchemaGenerator,
  ISearchProvider,
  IWorkflowStorePort,
  JobExecution,
  JobResult,
  NewWorkflowRun,
  ProgressSnapshot,
  RelationalQueryConfig,
  SessionOptions,
  StepState,
  StepStatus,
  TransactionOptions,
  WorkflowError,
  WorkflowLifecycleEvent,
  WorkflowRun,
  WorkflowStatus,
} from './ports'
export { ContainerRegistrationKeys, InMemoryProgressChannel } from './ports'
export type {
  EntityAccessMap,
  EntityAccessRule,
  EntityName,
  EntityRegistry,
  EntityResolver,
  GraphQueryConfig,
  IndexQueryConfig,
  InferEntityResult,
  QueryConfig,
  QueryDefinition,
  QueryGraphDefinition,
  QueryGraphExtensionContext,
  QueryGraphExtensionDefinition,
  QueryGraphExtensionResolver,
  QueryHandlerContext,
  RelationPagination,
} from './query'
// ── Query ────────────────────────────────────────
export {
  defineQuery,
  defineQueryGraph,
  extendQueryGraph,
  getEntityFilter,
  isEntityAllowed,
  QueryRegistry,
  QueryService,
} from './query'
export type { ServiceConfig, ServiceDescriptor, ServiceFactoryContext, TypedRepository } from './service'
// ── Service ──────────────────────────────────────
export {
  buildEventNamesFromModelName,
  createService,
  defineService,
  instantiateServiceDescriptor,
  isServiceDescriptor,
} from './service'
export type { LinkLocation, RouteConflictInfo, StrictModeContext } from './strict-mode'
export {
  checkAutoDiscovery,
  checkEventNameAutoGeneration,
  checkLinkLocations,
  checkRouteConflicts,
  checkUnboundedRelations,
  getEntityThreshold,
} from './strict-mode'
export type {
  SubscriberConfig,
  SubscriberContext,
  SubscriberDefinition,
  SubscriberExport,
  SubscriberHandler,
  SubscriberScope,
} from './subscriber'
// ── Subscriber ───────────────────────────────────
export { defineSubscriber, makeIdempotent, registerSubscriber } from './subscriber'
export type { UserDefinition } from './user'
// ── User ────────────────────────────────────────
export { defineUserModel } from './user'
export type { AutoRouteDeps, RouteEntry } from './user/auto-routes'
export { generateAllUserRoutes, getPublicPaths } from './user/auto-routes'
// ── Step (workflow unit — fundamental primitive) ──
// step.MODULE.create/update/delete — CRUD auto-compensé
// step.MODULE.METHOD — service method compensé
// step.MODULE.link.OTHER — link auto-résolu
// step.action() — action externe avec compensation obligatoire
// step.emit() — événement fire-and-forget bufferisé
export type {
  ActionStepConfig,
  CrudStepConfig,
  EmitEventStepInput,
  ForEachInfo,
  OrphanReaperJobDescriptor,
  OrphanReaperOptions,
  OrphanReaperResult,
  StepContext,
  StepDefinition,
  StepHandlerContext,
  StepResolveContext,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowResult,
  WorkflowRunOptions,
  WorkflowRunResult,
  WorkflowStorage,
} from './workflows'
export {
  CancelledError,
  createForEach,
  createOrphanReaperJob,
  createProgress,
  createStep,
  createWorkflow,
  DEFAULT_ORPHAN_REAP_LIMIT,
  DEFAULT_ORPHAN_THRESHOLD_MS,
  defineWorkflow,
  ENTITY_TAG,
  emitEventStep,
  ORPHAN_REAPER_JOB_NAME,
  ORPHAN_REAPER_SCHEDULE,
  step,
  WORKFLOW_ORPHANED_CODE,
  WorkflowManager,
} from './workflows'
