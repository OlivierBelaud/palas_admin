// Shared types used across port interfaces

import type { MantaError } from '../errors/manta-error'

/**
 * Execution context passed to workflow steps.
 */
export interface Context {
  transactionManager?: unknown
  manager?: unknown
  isolationLevel?: string
  enableNestedTransactions?: boolean
  eventGroupId?: string
  transactionId?: string
  runId?: string
  requestId?: string
  messageAggregator?: unknown
  idempotencyKey?: string
  isCancelling?: boolean
  auth_context?: import('../auth/types').AuthContext
}

/**
 * Result of a scheduled job execution.
 */
export interface JobResult {
  status: 'success' | 'failure' | 'skipped'
  data?: unknown
  error?: MantaError
  duration_ms: number
}

/**
 * Historical record of a job execution.
 */
export interface JobExecution {
  job_name: string
  started_at: Date
  finished_at: Date
  status: 'success' | 'failure' | 'skipped'
  error?: string
  attempt: number
}

/**
 * Lifecycle events emitted by the workflow engine.
 */
export interface WorkflowLifecycleEvent {
  type: 'STEP_SUCCESS' | 'STEP_FAILURE' | 'FINISH' | 'COMPENSATE_BEGIN' | 'COMPENSATE_END'
  workflowId: string
  transactionId: string
  stepId?: string
  result?: unknown
  error?: MantaError
  status?: string
}

/**
 * Transaction options for database/repository operations.
 */
export interface TransactionOptions {
  isolationLevel?: 'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE'
  transaction?: unknown
  enableNestedTransactions?: boolean
}

/**
 * Database connection configuration.
 */
export interface DatabaseConfig {
  url: string
  pool?: { min?: number; max?: number; idleTimeout?: number }
  ssl?: boolean
}

/**
 * Cursor-based pagination options.
 */
export interface CursorPagination {
  cursor?: string
  limit: number
  direction: 'forward' | 'backward'
}

/**
 * Status of a grouped event set.
 */
export interface GroupStatus {
  exists: boolean
  eventCount: number
  createdAt: number
  ttlRemainingMs?: number
}
