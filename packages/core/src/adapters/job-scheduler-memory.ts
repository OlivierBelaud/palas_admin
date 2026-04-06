// SPEC-063 — InMemoryJobScheduler implements IJobSchedulerPort

import type { MantaApp } from '../app'
import { MantaError } from '../errors/manta-error'
import type { IJobSchedulerPort, ILockingPort, ILoggerPort, JobExecution, JobResult } from '../ports'

export class InMemoryJobScheduler implements IJobSchedulerPort {
  private _jobs = new Map<
    string,
    {
      schedule: string
      handler: (ctx: { app: MantaApp }) => Promise<JobResult>
      options?: Record<string, unknown>
    }
  >()
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
    this._jobs.set(name, { schedule, handler, options })
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
          this._recordExecution(name, started, result)
          return result
        }
      }

      // Timeout enforcement (J-08)
      const timeoutMs = typeof job.options?.timeout === 'number' ? job.options.timeout : undefined
      let result: JobResult

      if (timeoutMs && timeoutMs > 0) {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)

        try {
          result = await Promise.race([
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
      } else {
        result = await job.handler({ app: this._app! })
      }

      this._recordExecution(name, started, result)

      if (job.options?.concurrency === 'forbid') {
        await this._locking.release([`job:${name}`])
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
      this._recordExecution(name, started, result)

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

  private _recordExecution(name: string, started: Date, result: JobResult) {
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
    this._history = []
  }
}
