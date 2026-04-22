// Port interfaces — re-exports all port contracts
// Each port is defined in its own file with SPEC references.

export type { AuthenticationInput, AuthenticationResponse } from '../auth/providers/types'
// Auth types
export type { AuthContext, AuthCredentials, SessionOptions } from '../auth/types'
// Event types (re-exported for convenience)
export type { GetMessagesOptions, IMessageAggregator, Message } from '../events/types'
export type { IAnalyticsProvider } from './analytics'
export type { IAuthGateway, IAuthModuleService, IAuthPort } from './auth'
// Port interfaces
export type { ICachePort } from './cache'
export type { IDatabasePort } from './database'
export type { IEventBusPort } from './event-bus'
export type { IFilePort } from './file'
export type { IHttpPort } from './http'
export { InMemoryProgressChannel } from './in-memory-progress-channel'
export type { IJobSchedulerPort } from './job-scheduler'
export type { ILockingPort } from './locking'
export type { ILoggerPort } from './logger'
export type { INotificationPort } from './notification'
export type { IProgressChannelPort, ProgressSnapshot } from './progress-channel'
export type { IRelationalQueryPort, RelationalQueryConfig } from './relational-query'
export type { IRepository } from './repository'
export type { IRepositoryFactory } from './repository-factory'
export type { ISchemaGenerator } from './schema-generator'
export type { ISearchProvider } from './search'
// Shared types used across ports
export type {
  Context,
  CursorPagination,
  DatabaseConfig,
  GroupStatus,
  JobExecution,
  JobResult,
  TransactionOptions,
  WorkflowLifecycleEvent,
} from './types'
export { ContainerRegistrationKeys } from './types'
export type {
  IWorkflowStorePort,
  NewWorkflowRun,
  StepState,
  StepStatus,
  WorkflowError,
  WorkflowRun,
  WorkflowStatus,
} from './workflow-store'
