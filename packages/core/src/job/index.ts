// Job definition — typed cron scheduler that dispatches commands
//
// Jobs receive { command, log } — same scope as subscribers.
// Every mutation goes through a command (compensation, retry, audit trail).
//
// Usage:
//   defineJob('cleanup-drafts', '0 3 * * *', async ({ command }) => {
//     await command.cleanupDraftProducts({ olderThanDays: 30 })
//   })

import type { MantaCommands } from '../command/types'
import { MantaError } from '../errors/manta-error'
import type { ILoggerPort } from '../ports/logger'

/**
 * Scoped context passed to job handlers — same shape as subscriber scope.
 * - `command` — CQRS command callables (with autocomplete from codegen)
 * - `log` — logger instance
 */
export interface JobScope {
  command: MantaCommands
  log: ILoggerPort
}

/**
 * Typed job definition.
 */
export interface JobDefinition<TResult = unknown> {
  __type: 'job'
  name: string
  schedule: string
  handler: (scope: JobScope) => Promise<TResult>
}

/**
 * Define a scheduled job.
 * Handler receives `{ command, log }` — same scope as subscribers.
 *
 * @example
 * defineJob('cleanup-drafts', '0 3 * * *', async ({ command }) => {
 *   await command.cleanupDraftProducts({ olderThanDays: 30 })
 * })
 */
export function defineJob<TResult = unknown>(
  name: string,
  schedule: string,
  handler: (scope: JobScope) => Promise<TResult>,
): JobDefinition<TResult>

/**
 * Define a scheduled job using config object.
 *
 * @example
 * defineJob({
 *   name: 'cleanup-drafts',
 *   schedule: '0 3 * * *',
 *   handler: async ({ command }) => {
 *     await command.cleanupDraftProducts({ olderThanDays: 30 })
 *   },
 * })
 */
export function defineJob<TResult = unknown>(config: Omit<JobDefinition<TResult>, '__type'>): JobDefinition<TResult>

// ── Implementation ──────────────────────────────────────────────────
export function defineJob<TResult = unknown>(
  nameOrConfig: string | Omit<JobDefinition<TResult>, '__type'>,
  schedule?: string,
  handler?: (scope: JobScope) => Promise<TResult>,
): JobDefinition<TResult> {
  if (typeof nameOrConfig === 'object') {
    const config = nameOrConfig
    if (!config.name) throw new MantaError('INVALID_DATA', 'Job name is required')
    if (!config.schedule) throw new MantaError('INVALID_DATA', 'Job schedule (cron expression) is required')
    if (typeof config.handler !== 'function') throw new MantaError('INVALID_DATA', 'Job handler must be a function')
    return { ...config, __type: 'job' as const }
  }

  if (!nameOrConfig) throw new MantaError('INVALID_DATA', 'Job name is required')
  if (!schedule) throw new MantaError('INVALID_DATA', 'Job schedule (cron expression) is required')
  if (typeof handler !== 'function') throw new MantaError('INVALID_DATA', 'Job handler must be a function')

  return { __type: 'job' as const, name: nameOrConfig, schedule, handler }
}
