// SPEC-063 — IJobSchedulerPort interface

import type { IContainer } from '../container/types'
import type { JobResult, JobExecution } from './types'

/**
 * Job scheduler port contract.
 * Adapters: NodeCronJobScheduler (dev), VercelCronAdapter (prod).
 * Dependencies: ILockingPort, ILoggerPort, IWorkflowStoragePort.
 */
export interface IJobSchedulerPort {
  /**
   * Register a scheduled job.
   * @param name - Unique job name
   * @param schedule - Cron expression
   * @param handler - Job handler receiving a scoped container
   * @param options - Concurrency, execution limit, and retry options
   */
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

  /**
   * Manually trigger a registered job.
   * @param name - The job name
   * @returns The job execution result
   */
  runJob(name: string): Promise<JobResult>

  /**
   * Get execution history for a job.
   * @param jobName - The job name
   * @param limit - Maximum number of records to return
   * @returns Array of job execution records
   */
  getJobHistory(jobName: string, limit?: number): Promise<JobExecution[]>
}
