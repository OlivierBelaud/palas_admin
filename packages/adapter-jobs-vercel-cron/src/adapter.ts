// SPEC-063 — VercelCronAdapter implements IJobSchedulerPort
// This is a registry-based adapter. Vercel Cron triggers jobs via HTTP.
// register() stores handlers locally, runJob() executes them with locking and persistence.

import type { IJobSchedulerPort, ILockingPort, ILoggerPort, JobExecution, JobResult, MantaApp } from '@manta/core'
import { MantaError } from '@manta/core'

interface JobRegistration {
  schedule: string
  handler: (ctx: { app: MantaApp }) => Promise<JobResult>
  options?: {
    concurrency?: 'allow' | 'forbid'
    numberOfExecutions?: number
    timeout?: number
    retry?: { maxRetries: number; backoff?: 'fixed' | 'exponential'; delay?: number }
  }
}

export class VercelCronAdapter implements IJobSchedulerPort {
  private _jobs = new Map<string, JobRegistration>()
  private _executionCounts = new Map<string, number>()
  private _history: JobExecution[] = []
  private _app: MantaApp | null = null

  /** Set the app reference so job handlers receive the real app. */
  setApp(app: MantaApp): void {
    this._app = app
  }

  constructor(
    private _locking: ILockingPort,
    private _logger: ILoggerPort,
  ) {
    if (!_locking) throw new MantaError('INVALID_STATE', 'IJobSchedulerPort requires ILockingPort')
    if (!_logger) throw new MantaError('INVALID_STATE', 'IJobSchedulerPort requires ILoggerPort')
  }

  register(
    name: string,
    schedule: string,
    handler: (ctx: { app: MantaApp }) => Promise<JobResult>,
    options?: Record<string, unknown>,
  ): void {
    this._jobs.set(name, { schedule, handler, options: options as JobRegistration['options'] })
  }

  async runJob(name: string): Promise<JobResult> {
    const job = this._jobs.get(name)
    if (!job) throw new MantaError('NOT_FOUND', `Job "${name}" not registered`)

    const started = new Date()
    const startMs = Date.now()

    try {
      // Concurrency control (J-04)
      if (job.options?.concurrency === 'forbid') {
        const acquired = await this._locking.acquire([`job:${name}`], { expire: 60000 })
        if (!acquired) {
          const result: JobResult = { status: 'skipped', duration_ms: Date.now() - startMs }
          await this._persistExecution(name, started, result)
          return result
        }
      }

      // numberOfExecutions limit
      if (job.options?.numberOfExecutions) {
        const count = this._executionCounts.get(name) ?? 0
        if (count >= job.options.numberOfExecutions) {
          const result: JobResult = { status: 'skipped', duration_ms: Date.now() - startMs }
          await this._persistExecution(name, started, result)
          if (job.options?.concurrency === 'forbid') {
            await this._locking.release([`job:${name}`]).catch(() => {})
          }
          return result
        }
      }

      // Execute with retry support
      let result: JobResult
      const maxRetries = job.options?.retry?.maxRetries ?? 0
      let lastError: unknown

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          result = await this._executeWithTimeout(job, name)
          this._executionCounts.set(name, (this._executionCounts.get(name) ?? 0) + 1)
          await this._persistExecution(name, started, result)
          if (job.options?.concurrency === 'forbid') {
            await this._locking.release([`job:${name}`])
          }
          return result
        } catch (error: unknown) {
          lastError = error
          if (attempt < maxRetries) {
            const delay = this._calculateBackoff(job.options?.retry, attempt)
            await new Promise((r) => setTimeout(r, delay))
          }
        }
      }

      // All retries exhausted
      const err = lastError instanceof Error ? lastError : new Error(String(lastError))
      result = {
        status: 'failure',
        error: MantaError.is(lastError) ? lastError : new MantaError('UNEXPECTED_STATE', err.message),
        duration_ms: Date.now() - startMs,
      }
      this._logger.error(`Job "${name}" failed after ${maxRetries + 1} attempts`, lastError)
      await this._persistExecution(name, started, result)

      if (job.options?.concurrency === 'forbid') {
        await this._locking.release([`job:${name}`]).catch(() => {})
      }

      return result
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error))
      const result: JobResult = {
        status: 'failure',
        error: MantaError.is(error) ? error : new MantaError('UNEXPECTED_STATE', err.message),
        duration_ms: Date.now() - startMs,
      }
      this._logger.error(`Job "${name}" failed`, error)
      await this._persistExecution(name, started, result)

      if (job.options?.concurrency === 'forbid') {
        await this._locking.release([`job:${name}`]).catch(() => {})
      }

      return result
    }
  }

  async getJobHistory(jobName: string, limit?: number): Promise<JobExecution[]> {
    const filtered = this._history.filter((h) => h.job_name === jobName)
    return limit ? filtered.slice(-limit) : filtered
  }

  private async _executeWithTimeout(job: JobRegistration, name: string): Promise<JobResult> {
    const timeoutMs = job.options?.timeout
    if (!timeoutMs || timeoutMs <= 0) {
      return job.handler({ app: this._app! })
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      return await Promise.race([
        job.handler({ app: this._app! }),
        new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener('abort', () => {
            reject(new MantaError('UNEXPECTED_STATE', `Job "${name}" exceeded timeout of ${timeoutMs}ms`))
          })
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  private _calculateBackoff(
    retry: { backoff?: 'fixed' | 'exponential'; delay?: number } | undefined,
    attempt: number,
  ): number {
    const baseDelay = retry?.delay ?? 1000
    if (retry?.backoff === 'exponential') {
      return baseDelay * 2 ** attempt
    }
    return baseDelay
  }

  private _persistExecution(name: string, started: Date, result: JobResult): void {
    this._history.push({
      job_name: name,
      started_at: started,
      finished_at: new Date(),
      status: result.status,
      error: result.error?.message,
      attempt: 1,
    })
  }

  _reset() {
    this._jobs.clear()
    this._executionCounts.clear()
    this._history = []
  }
}
