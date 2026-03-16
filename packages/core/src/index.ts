// @manta/core — Public API re-exports

// Errors
export { MantaError, PermanentSubscriberError, permanentSubscriberFailure } from './errors/manta-error'
export type { MantaErrorType, MantaErrorResponse } from './errors/manta-error'

// Container
export { MantaContainer, containerALS, withScope, ContainerRegistrationKeys } from './container'
export type { IContainer, ServiceLifetime } from './container'

// Events
export { MessageAggregator } from './events'
export type { Message, IMessageAggregator } from './events'

// Config
export { defineConfig, ConfigManager, FlagRouter } from './config'
export type { MantaConfig, ProjectConfig, EnvProfile } from './config'

// Ports
export type {
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
} from './ports'

// In-memory adapters (dev + test defaults)
export {
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
} from './adapters'
export type { LogEntry, TestAuthConfig } from './adapters'

// DML
export { model } from './dml/model'
export { DmlEntity } from './dml/entity'
export { DmlProperty } from './dml/property'
export type { DmlPropertyDefinition, DmlRelationDefinition, DmlEntityOptions } from './dml/entity'
export { parseDmlEntity, generateDrizzleSchema } from './dml/generator'
export type { GeneratedSchema, ParsedDmlEntity } from './dml/generator'

// Workflows
export { createWorkflow, step, WorkflowManager } from './workflows'
export type {
  WorkflowDefinition,
  WorkflowResult,
  StepDefinition,
  StepHandlerContext,
  StepResolveContext,
  WorkflowRunOptions,
} from './workflows'

// Module system
export { Module, defineModule } from './module'
export type { ModuleExports, ModuleOptions, ModuleLifecycleHooks } from './module'

// Module versioning
export { ModuleVersionChecker } from './module/versioning'
export type { ModuleVersionStore, VersionCheckResult, VersionMismatch, VersionUpgrade } from './module/versioning'

// Service base
export { createService, buildEventNamesFromModelName } from './service'
export type { ServiceConfig } from './service'

// Service decorators
export { InjectManager, InjectTransactionManager, EmitEvents } from './service/decorators'

// Link system
export { defineLink, getRegisteredLinks, clearLinkRegistry, REMOTE_LINK } from './link'
export type { LinkDefinition, ResolvedLink } from './link'

// Middleware system
export { defineMiddlewares, mapErrorToStatus, ERROR_STATUS_MAP } from './middleware'
export type { MiddlewareConfig } from './middleware'

// Subscriber system
export { registerSubscriber, makeIdempotent } from './subscriber'
export type { SubscriberHandler, SubscriberConfig, SubscriberExport } from './subscriber'

// Query system
export { QueryService } from './query'
export type { GraphQueryConfig, IndexQueryConfig, RelationPagination, EntityResolver } from './query'

// Strict mode
export {
  checkRouteConflicts,
  checkUnboundedRelations,
  getEntityThreshold,
  checkLinkLocations,
  checkAutoDiscovery,
  checkEventNameAutoGeneration,
} from './strict-mode'
export type { StrictModeContext, RouteConflictInfo, LinkLocation } from './strict-mode'
