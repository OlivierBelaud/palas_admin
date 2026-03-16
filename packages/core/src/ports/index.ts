// Port interfaces — re-exports all port contracts
// Each port is defined in its own file with SPEC references.

// Shared types used across ports
export type {
  Context,
  JobResult,
  JobExecution,
  WorkflowLifecycleEvent,
  TransactionOptions,
  DatabaseConfig,
  CursorPagination,
  GroupStatus,
} from './types'

// Auth types
export type { AuthContext, AuthCredentials, SessionOptions } from '../auth/types'

// Port interfaces
export type { ICachePort } from './cache'
export type { IEventBusPort } from './event-bus'
export type { ILockingPort } from './locking'
export type { IDatabasePort } from './database'
export type { IRepository } from './repository'
export type { IWorkflowEnginePort } from './workflow-engine'
export type { IWorkflowStoragePort } from './workflow-storage'
export type { IFilePort } from './file'
export type { ILoggerPort } from './logger'
export type { IJobSchedulerPort } from './job-scheduler'
export type { INotificationPort } from './notification'
export type { ISearchProvider } from './search'
export type { IAnalyticsProvider } from './analytics'
export type { ITranslationPort } from './translation'
export type { IHttpPort } from './http'
export type { IAuthPort, IAuthModuleService, IAuthGateway } from './auth'
