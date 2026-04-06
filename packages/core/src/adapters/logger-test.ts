// SPEC-067/082 — TestLogger implements ILoggerPort

import type { ILoggerPort } from '../ports'

export interface LogEntry {
  level: string
  msg: string
  data?: unknown
}

export class TestLogger implements ILoggerPort {
  logs: LogEntry[] = []
  private _level = 'silly'
  private _activities = new Map<string, string>()

  private _log(level: string, msg: string, ...args: unknown[]) {
    if (this.shouldLog(level)) {
      this.logs.push({ level, msg, data: args.length === 1 ? args[0] : args.length > 0 ? args : undefined })
    }
  }

  error(msg: string, ...args: unknown[]) {
    this._log('error', msg, ...args)
  }
  warn(msg: string, ...args: unknown[]) {
    this._log('warn', msg, ...args)
  }
  info(msg: string, ...args: unknown[]) {
    this._log('info', msg, ...args)
  }
  http(msg: string, ...args: unknown[]) {
    this._log('http', msg, ...args)
  }
  verbose(msg: string, ...args: unknown[]) {
    this._log('verbose', msg, ...args)
  }
  debug(msg: string, ...args: unknown[]) {
    this._log('debug', msg, ...args)
  }
  silly(msg: string, ...args: unknown[]) {
    this._log('silly', msg, ...args)
  }
  panic(data: unknown) {
    this._log('panic', 'PANIC', data)
  }

  activity(msg: string): string {
    const id = crypto.randomUUID()
    this._activities.set(id, msg)
    this._log('info', `[activity:${id}] ${msg}`)
    return id
  }

  progress(id: string, msg: string) {
    this._log('info', `[progress:${id}] ${msg}`)
  }
  success(id: string, msg: string) {
    this._log('info', `[success:${id}] ${msg}`)
    this._activities.delete(id)
  }
  failure(id: string, msg: string) {
    this._log('error', `[failure:${id}] ${msg}`)
    this._activities.delete(id)
  }

  private static readonly LEVELS: Record<string, number> = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    verbose: 4,
    debug: 5,
    silly: 6,
    panic: -1,
  }

  shouldLog(level: string): boolean {
    const threshold = TestLogger.LEVELS[this._level] ?? 2
    const requested = TestLogger.LEVELS[level] ?? 2
    return level === 'panic' || requested <= threshold
  }

  setLogLevel(level: string) {
    this._level = level
  }
  unsetLogLevel() {
    this._level = 'silly'
  }

  clear() {
    this.logs = []
  }
}
