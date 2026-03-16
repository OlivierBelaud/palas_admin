// CLI logger — NOT ILoggerPort (this is the CLI's own output logger)

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

export interface CliLogger {
  error(msg: string): void
  warn(msg: string): void
  info(msg: string): void
  debug(msg: string): void
  setLevel(level: LogLevel): void
}

export function createCliLogger(level: LogLevel = 'info'): CliLogger {
  const levels: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 }
  let currentLevel = levels[level]

  return {
    error(msg: string) {
      if (currentLevel >= levels.error) console.error(`❌ ${msg}`)
    },
    warn(msg: string) {
      if (currentLevel >= levels.warn) console.warn(`⚠ ${msg}`)
    },
    info(msg: string) {
      if (currentLevel >= levels.info) console.log(`✓ ${msg}`)
    },
    debug(msg: string) {
      if (currentLevel >= levels.debug) console.log(`[debug] ${msg}`)
    },
    setLevel(level: LogLevel) {
      currentLevel = levels[level]
    },
  }
}
