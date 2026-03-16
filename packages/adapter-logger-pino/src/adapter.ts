// SPEC-067/082 — PinoLoggerAdapter implements ILoggerPort

import pino from 'pino'
import type { ILoggerPort } from '@manta/core/ports'

/**
 * Maps Manta log levels to Pino log levels.
 * Manta has 8 levels; Pino has 6. We map as follows:
 *   error→error, warn→warn, info→info, http→info,
 *   verbose→debug, debug→debug, silly→trace, panic→fatal
 */
const MANTA_TO_PINO: Record<string, string> = {
  error: 'error',
  warn: 'warn',
  info: 'info',
  http: 'info',
  verbose: 'debug',
  debug: 'debug',
  silly: 'trace',
  panic: 'fatal',
}

/**
 * Manta level hierarchy (lower number = higher priority).
 * panic always logs regardless of threshold.
 */
const MANTA_LEVELS: Record<string, number> = {
  panic: -1,
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  verbose: 4,
  debug: 5,
  silly: 6,
}

export interface PinoLoggerOptions {
  level?: string
  pretty?: boolean
}

export class PinoLoggerAdapter implements ILoggerPort {
  private logger: pino.Logger
  private _level: string
  private readonly _defaultLevel: string
  private _activities = new Map<string, string>()

  constructor(options: PinoLoggerOptions = {}) {
    this._defaultLevel = options.level ?? 'silly'
    this._level = this._defaultLevel

    const pinoLevel = this.mantaToPinoLevel(this._level)

    if (options.pretty) {
      this.logger = pino({
        level: pinoLevel,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true },
        },
      })
    } else {
      this.logger = pino({ level: pinoLevel })
    }
  }

  error(msg: string, ...args: unknown[]): void {
    if (!this.shouldLog('error')) return
    this.logWithData('error', msg, args)
  }

  warn(msg: string, ...args: unknown[]): void {
    if (!this.shouldLog('warn')) return
    this.logWithData('warn', msg, args)
  }

  info(msg: string, ...args: unknown[]): void {
    if (!this.shouldLog('info')) return
    this.logWithData('info', msg, args)
  }

  http(msg: string, ...args: unknown[]): void {
    if (!this.shouldLog('http')) return
    this.logWithData('info', msg, args)
  }

  verbose(msg: string, ...args: unknown[]): void {
    if (!this.shouldLog('verbose')) return
    this.logWithData('debug', msg, args)
  }

  debug(msg: string, ...args: unknown[]): void {
    if (!this.shouldLog('debug')) return
    this.logWithData('debug', msg, args)
  }

  silly(msg: string, ...args: unknown[]): void {
    if (!this.shouldLog('silly')) return
    this.logWithData('trace', msg, args)
  }

  panic(data: unknown): void {
    if (typeof data === 'string') {
      this.logger.fatal(data)
    } else {
      this.logger.fatal({ data }, 'PANIC')
    }
  }

  activity(msg: string): string {
    const id = crypto.randomUUID()
    this._activities.set(id, msg)
    if (this.shouldLog('info')) {
      this.logger.info(`[activity:${id}] ${msg}`)
    }
    return id
  }

  progress(id: string, msg: string): void {
    if (this.shouldLog('info')) {
      this.logger.info(`[progress:${id}] ${msg}`)
    }
  }

  success(id: string, msg: string): void {
    if (this.shouldLog('info')) {
      this.logger.info(`[success:${id}] ${msg}`)
    }
    this._activities.delete(id)
  }

  failure(id: string, msg: string): void {
    if (this.shouldLog('error')) {
      this.logger.error(`[failure:${id}] ${msg}`)
    }
    this._activities.delete(id)
  }

  shouldLog(level: string): boolean {
    if (level === 'panic') return true
    const threshold = MANTA_LEVELS[this._level] ?? 2
    const requested = MANTA_LEVELS[level] ?? 2
    return requested <= threshold
  }

  setLogLevel(level: string): void {
    this._level = level
    this.logger.level = this.mantaToPinoLevel(level)
  }

  unsetLogLevel(): void {
    this._level = this._defaultLevel
    this.logger.level = this.mantaToPinoLevel(this._defaultLevel)
  }

  dispose(): void {
    this.logger.flush()
  }

  private mantaToPinoLevel(mantaLevel: string): string {
    return MANTA_TO_PINO[mantaLevel] ?? 'info'
  }

  private logWithData(pinoLevel: string, msg: string, args: unknown[]): void {
    if (args.length === 0) {
      this.logger[pinoLevel as keyof pino.Logger](msg)
    } else if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
      this.logger[pinoLevel as keyof pino.Logger](args[0], msg)
    } else {
      this.logger[pinoLevel as keyof pino.Logger]({ data: args.length === 1 ? args[0] : args }, msg)
    }
  }
}
